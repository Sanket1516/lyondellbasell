// Supplier Relationship Intelligence (Stage 6A).
// Three separate scores per supplier, all 0 to 100, all deterministic and explainable (no ML here):
//   Relationship Strength = how healthy and long-standing the working relationship is.
//   Supply Criticality    = how badly the plant is hurt if this supplier stops (impact, not likelihood).
//   Supplier Risk         = how likely this supplier is to cause trouble (likelihood, not impact).
// The three are kept apart on purpose: a supplier can be a strong relationship and still be critical and risky at the same time.
// An investigation-priority recommendation then combines them with invoice-level facts (due date, value, pending approvals,
// early-payment discount, contract obligations). It orders human review work. It never decides the order of payment:
// final payment order must respect contracts and financial policy.
import type Database from "better-sqlite3";
import { normVendorId } from "../plantpay/canonical";
import type { Connectors } from "../plantpay/connectors";
import { criticalityOf } from "./materials";

export const SUPPLIER_CONFIG = {
  /** Lead time (PO issue to first goods receipt) counted as on time [ASSUMPTION]. */
  onTimeLeadDays: 21,
  /** Tenure at which the duration part of Relationship Strength is full [ASSUMPTION]. */
  fullTenureMonths: 36,
  /** Recent window for the exception trend. */
  recentDays: 90,
};
export type Band = "High" | "Medium" | "Low";
export const bandOf = (score: number): Band => (score >= 70 ? "High" : score >= 40 ? "Medium" : "Low");

/** Inputs to the three scores. Every value is 0 to 1 unless stated; higher is "more" of the thing named. */
export interface ScoreInputs {
  tenureMonths: number;
  deliveryReliability: number;      // share of deliveries on time
  quality: number;                  // 1 - reject rate
  disputeRate: number;              // share of invoices that needed an exception resolved
  paymentHistory: number;           // share of our payments made on time (trust both ways)
  materialCriticality: number;      // spend-weighted criticality of what they supply
  alternativeAvailability: number;  // 1 = many other approved suppliers for the same material, 0 = none
  dependency: number;               // share of the plant's need for those materials that this supplier covers
  redFlags: number;                 // count of vendor red flags (bank change, shared account, address change)
  exceptionTrend: number;           // recent exception rate minus the earlier rate (negative = improving)
}
export interface ScorePart { label: string; value: number; weight: number; points: number; note: string }
export interface Score { score: number; band: Band; parts: ScorePart[]; summary: string }
export interface SupplierScores { relationshipStrength: Score; supplyCriticality: Score; supplierRisk: Score }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pct = (x: number) => `${Math.round(x * 100)}%`;
function build(parts: Omit<ScorePart, "points">[], summary: (s: number, ps: ScorePart[]) => string): Score {
  const ps = parts.map((p) => ({ ...p, points: Math.round(p.value * p.weight * 1000) / 10 }));
  const score = Math.round(ps.reduce((a, p) => a + p.value * p.weight, 0) * 100);
  return { score, band: bandOf(score), parts: ps, summary: summary(score, ps) };
}

