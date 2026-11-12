// Stage 5 entry point: run the four detectors on one canonical bundle.
//   duplicate, splitting  : history of the same supplier's invoices
//   vendor                : the supplier's own attributes (bank, address, tax ID)
//   graph                 : patterns across all vendors, accounts, addresses and approvers (needs the whole-company graph)
// Vendor red flags and graph findings are kept as separate detectors on purpose.
import type { CanonicalBundle } from "../canonical";
import type { Connectors } from "../connectors";
import { SourceUnavailableError } from "../connectors";
import type { RiskWarning } from "../rules";
import { defaultRiskConfig, type RiskConfig } from "./config";
import { detectDuplicate } from "./duplicate";
import { RelationshipGraph, type GraphInput } from "./graph";
import { detectSplitting } from "./splitting";
import { detectVendorFlags } from "./vendorFlags";
import { WARNING_LABEL, type DetectorOutcome, type RiskAssessment, type RiskSignal } from "./types";

export * from "./types";
export { RISK_CONFIG, defaultRiskConfig, type RiskConfig } from "./config";
export { RelationshipGraph } from "./graph";

const emptyGraph = (): DetectorOutcome => ({ detector: "graph", title: "Relationship graph", flag: false, score: 0, signals: [], summary: "Not evaluated: the relationship graph needs the Supplier and Finance databases." });

export function assessRisk(b: CanonicalBundle, ctx: { graph?: RelationshipGraph; config?: Partial<RiskConfig> } = {}): RiskAssessment {
  const cfg = { ...defaultRiskConfig(), ...ctx.config };
  const history = b.relatedInvoices;
  const detectors = {
    duplicate: detectDuplicate(b.invoice, history, cfg, b.po),
    splitting: detectSplitting(b.invoice, history, cfg),
    vendor: detectVendorFlags(b, cfg),
    graph: ctx.graph ? ctx.graph.detectForInvoice({ id: b.invoice.id, vendorId: b.invoice.vendorId }) : emptyGraph(),
  };
  const flagged = Object.values(detectors).flatMap((d) => d.signals).filter((s) => s.flag);
  return { detectors, flagged, label: WARNING_LABEL };
}

/** Load every vendor, account, address, approver and invoice into the relationship graph. Throws SourceUnavailableError if Supplier or Finance is down. */
export function buildGraph(c: Connectors): RelationshipGraph {
  const vid = (code: string) => String(code).replace(/^SUP[-\s]?/i, "V-");
  const approvers = c.finance.approverNames();
  const input: GraphInput = {
    vendors: c.supplier.allSuppliers().map((s) => ({ id: vid(String(s.supplier_code)), name: String(s.legal_name), gstin: String(s.gstin) })),
    banks: c.supplier.allBankAccounts().map((r) => ({ vendorId: vid(String(r.supplier_code)), accountNo: String(r.account_no), bankName: String(r.bank_name), status: String(r.status), note: r.note ? String(r.note) : undefined })),
    addresses: c.supplier.allAddresses().filter((a) => a.kind === "registered").map((a) => ({ vendorId: vid(String(a.supplier_code)), line: String(a.line), city: String(a.city), pincode: String(a.pincode), closed: !!a.valid_to })),
    invoices: c.finance.allInvoicesWithApprovals().map((i) => ({ id: String(i.invoice_no), vendorId: vid(String(i.supplier_id)), poId: i.po_ref ? String(i.po_ref).replace(/^PO[-\s]?/i, "") : undefined, total: Number(i.total_paise) / 100, date: String(i.invoice_date), approvals: (i.approvals as { approver_id: string; level: string; approved_on: string }[]).map((a) => ({ approverId: a.approver_id, level: a.level, on: a.approved_on })) })),
    approvers: approvers.map((a) => ({ id: String(a.id), name: String(a.name), limitInr: Number(a.approval_limit_inr) })),
  };
  return new RelationshipGraph(input);
}

const cache = new WeakMap<Connectors, { key: string; graph: RelationshipGraph }>();
/** Cached per connector set; rebuilt when invoice, approval, bank-account or address counts change. Returns undefined when a source is down. */
export function graphFor(c: Connectors): RelationshipGraph | undefined {
  try {
    const key = `${c.supplier.fingerprint()}|${c.finance.fingerprint()}`;
    const hit = cache.get(c);
    if (hit && hit.key === key) return hit.graph;
    const graph = buildGraph(c);
    cache.set(c, { key, graph });
    return graph;
  } catch (e) {
    if (e instanceof SourceUnavailableError) return undefined;
    throw e;
  }
}

/** Adapter to the engine's warning list. Info-level signals stay visible but do not hold the invoice. */
export function toWarnings(r: RiskAssessment): RiskWarning[] {
  const KIND: Record<string, RiskWarning["kind"]> = { bank_change: "bank_change", bank_change_verified: "bank_change", shared_bank_account: "shared_bank_account", threshold_splitting: "threshold_splitting", duplicate_fingerprint: "duplicate_risk", address_change: "address_change", tax_id_conflict: "tax_id_conflict" };
  const kindOf = (s: RiskSignal): RiskWarning["kind"] => KIND[s.kind] ?? "graph_link";
  const seen = new Set<string>();
  const out: RiskWarning[] = [];
  // The vendor detector owns shared-account wording for the invoice; the graph repeats it for context only (info), so skip graph duplicates.
  for (const s of [...r.detectors.duplicate.signals, ...r.detectors.splitting.signals, ...r.detectors.vendor.signals, ...r.detectors.graph.signals.filter((g) => g.kind === "approver_pattern" || g.kind === "shared_tax_id")]) {
    if (!s.flag && s.severity !== "info") continue;
    if (s.detector === "duplicate" && s.kind === "duplicate_fingerprint") continue; // reported by the three-way duplicate check; shown in the risk panel
    const key = `${kindOf(s)}|${s.detector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: kindOf(s), severity: s.flag ? s.severity : "info", message: `${s.reasons.join(" ")} ${s.recommendedAction} (${WARNING_LABEL})`, evidence: s.supportingRecords.map((x) => x.text), requiresIndependentVerification: s.requiresIndependentVerification, department: s.department, ...(s.requiresIndependentVerification ? { taskTitle: "Verify the bank-detail change independently: call a contact already on the supplier master before any payment" } : {}) });
  }
  return out;
}
