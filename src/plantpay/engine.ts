// PlantPay Intelligence Engine: orchestrates the canonical model, matching rules, risk detectors, explanation, RAG and
// workflow. Deterministic financial rules decide; nothing here uses ML or a language model to decide.
//   Stage 3 root cause / counterfactual: provided by the existing engine (src/engine/match.ts): every discrepancy carries a root
//     cause, the evidence it rests on, and the smallest fix that would make the invoice pass.
//   Stage 5 detectors: RiskDetector interface, interim implementations in rules.ts (replace when Stage 5 lands).
//   Stage 6 prediction: Predictor interface with a stub that says so. Probabilities must come from a trained, evaluated model.
import type Database from "better-sqlite3";
import { matchInvoice, type MatchData } from "../engine/match";
import { DEMO_TODAY } from "../lib/constants";
import type { Verdict } from "../lib/types";
import { CHECKS, KIND_TO_CHECK, earlierThan } from "../foundation/threeWay";
import { loadCanonical, type CanonicalBundle, type SourceUse } from "./canonical";
import { contractCheck, type CheckState, type ContractLineTerm, type ContractOutcome, type SkipInfo } from "./contractCheck";
import { inventoryCheck, type InventoryLineRow, type InventoryOutcome } from "./inventory";
import { Connectors, SourceUnavailableError } from "./connectors";
import { appendAudit, emitEvent as _emit, getStoredEvaluation, markProcessed, pendingEvents, saveEvaluation, type PlantPayEvent } from "./integration";
import { RagIndex, POLICY_PASSAGES, answerQuestion, contractPassages, type EvaluationFacts, type RagAnswer } from "./rag";
import { PLANTPAY_CONFIG, qualityCheck, weighbridgeCheck, type RiskDetector, type RiskWarning } from "./rules";
import { SOURCE_META, type SourceId } from "./sources/schemas";
import { recordWorkflowEvent, workflowEventsFor } from "./workflowEvents";
import { assessRisk, graphFor, toWarnings, type RiskAssessment } from "./risk";

void _emit;
export type PlantPayStatus = "pass" | "review" | "block" | "incomplete";
export interface PpCheck { check: string; label: string; passed: boolean | null; detail: string; sources: SourceId[] }
export interface PpDiscrepancy {
  check: string; lineNo?: number; severity: Verdict; message: string; expected?: string; actual?: string; deltaPct?: number;
  rootCause: string; rootCauseStatus: "supported_by_evidence" | "unverified_prediction"; evidence: string[]; suggestedFix: string; owner: string; department: string; sources: SourceId[];
}
export type PredictionResult = { available: false; reason: string } | { available: true; items: { label: string; probability: number; model: string; trainedOn: string }[] };
export interface Predictor { predict(bundle: CanonicalBundle, result: PlantPayResult): PredictionResult }
export const stubPredictor: Predictor = { predict: () => ({ available: false, reason: "The prediction module (Stage 6) is not built yet. Probabilities are only ever shown from a trained, evaluated model." }) };

/** Stage 4C: the three validations side by side. The three-way match is the unchanged Stage 1 engine; contract and inventory are added on top. */
export interface ValidationPanel {
  threeWay: { state: Exclude<CheckState, "skipped">; headline: string; issues: string[] };
  contract: { state: CheckState; headline: string; skip?: SkipInfo; contractId?: string; validFrom?: string; validTo?: string; referenceDate?: string; terms: ContractLineTerm[]; issues: string[] };
  inventory: { state: CheckState; headline: string; skip?: SkipInfo; rows: InventoryLineRow[]; issues: string[] };
}