export function scoreSupplier(i: ScoreInputs): SupplierScores {
  const tenure = clamp01(i.tenureMonths / SUPPLIER_CONFIG.fullTenureMonths);
  const relationshipStrength = build([
    { label: "Relationship duration", value: tenure, weight: 0.2, note: `${Math.round(i.tenureMonths)} months with the plant` },
    { label: "Delivery reliability", value: clamp01(i.deliveryReliability), weight: 0.25, note: `${pct(i.deliveryReliability)} of deliveries on time` },
    { label: "Quality", value: clamp01(i.quality), weight: 0.2, note: `${pct(i.quality)} of inspected goods accepted` },
    { label: "Few disputes", value: clamp01(1 - i.disputeRate), weight: 0.2, note: `${pct(i.disputeRate)} of invoices needed an exception resolved` },
    { label: "Payment history", value: clamp01(i.paymentHistory), weight: 0.15, note: `${pct(i.paymentHistory)} of payments made on time` },
  ], (s, ps) => `${bandOf(s)} relationship strength (${s}). ${top(ps, "strongest")}`);
  const supplyCriticality = build([
    { label: "Material criticality", value: clamp01(i.materialCriticality), weight: 0.4, note: `what they supply is ${pct(i.materialCriticality)} on the plant's criticality scale` },
    { label: "Few alternatives", value: clamp01(1 - i.alternativeAvailability), weight: 0.3, note: i.alternativeAvailability < 0.15 ? "no other approved supplier for most of their materials" : `${pct(i.alternativeAvailability)} alternative availability` },
    { label: "Dependency", value: clamp01(i.dependency), weight: 0.3, note: `covers ${pct(i.dependency)} of the plant's need for those materials` },
  ], (s, ps) => `${bandOf(s)} supply criticality (${s}). ${top(ps, "driver")}`);
  const trend = clamp01(0.5 + i.exceptionTrend * 2.5); // 0.5 = flat, 1 = exception rate rising fast
  const supplierRisk = build([
    { label: "Late deliveries", value: clamp01(1 - i.deliveryReliability), weight: 0.25, note: `${pct(1 - i.deliveryReliability)} of deliveries late` },
    { label: "Rejected goods", value: clamp01(((1 - i.quality) * 100) / 12), weight: 0.2, note: `${pct(1 - i.quality)} of inspected goods rejected` },
    { label: "Invoice disputes", value: clamp01(i.disputeRate / 0.4), weight: 0.2, note: `${pct(i.disputeRate)} of invoices needed an exception resolved` },
    { label: "Vendor red flags", value: clamp01(i.redFlags / 3), weight: 0.2, note: `${i.redFlags} warning${i.redFlags === 1 ? "" : "s"} on the supplier record (for human review, not proof)` },
    { label: "Exception trend", value: trend, weight: 0.1, note: i.exceptionTrend > 0.02 ? "exceptions rising recently" : i.exceptionTrend < -0.02 ? "exceptions falling recently" : "exception rate steady" },
    { label: "Short relationship", value: clamp01(1 - i.tenureMonths / 24), weight: 0.05, note: "less history to judge by" },
  ], (s, ps) => `${bandOf(s)} supplier risk (${s}). ${top(ps, "driver")}`);
  return { relationshipStrength, supplyCriticality, supplierRisk };
}
function top(ps: ScorePart[], word: string): string {
  const best = [...ps].sort((a, b) => b.points - a.points)[0];
  return `Main ${word}: ${best.label.toLowerCase()} (${best.note}).`;
}

// ---------------------------------------------------------------- investigation priority
export interface PriorityInput {
  scores: SupplierScores;
  invoiceTotalInr: number;
  /** Days from today to the due date (negative: overdue). */
  dueInDays: number;
  pendingApprovals: number;
  /** Early-payment discount offered by the contract (percent) and how many days are left to take it. */
  earlyDiscountPct?: number; discountDaysLeft?: number;
  /** The contract fixes the payment date and charges interest if it is missed. */
  contractualPaymentDate?: boolean; lateInterestPctMonth?: number;
  hasOpenException?: boolean;
}
export interface PriorityResult { priority: number; band: "Investigate first" | "Investigate soon" | "Routine"; contributions: { label: string; points: number; why: string }[]; explanation: string; note: string }
export const PRIORITY_NOTE = "This ranks which invoices a person should look at first. It does not set the payment order: final payment order must respect contracts and financial policy.";
const W = { urgency: 25, value: 15, supplier: 30, discount: 10, approvals: 8, contract: 12 };

