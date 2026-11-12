// Turns the trained models into predictions for one live invoice: exception probability, likely root causes (each marked
// evidence-supported or unverified), payment-delay risk, supplier disruption risk, top contributing factors (sampled Shapley values),
// supporting history, and recommended actions. Deterministic rules still decide whether an invoice passes; these are estimates.
//
// Honesty rules enforced here:
//  - A predicted root cause is "evidence_supported" only when records in the six sources confirm it (amendment, receipt, unit rule...).
//    Otherwise it is labelled "unverified_prediction", whatever its probability.
//  - Every probability comes from predictProba() of a fitted model; there is no hard-coded number in this file.
import type { CanonicalBundle } from "../plantpay/canonical";
import type { PlantPayResult, Predictor, PredictionResult } from "../plantpay/engine";
import type { Connectors } from "../plantpay/connectors";
import { predictProba } from "../ml/core";
import { shapley, type BinaryMetrics } from "../ml/eval";
import { CAUSES, CAUSE_LABEL, DELAY_FEATURES, FEATURE_META, INVOICE_FEATURES, SUPPLIER_FEATURES, extractInvoiceFeatures, extractSupplierFeatures, vectorOf, type Cause, type FeatureRecord } from "./features";
import { PRIORITY_NOTE, SUPPLIER_CONFIG, bandOf, investigationPriority, loadSupplierFacts, type Band, type PriorityResult, type SupplierFacts, type SupplierScores } from "./supplier";
import { ensureModels, type ModelBundle, type TaskArtifact } from "./train";

export interface Factor { feature: string; label: string; value: string; effectPoints: number; direction: "raises" | "lowers" }
export interface ModelNote { algorithm: string; auc?: number; accuracy: number; trainedOn: string; threshold?: number }
export interface CausePrediction {
  cause: Cause; label: string; probabilityIfException: number; overallProbability: number;
  evidenceStatus: "evidence_supported" | "unverified_prediction"; evidence: string[]; factors: Factor[];
}
export interface InvoicePrediction {
  invoiceId: string; today: string; supplierId: string; supplierName: string;
  exception: { probability: number; level: Band; threshold: number; model: ModelNote; factors: Factor[]; history: string[] };
  causes: CausePrediction[];
  causeModel: ModelNote;
  delay: { probability: number; level: Band; threshold: number; model: ModelNote; factors: Factor[]; history: string[]; dueInDays: number };
  supplier: { probability: number; level: Band; threshold: number; model: ModelNote; factors: Factor[]; history: string[]; scores: SupplierScores; facts: Pick<SupplierFacts, "onTimeRate" | "rejectRate" | "disputeRate" | "tenureMonths" | "materialCriticality" | "alternativeAvailability" | "dependency" | "spendShare" | "redFlags" | "poCount" | "invoiceCount"> };
  priority: PriorityResult;
  actions: string[];
  supplierEvidence: string[];
  rulesStatus: PlantPayResult["status"];
  inputs: FeatureRecord;
  disclaimer: string;
}
export const DISCLAIMER = "Predictions are estimates from a model trained on synthetic history. The deterministic checks decide whether an invoice passes; a prediction never overrides them. Predicted causes are unverified unless a record backs them.";

export const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fdate = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");

// ---------------------------------------------------------------- model helpers
function note(t: TaskArtifact): ModelNote {
  const chosen = t.comparison.find((c) => c.chosen)!; const m = chosen.test as BinaryMetrics;
  return { algorithm: t.chosen === "logistic" ? "logistic regression" : t.chosen === "forest" ? "random forest" : "gradient boosting", auc: m.auc, accuracy: m.accuracy, threshold: m.threshold, trainedOn: `${t.data.rows.toLocaleString("en-IN")} synthetic ${t.task === "supplierRisk" ? "supplier-months" : "invoices"}` };
}
const thresholdOf = (t: TaskArtifact) => (t.test as BinaryMetrics).threshold ?? 0.5;
const levelOf = (p: number, thr: number): Band => (p >= Math.max(0.5, thr * 2) ? "High" : p >= thr ? "Medium" : "Low");