export interface PlantPayResult {
  invoiceId: string; status: PlantPayStatus; summary: string; evaluatedAt: string;
  checks: PpCheck[]; discrepancies: PpDiscrepancy[]; warnings: (RiskWarning & { sources: SourceId[] })[];
  sources: SourceUse[]; unavailable: SourceId[]; notEvaluated: { check: string; because: SourceId }[];
  routing: { department: string; reason: string }[]; prediction: PredictionResult;
  tolerances: { pricePct: number; qtyPct: number; weighbridgePct: number };
  /** Three-way, contract and inventory side by side (Stage 4). Absent on results stored before Stage 4. */
  validation?: ValidationPanel;
  /** Stage 5: the four risk detectors (duplicate fingerprint, threshold splitting, vendor red flags, relationship graph). Every flag is a warning, not proof. */
  risk?: RiskAssessment;
  /** Small header facts kept with the result so lists work even while a source is down. */
  meta?: { vendorId: string; vendorName: string; poId?: string; totalInr: number; invoiceDate: string; receivedOn: string; sourceFile?: string };
}

const DEPARTMENT: Record<string, string> = { Buyer: "Procurement", Warehouse: "Warehouse", Quality: "Quality", Logistics: "Logistics", Supplier: "Finance", "AP Clerk": "Finance", System: "Finance" };
const CHECK_SOURCES: Record<string, SourceId[]> = {
  vendor: ["supplier", "procurement"], purchase_order: ["procurement"], duplicate: ["finance"], price: ["procurement"], quantity: ["procurement", "warehouse"],
  unit_of_measure: ["procurement"], tax: ["procurement"], arithmetic: ["finance"],   quality: ["quality", "warehouse"], weighbridge: ["logistics", "warehouse"], bank_and_account_risk: ["supplier", "finance"],
  contract: ["procurement"], inventory: ["warehouse", "finance"],
};
const THREE_WAY = new Set(["vendor", "purchase_order", "duplicate", "price", "quantity", "unit_of_measure", "tax", "arithmetic"]);
const EXTRA_LABELS: Record<string, string> = {
  quality: "Billed quantity is covered by quantity accepted at inspection", weighbridge: "Weighbridge weight agrees with GRN and invoice",
  bank_and_account_risk: "Bank details, shared account and splitting warnings",
  contract: "Contract terms are in force and the prices agree with the contract", inventory: "Quantities reconcile with receipts, returns and earlier invoices",
};
const RANK: Record<Verdict, number> = { approve: 0, flag: 1, block: 2 };
const STATUS_OF: Record<Verdict, PlantPayStatus> = { approve: "pass", flag: "review", block: "block" };

export class PlantPayEngine {
  readonly today: string;
  private detectors: RiskDetector[];
  /** Stage 5 detectors run unless a caller injects its own detector list. */
  private stage5: boolean;
  private predictor: Predictor;
  private now: () => string;
  private rag?: { index: RagIndex; contractsUnavailable: boolean };