export function investigationPriority(p: PriorityInput): PriorityResult {
  const s = p.scores;
  const urgency = p.dueInDays <= 0 ? 1 : p.dueInDays <= 3 ? 0.85 : p.dueInDays <= 7 ? 0.65 : p.dueInDays <= 14 ? 0.4 : p.dueInDays <= 30 ? 0.2 : 0.05;
  const value = clamp01(Math.log10(Math.max(p.invoiceTotalInr, 1) / 10000) / Math.log10(200));  // Rs 10,000 -> 0, Rs 20 lakh -> 1
  const supplier = clamp01(0.45 * (s.supplyCriticality.score / 100) + 0.35 * (s.supplierRisk.score / 100) + 0.2 * (s.relationshipStrength.score / 100));
  const discount = p.earlyDiscountPct && (p.discountDaysLeft ?? 0) >= 0 ? clamp01(p.earlyDiscountPct / 2) * ((p.discountDaysLeft ?? 0) <= 5 ? 1 : 0.6) : 0;
  const approvals = clamp01(p.pendingApprovals / 3);
  const contract = p.contractualPaymentDate ? 1 : p.lateInterestPctMonth ? 0.3 : 0;
  const c = [
    { label: "Due date", points: urgency * W.urgency, why: p.dueInDays <= 0 ? `payment is ${Math.abs(p.dueInDays)} day(s) overdue` : `due in ${p.dueInDays} day(s)` },
    { label: "Invoice value", points: value * W.value, why: `₹${Math.round(p.invoiceTotalInr).toLocaleString("en-IN")}` },
    { label: "Supplier scores", points: supplier * W.supplier, why: `criticality ${s.supplyCriticality.score}, risk ${s.supplierRisk.score}, relationship ${s.relationshipStrength.score}` },
    { label: "Early-payment discount", points: discount * W.discount, why: discount ? `${p.earlyDiscountPct}% available for ${p.discountDaysLeft} more day(s)` : "no discount available" },
    { label: "Pending approvals", points: approvals * W.approvals, why: `${p.pendingApprovals} pending` },
    { label: "Contract obligations", points: contract * W.contract, why: p.contractualPaymentDate ? `the contract fixes the payment date${p.lateInterestPctMonth ? ` and charges ${p.lateInterestPctMonth}% a month if missed` : ""}` : p.lateInterestPctMonth ? `${p.lateInterestPctMonth}% a month interest on late payment` : "no special payment obligation" },
  ].map((x) => ({ ...x, points: Math.round(x.points * 10) / 10 }));
  const priority = Math.round(c.reduce((a, x) => a + x.points, 0));
  const band = priority >= 60 ? "Investigate first" : priority >= 40 ? "Investigate soon" : "Routine";
  const lead = [...c].filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
  const explanation = `${band} (priority ${priority} of 100). ${lead.map((x) => `${x.label}: ${x.why}`).join("; ")}.${p.hasOpenException ? "" : " No open exception on this invoice, so this is about timing only."}`;
  return { priority, band, contributions: c, explanation, note: PRIORITY_NOTE };
}

// ---------------------------------------------------------------- facts from the six sources
export interface SupplierFacts {
  vendorId: string; name: string; tenureMonths: number; poCount: number; invoiceCount: number;
  onTimeRate: number; avgLeadDays: number; leadDaysSd: number; rejectRate: number; disputeRate: number; recentExceptionRate: number; priorExceptionRate: number;
  payOnTimeRate: number; payCycleRatio: number; paymentTermsDays: number;
  spendInr: number; spendShare: number; materialCriticality: number; alternativeAvailability: number; dependency: number; soleSourceShare: number;
  redFlags: number; amendmentCount: number; openInvoices: number;
  materials: { code: string; description: string; spendShare: number; criticality: number; otherSuppliers: number }[];
  inputs: ScoreInputs; scores: SupplierScores;
  contractTerms?: { contractNo: string; earlyPayDiscountPct: number; earlyPayWithinDays: number; latePaymentInterestPctMonth: number; strictPaymentDate: boolean };
}
const D = (s: string) => Date.parse(s.slice(0, 10) + "T00:00:00Z");
const daysBetween = (a: string, b: string) => Math.round((D(b) - D(a)) / 86400000);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => { const m = mean(xs); return xs.length ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) : 0; };