function factorsFor(t: TaskArtifact, x: number[], cls: number, names: readonly string[], top = 4): Factor[] {
  const phi = shapley((z) => predictProba(t.model, z)[cls], x, t.baseline, 24, 11 + cls);
  return phi.map((v, f) => ({ f, v })).filter((o) => Math.abs(o.v) >= 0.004).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, top).map(({ f, v }) => ({
    feature: names[f], label: FEATURE_META[names[f]]?.label ?? names[f], value: FEATURE_META[names[f]]?.show(x[f]) ?? String(x[f]), effectPoints: Math.round(v * 1000) / 10, direction: v >= 0 ? "raises" : "lowers",
  }));
}
/** What the training history says about the situation of the top factors, e.g. "invoices where the contract price was amended after the PO had an exception rate of 49% (n=312) against 19% overall". */
function historyLines(t: TaskArtifact, factors: Factor[], x: number[], names: readonly string[], cls: number, noun: string, outcome: string): string[] {
  const out: string[] = [];
  const overall = t.history[0].bins.reduce((a, b) => a + b.share[cls] * b.n, 0) / t.history[0].bins.reduce((a, b) => a + b.n, 0);
  for (const fac of factors.slice(0, 3)) {
    const f = names.indexOf(fac.feature); const stat = t.history.find((h) => h.feature === fac.feature); if (!stat) continue;
    const v = x[f];
    const bin = stat.bins.find((b) => { const m = /^= (.+)$/.exec(b.label); if (m) return Number(m[1]) === v; const le = /^<= (.+)$/.exec(b.label); if (le) return v <= Number(le[1]); const gt = /^> (.+)$/.exec(b.label); if (gt) return v > Number(gt[1]); const r = /^(.+) to (.+)$/.exec(b.label); return !!r && v > Number(r[1]) && v <= Number(r[2]); });
    const total = stat.bins.reduce((a, b) => a + b.n, 0);
    if (!bin || bin.n < 30 || bin.n > 0.6 * total) continue;   // a group that is most of the history is not "similar cases"
    out.push(`${fac.label} (${fac.value}): of ${bin.n.toLocaleString("en-IN")} similar ${noun} in the training history, ${Math.round(bin.share[cls] * 100)}% had ${outcome}, against ${Math.round(overall * 100)}% overall.`);
  }
  return out;
}