  constructor(readonly integration: Database.Database, readonly connectors: Connectors, opts: { today?: string; detectors?: RiskDetector[]; predictor?: Predictor; now?: () => string } = {}) {
    this.today = opts.today ?? DEMO_TODAY;
    this.detectors = opts.detectors ?? [];
    this.stage5 = !opts.detectors;
    this.predictor = opts.predictor ?? stubPredictor;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** Evaluate one invoice from the six sources. Never throws for an unavailable source. */
  compute(invoiceNo: string): { result: PlantPayResult; bundle?: CanonicalBundle } {
    const canon = loadCanonical(this.connectors, invoiceNo);
    const at = this.now();
    const base = { tolerances: { pricePct: 2, qtyPct: 5, weighbridgePct: PLANTPAY_CONFIG.weighbridgePct } };
    if (!canon.bundle) {
      const result: PlantPayResult = {
        invoiceId: invoiceNo, status: "incomplete", summary: `Incomplete: ${canon.error ?? "the invoice could not be read."}`, evaluatedAt: at, checks: [], discrepancies: [], warnings: [],
        sources: canon.sources, unavailable: canon.unavailable, notEvaluated: [], routing: [], prediction: { available: false, reason: "Not evaluated." }, ...base,
      };
      return { result };
    }
    const b = canon.bundle;
    const dd = this.integration.prepare("SELECT matched_invoice_id, decision, decided_by, reason, decided_at FROM duplicate_decisions WHERE invoice_id = ?").get(invoiceNo) as { matched_invoice_id: string; decision: "duplicate" | "not_duplicate"; decided_by: string; reason: string; decided_at: string } | undefined;
    if (dd) b.invoice.duplicateDecision = { decision: dd.decision, matchedInvoiceId: dd.matched_invoice_id, by: dd.decided_by, reason: dd.reason, at: dd.decided_at };
    const down = new Set<SourceId>(canon.unavailable);
    const ne: { check: string; because: SourceId }[] = [];
    const skip = (checks: string[], because: SourceId) => checks.forEach((c) => { if (!ne.some((x) => x.check === c)) ne.push({ check: c, because }); });
    if (down.has("procurement")) skip(["purchase_order", "price", "quantity", "unit_of_measure", "tax", "quality", "weighbridge", "contract", "inventory"], "procurement");
    if (down.has("warehouse")) skip(["quantity", "quality", "weighbridge", "inventory"], "warehouse");
    if (down.has("quality")) skip(["quality"], "quality");
    if (down.has("logistics")) skip(["weighbridge"], "logistics");
    if (down.has("supplier")) { if (!b.vendor) skip(["vendor"], "supplier"); skip(["bank_and_account_risk"], "supplier"); }
    const skipped = new Set(ne.map((x) => x.check));

    // Three-way match through the existing deterministic engine
    const vendor = b.vendor ? { id: b.vendor.id, name: b.vendor.name, gstin: b.vendor.gstin, active: b.vendor.active, paymentTermsDays: b.vendor.paymentTermsDays } : { id: b.invoice.vendorId, name: b.invoice.vendorId, gstin: "", active: true };
    const data: MatchData = { vendors: [vendor], purchaseOrders: b.po ? [b.po] : [], goodsReceipts: b.goodsReceipts, contracts: b.contract ? [b.contract] : [], deliveryNotes: b.deliveryNotes, uomRules: b.uomRules, invoices: earlierThan(b.invoice, b.relatedInvoices) };
    const m = matchInvoice(b.invoice, data, this.today);
    const dropKinds = new Set<string>();
    if (down.has("procurement")) ["missing_po", "not_on_po", "price", "quantity", "missing_receipt", "uom", "tax", "unknown_vendor"].forEach((k) => dropKinds.add(k));
    if (down.has("warehouse")) ["quantity", "missing_receipt"].forEach((k) => dropKinds.add(k));
    if (skipped.has("vendor")) dropKinds.add("unknown_vendor");

    const discrepancies: PpDiscrepancy[] = m.findings.filter((f) => f.verdict !== "approve" && !dropKinds.has(f.kind)).map((f) => {
      const check = KIND_TO_CHECK[f.kind];
      return {
        check, lineNo: f.lineNo, severity: f.verdict, message: f.message, expected: f.expected, actual: f.actual, deltaPct: f.deltaPct, rootCause: f.rootCause,
        rootCauseStatus: f.evidence && f.evidence.length > 0 ? "supported_by_evidence" : "unverified_prediction", evidence: (f.evidence ?? []).map((e) => e.text), suggestedFix: f.smallestFix,
        owner: f.owner, department: DEPARTMENT[f.owner] ?? "Finance", sources: CHECK_SOURCES[check] ?? [],
      };
    });
    const baseNotes = new Map<string, string>();
    for (const f of m.findings.filter((x) => x.verdict === "approve")) baseNotes.set(KIND_TO_CHECK[f.kind], f.message);

    // Quality and logistics cross-checks
    const crossNotes = new Map<string, string>();
    for (const [id, run] of [["quality", () => qualityCheck(b)], ["weighbridge", () => weighbridgeCheck(b)]] as const) {
      if (skipped.has(id)) continue;
      const out = run();
      crossNotes.set(id, out.note);
      for (const f of out.findings) discrepancies.push({
        check: f.check, lineNo: f.lineNo, severity: "flag", message: f.message, expected: f.expected, actual: f.actual, rootCause: f.rootCause, rootCauseStatus: f.evidence.length > 0 ? "supported_by_evidence" : "unverified_prediction",
        evidence: f.evidence, suggestedFix: f.smallestFix, owner: f.owner, department: DEPARTMENT[f.owner] ?? "Finance", sources: CHECK_SOURCES[f.check],
      });
    }

    // Stage 4: contract terms and inventory, run after (and independent of) the three-way match
    const unavailable = (src: string) => ({ kind: "source_unavailable" as const, reason: `${src} is unavailable.` });
    const contract: ContractOutcome = skipped.has("contract") ? { evaluated: false, skip: unavailable("Procurement DB"), terms: [], findings: [], note: "Skipped: Procurement DB is unavailable." } : contractCheck(b);
    const inventory: InventoryOutcome = skipped.has("inventory") ? { evaluated: false, skip: unavailable(down.has("warehouse") ? "Warehouse DB" : "Procurement DB"), rows: [], findings: [], note: "Skipped: a source is unavailable." } : inventoryCheck(b, { reportedDuplicates: new Set(m.findings.filter((f) => f.kind === "duplicate" && f.verdict !== "approve" && f.matchedInvoiceId).map((f) => f.matchedInvoiceId!)) });
    for (const [id, out] of [["contract", contract], ["inventory", inventory]] as const) {
      crossNotes.set(id, out.note);
      for (const f of out.findings) discrepancies.push({
        check: f.check, lineNo: f.lineNo, severity: "flag", message: f.message, expected: f.expected, actual: f.actual, rootCause: f.rootCause, rootCauseStatus: f.evidence.length > 0 ? "supported_by_evidence" : "unverified_prediction",
        evidence: f.evidence, suggestedFix: f.smallestFix, owner: f.owner, department: DEPARTMENT[f.owner] ?? "Finance", sources: CHECK_SOURCES[f.check],
      });
    }
    const skippedWhy = new Map<string, SkipInfo>();
    if (contract.skip) skippedWhy.set("contract", contract.skip);
    if (inventory.skip) skippedWhy.set("inventory", inventory.skip);

    // Risk detectors: warnings for human review
    const risk: RiskAssessment | undefined = this.stage5 && !skipped.has("bank_and_account_risk") ? assessRisk(b, { graph: graphFor(this.connectors) }) : undefined;
    const warnings: PlantPayResult["warnings"] = skipped.has("bank_and_account_risk") ? [] : [...(risk ? toWarnings(risk) : []), ...this.detectors.flatMap((d) => d.detect(b))].map((w) => ({ ...w, sources: ["supplier", "finance"] as SourceId[] }));

    // Checks list
    const checks: PpCheck[] = [...CHECKS.map((c) => ({ id: c.id as string, label: c.label, pass: c.passText })), { id: "quality", label: EXTRA_LABELS.quality, pass: "" }, { id: "weighbridge", label: EXTRA_LABELS.weighbridge, pass: "" }, { id: "contract", label: EXTRA_LABELS.contract, pass: "" }, { id: "inventory", label: EXTRA_LABELS.inventory, pass: "" }, { id: "bank_and_account_risk", label: EXTRA_LABELS.bank_and_account_risk, pass: "No bank-detail, shared-account or splitting warnings." }].map((c) => {
      const sources = CHECK_SOURCES[c.id] ?? [];
      const why = ne.find((x) => x.check === c.id);
      if (why) return { check: c.id, label: c.label, passed: null, detail: `Not evaluated: ${SOURCE_META[why.because].label} is unavailable.`, sources };
      const sk = skippedWhy.get(c.id);
      if (sk && !ne.some((x) => x.check === c.id)) return { check: c.id, label: c.label, passed: null, detail: `Skipped: ${sk.reason}`, sources };
      if (c.id === "bank_and_account_risk") {
        const rev = warnings.filter((w) => w.severity === "review");
        return { check: c.id, label: c.label, passed: rev.length === 0, detail: warnings.length ? warnings.map((w) => w.message).join(" ") : c.pass, sources };
      }
      const failing = discrepancies.filter((d) => d.check === c.id);
      if (failing.length) return { check: c.id, label: c.label, passed: false, detail: failing.map((d) => d.message).join(" "), sources };
      return { check: c.id, label: c.label, passed: true, detail: baseNotes.get(c.id) ?? crossNotes.get(c.id) ?? c.pass, sources };
    });

    // Status
    let worst: Verdict = "approve";
    for (const d of discrepancies) if (RANK[d.severity] > RANK[worst]) worst = d.severity;
    let status: PlantPayStatus = STATUS_OF[worst];
    if (status === "pass" && warnings.some((w) => w.severity === "review")) status = "review";
    if (status === "pass" && ne.length > 0) status = "incomplete";

    const routing = [...new Map([...discrepancies.map((d) => [d.department, d.message] as const), ...warnings.filter((w) => w.severity === "review").map((w) => [w.department, w.message] as const)]).entries()].map(([department, reason]) => ({ department, reason }));
    const result: PlantPayResult = {
      invoiceId: invoiceNo, status, summary: "", evaluatedAt: at, checks, discrepancies, warnings, sources: canon.sources, unavailable: canon.unavailable, notEvaluated: ne, routing,
      prediction: { available: false, reason: "" }, ...base,
    };
    result.validation = buildValidation(result, contract, inventory);
    if (risk) result.risk = risk;
    result.summary = summarise(result);
    result.meta = { vendorId: b.invoice.vendorId, vendorName: b.vendor?.name ?? b.invoice.vendorId, poId: b.invoice.poId, totalInr: b.invoice.total, invoiceDate: b.invoice.invoiceDate, receivedOn: b.invoice.receivedOn, sourceFile: b.invoice.sourceFile };
    result.prediction = this.predictor.predict(b, result);
    return { result, bundle: b };
  }

  /** Evaluate, store, route work to departments and write the audit trail. */
  evaluate(invoiceNo: string, o: { actor?: string; role?: string; audit?: boolean } = {}): PlantPayResult {
    const { result, bundle } = this.compute(invoiceNo);
    // No invoice record to evaluate (unknown number, or Finance offline): return the explanation but store nothing, so a mistyped URL
    // never adds an "incomplete" row to the counts and an outage never overwrites the last good result.
    if (!bundle) return result;
    const prevJson = getStoredEvaluation(this.integration, invoiceNo);
    const prev = prevJson ? (JSON.parse(prevJson) as PlantPayResult) : undefined;
    this.integration.transaction(() => {
      saveEvaluation(this.integration, invoiceNo, result.status, result.evaluatedAt, JSON.stringify(result));
      this.syncTasks(result, o.actor ?? "system", o.audit !== false);
      if (o.audit !== false && (!prev || prev.status !== result.status)) {
        appendAudit(this.integration, { actor: o.actor ?? "system", role: o.role ?? "system", action: "invoice_evaluated", invoiceId: invoiceNo, detail: result.summary, before: prev?.status, after: result.status }, result.evaluatedAt);
        const actor = o.actor ?? "system";
        if (!prev) recordWorkflowEvent(this.integration, { invoiceId: invoiceNo, type: "review_started", actor, department: "Finance", at: result.evaluatedAt, payload: { stage: "automated evaluation" } });
        recordWorkflowEvent(this.integration, { invoiceId: invoiceNo, type: "review_completed", actor, department: "Finance", at: result.evaluatedAt, payload: { stage: "automated evaluation", status: result.status, summary: result.summary.slice(0, 200) } });
      }
    })();
    return result;
  }

  private syncTasks(r: PlantPayResult, actor: string, audit: boolean) {
    const db = this.integration;
    const want = new Map<string, { department: string; check: string; title: string }>();
    for (const d of r.discrepancies) want.set(`${d.department}|${d.check}`, { department: d.department, check: d.check, title: d.message });
    for (const w of r.warnings.filter((x) => x.severity === "review")) want.set(`${w.department}|${w.kind}`, { department: w.department, check: w.kind, title: w.taskTitle ?? w.message });
    const open = db.prepare("SELECT id, department, check_id, title FROM workflow_tasks WHERE invoice_id = ? AND status = 'open'").all(r.invoiceId) as { id: number; department: string; check_id: string; title: string }[];
    for (const t of open) if (!want.has(`${t.department}|${t.check_id}`)) {
      db.prepare("UPDATE workflow_tasks SET status = 'done', closed_at = ? WHERE id = ?").run(r.evaluatedAt, t.id);
      if (audit) {
        appendAudit(db, { actor, action: "task_closed", invoiceId: r.invoiceId, detail: `${t.department}: ${t.check_id} no longer applies after re-evaluation`, before: "open", after: "done" }, r.evaluatedAt);
        recordWorkflowEvent(db, { invoiceId: r.invoiceId, type: "exception_resolved", actor, department: t.department, at: r.evaluatedAt, payload: { check: t.check_id, resolution: "Condition no longer present after re-evaluation" } });
      }
    }
    for (const [key, t] of want) {
      const res = db.prepare("INSERT OR IGNORE INTO workflow_tasks (invoice_id, department, check_id, title, created_at) VALUES (?,?,?,?,?)").run(r.invoiceId, t.department, t.check, t.title.slice(0, 300), r.evaluatedAt);
      if (res.changes && audit) {
        appendAudit(db, { actor, action: "task_created", invoiceId: r.invoiceId, detail: `Routed to ${t.department}: ${t.title}` }, r.evaluatedAt);
        recordWorkflowEvent(db, { invoiceId: r.invoiceId, type: "exception_raised", actor, department: "Finance", at: r.evaluatedAt, payload: { check: t.check, message: t.title.slice(0, 200) } });
        recordWorkflowEvent(db, { invoiceId: r.invoiceId, type: "department_assigned", actor, department: t.department, at: r.evaluatedAt, payload: { from: "Finance", to: t.department, check: t.check } });
      }
      else if (!res.changes) db.prepare("UPDATE workflow_tasks SET status = 'open', closed_at = NULL WHERE invoice_id = ? AND department = ? AND check_id = ? AND status = 'done'").run(r.invoiceId, t.department, t.check);
      void key;
    }
  }

  /** Evaluate every invoice in Finance. One audit entry summarises the run. */
  evaluateAll(): { count: number; byStatus: Record<string, number> } {
    const numbers = this.connectors.finance.listInvoiceHeaders().map((r) => String(r.invoice_no));
    const byStatus: Record<string, number> = {};
    this.integration.transaction(() => {
      for (const n of numbers) { const r = this.evaluate(n, { audit: false }); byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; }
      appendAudit(this.integration, { actor: "system", action: "bulk_evaluation", detail: `Evaluated ${numbers.length} invoices from six sources: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}` });
    })();
    return { count: numbers.length, byStatus };
  }

  /** AP asks an approver to approve (recorded as a workflow event; the approval itself lives in Finance). */
  requestApproval(invoiceNo: string, actor: string, amountInr: number) {
    return recordWorkflowEvent(this.integration, { invoiceId: invoiceNo, type: "approval_requested", actor, department: "Finance", at: this.now(), payload: { amountInr, requiredLevel: amountInr <= 100000 ? "clerk" : amountInr <= 1500000 ? "L1" : "L2" } });
  }
  grantApproval(invoiceNo: string, approver: string, level: string) {
    return recordWorkflowEvent(this.integration, { invoiceId: invoiceNo, type: "approval_granted", actor: approver, department: "Finance", at: this.now(), payload: { level } });
  }
  setPaymentStatus(invoiceNo: string, actor: string, from: string, to: string, extra: Record<string, unknown> = {}) {
    return recordWorkflowEvent(this.integration, { invoiceId: invoiceNo, type: "payment_status_changed", actor, department: "Finance", at: this.now(), payload: { from, to, ...extra } });
  }

  stored(invoiceNo: string): PlantPayResult | undefined { const j = getStoredEvaluation(this.integration, invoiceNo); return j ? (JSON.parse(j) as PlantPayResult) : undefined; }

  /** Event-driven re-matching: consume the outbox, re-evaluate the invoices each event affects. Events stay queued if Finance is down. */
  processEvents(): { processed: number; reevaluated: string[]; deferred: number } {
    const reevaluated = new Set<string>();
    let processed = 0, deferred = 0;
    for (const ev of pendingEvents(this.integration)) {
      let affected: string[];
      try { affected = this.affectedInvoices(ev); } catch (e) {
        if (e instanceof SourceUnavailableError) { deferred++; continue; }
        throw e;
      }
      if (ev.type === "contract_amended") this.rag = undefined;
      const inv = (ev.payload as { invoiceId?: string }).invoiceId;
      if (ev.type === "invoice_received" && inv && !workflowEventsFor(this.integration, inv).some((x) => x.type === "invoice_received")) {
        recordWorkflowEvent(this.integration, { invoiceId: inv, type: "invoice_received", actor: "Supplier portal", department: "Finance", at: ev.at, payload: { channel: "event stream", eventSeq: ev.seq } });
        recordWorkflowEvent(this.integration, { invoiceId: inv, type: "department_assigned", actor: "system", department: "Finance", at: ev.at, payload: { from: "Intake", to: "Finance" } });
      }
      let financeDown = false;
      for (const n of affected) {
        const before = this.stored(n)?.status;
        const r = this.evaluate(n, { actor: "system", role: "system" });
        // Finance offline: nothing was stored, so keep the event queued and re-match when Finance is back.
        if (r.unavailable.includes("finance")) { financeDown = true; break; }
        reevaluated.add(n);
        appendAudit(this.integration, { actor: "system", role: "system", action: "rematch_triggered", invoiceId: n, detail: `Event ${ev.type} (#${ev.seq}) from ${ev.source}`, before, after: r.status });
      }
      if (financeDown) { deferred++; continue; }
      markProcessed(this.integration, ev.seq, this.now());
      processed++;
    }
    return { processed, reevaluated: [...reevaluated], deferred };
  }

  private affectedInvoices(ev: PlantPayEvent): string[] {
    const p = ev.payload as { invoiceId?: string; poId?: string; supplierId?: string };
    if (p.invoiceId) return [p.invoiceId];
    if (p.poId) return this.connectors.finance.invoiceNumbersForPo(p.poId);
    if (p.supplierId) return this.connectors.finance.invoicesForSupplier(p.supplierId).filter((r) => String(r.header.status) !== "paid").map((r) => String(r.header.invoice_no));
    return [];
  }

  // ---------------------------------------------------------------- RAG
  private ragIndex() {
    if (!this.rag || this.rag.contractsUnavailable) {
      const c = contractPassages(this.connectors);
      this.rag = { index: new RagIndex([...POLICY_PASSAGES, ...c.passages]), contractsUnavailable: c.unavailable };
    }
    return this.rag;
  }
  ask(question: string, invoiceNo?: string): RagAnswer {
    const { index, contractsUnavailable } = this.ragIndex();
    const stored = invoiceNo ? this.stored(invoiceNo) : undefined;
    const facts: EvaluationFacts | undefined = stored ? {
      invoiceId: stored.invoiceId, status: stored.status,
      discrepancies: stored.discrepancies.map((d) => ({ check: d.check, message: d.message, rootCause: d.rootCause, rootCauseStatus: d.rootCauseStatus, suggestedFix: d.suggestedFix, sources: d.sources })),
      warnings: stored.warnings.filter((w) => w.severity === "review").map((w) => ({ kind: w.kind, message: w.message })),
    } : undefined;
    const ans = answerQuestion(question, index, facts, { contractsUnavailable });
    appendAudit(this.integration, { actor: "system", role: "system", action: "rag_question", invoiceId: invoiceNo, detail: `${question.slice(0, 160)} -> ${ans.grounded ? `${ans.citations.length} citation(s)` : "no relevant source"}` });
    return ans;
  }
}

const worst = (ds: PpDiscrepancy[]): Exclude<CheckState, "skipped"> => (ds.some((d) => d.severity === "block") ? "block" : ds.length ? "review" : "pass");
function buildValidation(r: PlantPayResult, contract: ContractOutcome, inventory: InventoryOutcome): ValidationPanel {
  const tw = r.discrepancies.filter((d) => THREE_WAY.has(d.check));
  const cn = r.discrepancies.filter((d) => d.check === "contract");
  const iv = r.discrepancies.filter((d) => d.check === "inventory");
  const twDown = r.notEvaluated.filter((x) => THREE_WAY.has(x.check));
  const cs = contract.skip, is = inventory.skip;
  return {
    threeWay: { state: worst(tw), issues: tw.map((d) => d.message), headline: tw.length ? `${tw.length} discrepanc${tw.length === 1 ? "y" : "ies"} against the PO and receipts.` : twDown.length ? "No discrepancy found in what could be read; some checks were not evaluated because a source is unavailable." : "Price, quantity, tax and totals agree with the PO and goods receipts." },
    contract: { state: cs ? "skipped" : worst(cn), headline: cs ? `Skipped: ${cs.reason}` : contract.note, skip: cs, contractId: contract.contractId, validFrom: contract.validFrom, validTo: contract.validTo, referenceDate: contract.referenceDate, terms: contract.terms, issues: cn.map((d) => d.message) },
    inventory: { state: is ? "skipped" : worst(iv), headline: is ? `Skipped: ${is.reason}` : inventory.note, skip: is, rows: inventory.rows, issues: iv.map((d) => d.message) },
  };
}

function summarise(r: PlantPayResult): string {
  const parts: string[] = [];
  const issues = r.discrepancies.length;
  const rev = r.warnings.filter((w) => w.severity === "review").length;
  if (r.status === "pass") parts.push("Pass: all evaluated checks agree across the sources.");
  else if (r.status === "incomplete" && issues === 0 && rev === 0) parts.push("Incomplete: no problem found, but some evidence is unavailable.");
  else {
    const head = r.status === "block" ? "Block" : "Review";
    const what = [...new Set(r.discrepancies.map((d) => d.rootCause))].slice(0, 2).join("; ");
    parts.push(`${head}: ${issues ? `${issues} discrepanc${issues === 1 ? "y" : "ies"}${what ? ` (${what})` : ""}` : ""}${issues && rev ? " and " : ""}${rev ? `${rev} warning${rev === 1 ? "" : "s"} for human review` : ""}.`);
  }
  for (const [name, p] of [["contract terms", r.validation?.contract], ["inventory", r.validation?.inventory]] as const) if (p?.skip && p.skip.kind === "no_records") parts.push(`Skipped ${name}: ${p.skip.reason}`);
  if (r.notEvaluated.length) parts.push(`Not evaluated: ${[...new Set(r.notEvaluated.map((x) => SOURCE_META[x.because].label))].join(", ")} unavailable.`);
  return parts.join(" ");
}