const cache = new WeakMap<Connectors, { key: string; value: Map<string, SupplierFacts> }>();
/** Aggregate the six sources into one facts record and the three scores per supplier. Throws SourceUnavailableError if a source is down. */
export function loadSupplierFacts(c: Connectors, today: string): Map<string, SupplierFacts> {
  const key = `${today}|${c.finance.fingerprint()}|${c.supplier.fingerprint()}`;
  const hit = cache.get(c); if (hit && hit.key === key) return hit.value;

  const suppliers = c.supplier.allSuppliers();
  const pos = c.procurement.poSummaries();
  const lines = c.procurement.poLineValues();
  const materials = new Map(c.procurement.allMaterials().map((m) => [String(m.code), String(m.description)]));
  const amendments = c.procurement.allAmendments();
  const terms = c.procurement.contractTerms();
  const receipts = new Map(c.warehouse.receiptSummaries().map((r) => [String(r.po_ref).replace(/^PO-/, ""), r]));
  const insp = new Map(c.quality.inspectionTotals().map((r) => [String(r.po_ref).replace(/^PO-/, ""), r]));
  const invoices = c.finance.invoiceFacts();
  const banks = c.supplier.allBankAccounts();
  const addresses = c.supplier.allAddresses();

  const poSupplier = new Map<string, string>(); const poIssued = new Map<string, string>();
  for (const p of pos) { poSupplier.set(String(p.po_number), normVendorId(String(p.supplier_id))); poIssued.set(String(p.po_number), String(p.issued_on)); }
  // spend by supplier and material (PO value)
  const spend = new Map<string, Map<string, number>>(); const matSpend = new Map<string, number>(); const matSuppliers = new Map<string, Set<string>>();
  let plantSpend = 0;
  for (const l of lines) {
    const v = poSupplier.get(String(l.po_number)); if (!v) continue; const m = String(l.material_code); const val = Number(l.value);
    const sm = spend.get(v) ?? spend.set(v, new Map()).get(v)!; sm.set(m, (sm.get(m) ?? 0) + val);
    matSpend.set(m, (matSpend.get(m) ?? 0) + val); (matSuppliers.get(m) ?? matSuppliers.set(m, new Set()).get(m)!).add(v); plantSpend += val;
  }
  const out = new Map<string, SupplierFacts>();
  for (const s of suppliers) {
    const vendorId = normVendorId(String(s.supplier_code)); const code = String(s.supplier_code);
    const myPos = pos.filter((p) => normVendorId(String(p.supplier_id)) === vendorId).map((p) => String(p.po_number));
    // delivery
    const leads: number[] = [];
    for (const po of myPos) { const r = receipts.get(po); if (r) leads.push(daysBetween(poIssued.get(po)!, String(r.first_on))); }
    const onTimeRate = leads.length ? leads.filter((d) => d <= SUPPLIER_CONFIG.onTimeLeadDays).length / leads.length : 1;
    // quality
    let inspected = 0, rejected = 0; for (const po of myPos) { const q = insp.get(po); if (q) { inspected += Number(q.inspected); rejected += Number(q.rejected); } }
    const rejectRate = inspected ? rejected / inspected : 0;
    // invoices: disputes, payment
    const inv = invoices.filter((r) => normVendorId(String(r.supplier_id)) === vendorId);
    // An invoice counts as disputed when Finance holds it for an exception (blocked, or waiting on the owning department).
    const hadException = (r: Record<string, unknown>) => ["blocked", "pending_owner"].includes(String(r.status));
    const recentCut = D(today) - SUPPLIER_CONFIG.recentDays * 86400000;
    const recent = inv.filter((r) => D(String(r.invoice_date)) >= recentCut), prior = inv.filter((r) => D(String(r.invoice_date)) < recentCut);
    const rate = (xs: Record<string, unknown>[]) => (xs.length ? xs.filter(hadException).length / xs.length : 0);
    const paid = inv.filter((r) => r.paid_on);
    const terms_ = Number(s.payment_terms_days);
    const cycles = paid.map((r) => daysBetween(String(r.invoice_date), String(r.paid_on)));
    const payOnTime = paid.length ? cycles.filter((d) => d <= terms_).length / paid.length : 1;
    // materials, criticality, alternatives, dependency
    const sm = spend.get(vendorId) ?? new Map<string, number>(); const mySpend = [...sm.values()].reduce((a, b) => a + b, 0);
    const mats = [...sm.entries()].map(([m, v]) => {
      const others = (matSuppliers.get(m)?.size ?? 1) - 1;
      return { code: m, description: materials.get(m) ?? m, spendShare: mySpend ? v / mySpend : 0, criticality: criticalityOf(m), otherSuppliers: others, coverage: matSpend.get(m) ? v / matSpend.get(m)! : 1 };
    });
    const wsum = (f: (m: (typeof mats)[number]) => number) => mats.reduce((a, m) => a + f(m) * m.spendShare, 0);
    const materialCriticality = wsum((m) => m.criticality);
    const alternativeAvailability = wsum((m) => Math.min(1, m.otherSuppliers / 3));
    const dependency = wsum((m) => m.coverage);
    const soleSourceShare = wsum((m) => (m.otherSuppliers === 0 ? 1 : 0));
    // red flags: bank changes, shared account without a legitimacy note, an address change
    const myBanks = banks.filter((b) => String(b.supplier_code) === code);
    const shared = myBanks.some((b) => banks.some((o) => o.account_no === b.account_no && o.supplier_code !== code && !/legitimate|confirmed/i.test(String(b.note ?? "") + String(o.note ?? ""))));
    const redFlags = Math.max(0, myBanks.length - 1) + (shared ? 1 : 0) + (addresses.some((a) => String(a.supplier_code) === code && a.valid_to) ? 1 : 0);
    const tenureMonths = Math.max(0, daysBetween(String(s.onboarded_on), today) / 30.4);
    const t = terms.find((x) => normVendorId(String(x.supplier_id)) === vendorId);
    const trend = recent.length >= 2 && prior.length >= 2 ? rate(recent) - rate(prior) : 0;
    const inputs: ScoreInputs = { tenureMonths, deliveryReliability: onTimeRate, quality: 1 - rejectRate, disputeRate: rate(inv), paymentHistory: payOnTime, materialCriticality, alternativeAvailability, dependency, redFlags, exceptionTrend: trend };
    out.set(vendorId, {
      vendorId, name: String(s.legal_name), tenureMonths, poCount: myPos.length, invoiceCount: inv.length, onTimeRate, avgLeadDays: mean(leads), leadDaysSd: sd(leads), rejectRate, disputeRate: rate(inv),
      recentExceptionRate: rate(recent), priorExceptionRate: rate(prior), payOnTimeRate: payOnTime, payCycleRatio: cycles.length ? mean(cycles) / terms_ : 0.5, paymentTermsDays: terms_,
      spendInr: mySpend, spendShare: plantSpend ? mySpend / plantSpend : 0, materialCriticality, alternativeAvailability, dependency, soleSourceShare, redFlags,
      amendmentCount: amendments.filter((a) => normVendorId(String(a.supplier_id)) === vendorId).length, openInvoices: inv.filter((r) => !["paid"].includes(String(r.status))).length,
      materials: mats.map(({ coverage: _c, ...m }) => m).sort((a, b) => b.spendShare - a.spendShare), inputs, scores: scoreSupplier(inputs),
      contractTerms: t ? { contractNo: String(t.contract_no), earlyPayDiscountPct: Number(t.early_pay_discount_pct), earlyPayWithinDays: Number(t.early_pay_within_days), latePaymentInterestPctMonth: Number(t.late_payment_interest_pct_month), strictPaymentDate: !!t.strict_payment_date } : undefined,
    });
  }
  cache.set(c, { key, value: out });
  return out;
}

/** Convenience used by the engine hook: the integration DB is unused here but kept so callers pass one handle around. */
export type Integration = Database.Database;