// ---------------------------------------------------------------- evidence for predicted causes
/** Records that confirm (or fail to confirm) a predicted cause. Returns evidence lines; an empty list means "unverified prediction". */
export function causeEvidence(cause: Cause, b: CanonicalBundle, r?: PlantPayResult): string[] {
  const inv = b.invoice, po = b.po; const ev: string[] = [];
  const fromRules = (checks: string[]) => (r?.discrepancies ?? []).filter((d) => checks.includes(d.check) && d.rootCauseStatus === "supported_by_evidence").flatMap((d) => d.evidence).slice(0, 3);
  switch (cause) {
    case "price_mismatch": {
      if (po) for (const l of inv.lines) {
        const pl = po.lines.find((x) => x.itemCode === l.itemCode); if (!pl) continue;
        const am = b.amendments.find((a) => a.materialCode === l.itemCode && a.effectiveFrom > po.issuedOn && a.effectiveFrom <= inv.invoiceDate && Math.abs(a.newPrice - l.unitPrice) < 0.01 && Math.abs(a.oldPrice - pl.unitPrice) < 0.01);
        if (am) ev.push(`Contract ${b.contract?.id ?? ""} amendment effective ${fdate(am.effectiveFrom)} moved ${l.itemCode} from ${inr(am.oldPrice)} to ${inr(am.newPrice)}; PO ${po.id} was issued ${fdate(po.issuedOn)} at ${inr(pl.unitPrice)} and the invoice bills ${inr(l.unitPrice)}.`);
      }
      return ev.length ? ev : fromRules(["price", "contract"]);
    }
    case "quantity_mismatch": {
      if (po && b.goodsReceipts.length) for (const l of inv.lines) {
        const pl = po.lines.find((x) => x.itemCode === l.itemCode); if (!pl || pl.uom !== l.uom) continue;
        const got = b.goodsReceipts.flatMap((g) => g.lines).filter((g) => g.lineNo === pl.lineNo).reduce((a, g) => a + g.qtyReceived, 0);
        if (l.qty > got * 1.05) ev.push(`Line ${l.lineNo} (${l.itemCode}): ${l.qty} ${l.uom} billed but ${got} received on ${b.goodsReceipts.map((g) => `GRN ${g.id}`).join(", ")}.`);
      }
      return ev.length ? ev : fromRules(["inventory"]);
    }
    case "missing_receipt": {
      if (b.goodsReceipts.length) return [];
      const trans = b.shipments.find((s) => s.status === "in_transit");
      if (trans) return [`No goods receipt for PO ${po?.id ?? ""}; shipment ${trans.id} is still in transit (dispatched ${fdate(trans.dispatchedOn)}).`];
      if (b.gateEntries.length || b.deliveryNotes.length) return [`No goods receipt for PO ${po?.id ?? ""}, but ${b.gateEntries.length ? `gate entry ${b.gateEntries[0].id}` : `delivery note ${b.deliveryNotes[0].id}`} shows the goods arrived.`];
      return [];
    }
    case "unit_mismatch": {
      if (po) for (const l of inv.lines) { const pl = po.lines.find((x) => x.itemCode === l.itemCode); if (pl && pl.uom !== l.uom) ev.push(`Line ${l.lineNo} (${l.itemCode}) is billed in ${l.uom} but ordered in ${pl.uom}${b.uomRules.some((u) => u.itemCode === l.itemCode) ? "; a conversion rule is on file" : "; no conversion rule on file"}.`); }
      return ev;
    }
    case "tax_error": {
      if (po) for (const l of inv.lines) { const pl = po.lines.find((x) => x.itemCode === l.itemCode); if (pl && Math.abs(pl.taxRatePct - l.taxRatePct) > 0.01) ev.push(`Line ${l.lineNo} (${l.itemCode}) carries ${l.taxRatePct}% tax; the PO says ${pl.taxRatePct}%.`); }
      return ev;
    }
    case "duplicate_invoice": {
      const twin = b.relatedInvoices.find((o) => o.poId === inv.poId && Math.abs(o.total - inv.total) < 0.01 && o.id !== inv.id);
      return twin ? [`Invoice ${twin.id} from the same supplier has the same PO and total (${inr(inv.total)}).`] : [];
    }
    case "quality_rejection": {
      const rej = b.inspections.flatMap((i) => i.lines.map((l) => ({ i, l }))).filter((x) => x.l.qtyRejected > 0);
      return rej.map((x) => `Inspection ${x.i.id} rejected ${x.l.qtyRejected} of ${x.l.qtyInspected} ${x.l.uom}${x.l.reason ? ` (${x.l.reason})` : ""}.`);
    }
  }
}

// ---------------------------------------------------------------- the prediction
export function predictInvoice(b: CanonicalBundle, result: PlantPayResult | undefined, facts: SupplierFacts, models: ModelBundle, today: string, opts: { factors?: boolean } = {}): InvoicePrediction {
  const withFactors = opts.factors !== false;
  const A = models.tasks.exception, B = models.tasks.cause, C = models.tasks.delay, S = models.tasks.supplierRisk;
  const rec = extractInvoiceFeatures(b, facts);
  const xa = vectorOf(INVOICE_FEATURES, rec), xc = vectorOf(DELAY_FEATURES, rec), xs = vectorOf(SUPPLIER_FEATURES, extractSupplierFeatures(facts));
  const pe = predictProba(A.model, xa)[1], pd = predictProba(C.model, xc)[1], ps = predictProba(S.model, xs)[1];
  const pc = predictProba(B.model, xa);
  const order = pc.map((p, k) => ({ p, k })).sort((a, b2) => b2.p - a.p).slice(0, 3);
  const exFactors = withFactors ? factorsFor(A, xa, 1, INVOICE_FEATURES) : [];
  const causes: CausePrediction[] = order.map(({ p, k }) => {
    const cause = CAUSES[k]; const ev = causeEvidence(cause, b, result);
    return { cause, label: CAUSE_LABEL[cause], probabilityIfException: p, overallProbability: pe * p, evidenceStatus: ev.length ? "evidence_supported" : "unverified_prediction", evidence: ev, factors: withFactors ? factorsFor(B, xa, k, INVOICE_FEATURES, 3) : [] };
  });
  const delayF = withFactors ? factorsFor(C, xc, 1, DELAY_FEATURES) : [];
  const supF = withFactors ? factorsFor(S, xs, 1, SUPPLIER_FEATURES) : [];
  const dueInDays = facts.paymentTermsDays - days(b.invoice.invoiceDate, today);
  const terms = facts.contractTerms;
  const priority = investigationPriority({
    scores: facts.scores, invoiceTotalInr: b.invoice.total, dueInDays, pendingApprovals: rec.approvalPending ? 1 + (rec.approvalLevel >= 2 ? 1 : 0) : 0,
    earlyDiscountPct: terms?.earlyPayDiscountPct || undefined, discountDaysLeft: terms?.earlyPayDiscountPct ? terms.earlyPayWithinDays - days(b.invoice.invoiceDate, today) : undefined,
    contractualPaymentDate: terms?.strictPaymentDate, lateInterestPctMonth: terms?.latePaymentInterestPctMonth, hasOpenException: result ? result.status === "review" || result.status === "block" : undefined,
  });
  const thrE = thresholdOf(A), thrD = thresholdOf(C), thrS = thresholdOf(S);
  const supplierEvidence = [
    `${facts.name}: ${facts.invoiceCount} invoices on record, ${Math.round(facts.disputeRate * 100)}% currently held for an exception.`,
    `${Math.round(facts.onTimeRate * 100)}% of ${facts.poCount} purchase orders were received within ${SUPPLIER_CONFIG.onTimeLeadDays} days; ${(facts.rejectRate * 100).toFixed(2)}% of inspected goods rejected.`,
    facts.materials.length ? `Supplies ${facts.materials.slice(0, 3).map((m) => `${m.description} (${m.otherSuppliers === 0 ? "no alternative supplier" : `${m.otherSuppliers} alternative${m.otherSuppliers === 1 ? "" : "s"}`})`).join(", ")}.` : "",
  ].filter(Boolean);
  const out: InvoicePrediction = {
    invoiceId: b.invoice.id, today, supplierId: facts.vendorId, supplierName: facts.name,
    exception: { probability: pe, level: levelOf(pe, thrE), threshold: thrE, model: note(A), factors: exFactors, history: withFactors ? historyLines(A, exFactors, xa, INVOICE_FEATURES, 1, "invoices", "an exception") : [] },
    causes, causeModel: note(B),
    delay: { probability: pd, level: levelOf(pd, thrD), threshold: thrD, model: note(C), factors: delayF, history: withFactors ? historyLines(C, delayF, xc, DELAY_FEATURES, 1, "invoices", "a late payment") : [], dueInDays },
    supplier: { probability: ps, level: levelOf(ps, thrS), threshold: thrS, model: note(S), factors: supF, history: withFactors ? historyLines(S, supF, xs, SUPPLIER_FEATURES, 1, "supplier-months", "a supply disruption within 90 days") : [], scores: facts.scores,
      facts: { onTimeRate: facts.onTimeRate, rejectRate: facts.rejectRate, disputeRate: facts.disputeRate, tenureMonths: facts.tenureMonths, materialCriticality: facts.materialCriticality, alternativeAvailability: facts.alternativeAvailability, dependency: facts.dependency, spendShare: facts.spendShare, redFlags: facts.redFlags, poCount: facts.poCount, invoiceCount: facts.invoiceCount } },
    priority, actions: [], supplierEvidence, rulesStatus: result?.status ?? "incomplete", inputs: rec, disclaimer: DISCLAIMER,
  };
  out.actions = recommendedActions(out, b, facts);
  return out;
}

export function recommendedActions(p: InvoicePrediction, b: CanonicalBundle, facts: SupplierFacts): string[] {
  const a: string[] = [];
  const top = p.causes[0];
  if (p.exception.probability >= p.exception.threshold) {
    if (top?.evidenceStatus === "evidence_supported") a.push(`Resolve the likely cause before approval: ${lcFirst(top.label)}. Evidence: ${top.evidence[0]}`);
    else a.push(`An exception is likely. The leading cause (${lcFirst(top?.label ?? "")}) is an unverified prediction: check the records before acting on it.`);
  } else a.push("No special pre-check needed; the standard matching checks are enough.");
  if (p.delay.probability >= p.delay.threshold) a.push(`Payment may be late (${Math.round(p.delay.probability * 100)}%): ${p.delay.dueInDays} day(s) to the due date. Start any required approval now and settle exceptions early.`);
  const t = facts.contractTerms;
  if (t?.earlyPayDiscountPct) a.push(`The contract offers ${t.earlyPayDiscountPct}% for payment within ${t.earlyPayWithinDays} days of the invoice date. Take it only if the invoice is clean and policy allows.`);
  if (t?.strictPaymentDate) a.push(`Contract ${t.contractNo} fixes the payment date and charges ${t.latePaymentInterestPctMonth}% a month if missed; keep that date in view.`);
  if (p.supplier.level !== "Low" && p.supplier.scores.supplyCriticality.score >= 70) a.push(`${facts.name} is a critical supplier with a ${p.supplier.level.toLowerCase()} disruption risk (${Math.round(p.supplier.probability * 100)}%). Ask Procurement about a second source or safety stock; handle any dispute quickly and respectfully.`);
  if (facts.redFlags > 0) a.push("The supplier record has warnings (for example a bank-detail change). Verify them independently with a contact already on file; this is a check, not an accusation.");
  a.push(PRIORITY_NOTE);
  return a;
}

// ---------------------------------------------------------------- engine hook and service
/** A compact headline prediction stored on every evaluation (no factor analysis, so seeding 650 invoices stays fast). */
export function createPredictor(c: Connectors, today: string, models?: ModelBundle): Predictor {
  return {
    predict(b: CanonicalBundle, r: PlantPayResult): PredictionResult {
      try {
        const m = models ?? ensureModels();
        const facts = loadSupplierFacts(c, today).get(b.invoice.vendorId);
        if (!facts) return { available: false, reason: "Supplier profile not available, so no prediction was made." };
        const p = predictInvoice(b, r, facts, m, today, { factors: false });
        const rnd = (x: number) => Math.round(x * 1000) / 1000;
        return { available: true, items: [
          { label: "Invoice exception", probability: rnd(p.exception.probability), model: p.exception.model.algorithm, trainedOn: p.exception.model.trainedOn },
          { label: `Likely cause if an exception occurs: ${lcFirst(p.causes[0].label)} (${p.causes[0].evidenceStatus === "evidence_supported" ? "evidence-supported" : "unverified prediction"})`, probability: rnd(p.causes[0].probabilityIfException), model: p.causeModel.algorithm, trainedOn: p.causeModel.trainedOn },
          { label: "Payment after the due date", probability: rnd(p.delay.probability), model: p.delay.model.algorithm, trainedOn: p.delay.model.trainedOn },
          { label: "Supplier disruption within 90 days", probability: rnd(p.supplier.probability), model: p.supplier.model.algorithm, trainedOn: p.supplier.model.trainedOn },
        ] };
      } catch (e) {
        return { available: false, reason: e instanceof Error && /unavailable/i.test(e.message) ? "A source system is unavailable, so the prediction could not be made." : "The prediction could not be made." };
      }
    },
  };
}
export { bandOf };
export type { Band };
