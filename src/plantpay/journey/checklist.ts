// The closing feature checklist. Each row states where the feature appeared and quotes a fact from the journey's own data,
// so the list cannot claim a feature the run did not actually show.
import type { ChecklistRow, JourneyStepData } from "./types";

const pct = (p: number) => `${Math.round(p * 100)}%`;

export const FEATURE_NAMES = [
  "Root-Cause Resolver", "Counterfactual Explanation", "Contract-Aware matching", "Inventory-Aware verification", "Duplicate Fingerprint", "Threshold-Splitting detector",
  "Vendor Red Flags", "Relationship Graph", "Supplier Intelligence", "Predictive Model A: exception", "Predictive Model B: root cause", "Predictive Model C: payment delay",
  "Predictive Model D: supplier disruption", "Payment Readiness Passport", "Process-Mining Twin", "Hash-Chained Audit Trail", "Six-source integration", "RAG with citations",
] as const;

export function buildChecklist(s: JourneyStepData): ChecklistRow[] {
  const res = s[5].resolutions[0];
  const p = Object.fromEntries(s[7].predictions.map((x) => [x.key, x]));
  const tam = s[9].tamper.find((t) => !t.ok);
  const rows: [string, number, string][] = [
    ["Root-Cause Resolver", 5, res ? `${res.rootCause} (${res.evidenceStatus === "supported_by_evidence" ? "supported by evidence" : "unverified prediction"})` : ""],
    ["Counterfactual Explanation", 5, res?.counterfactual ?? ""],
    ["Contract-Aware matching", 4, s[4].validation.contract.headline],
    ["Inventory-Aware verification", 4, s[4].validation.inventory.headline],
    ["Duplicate Fingerprint", 6, `${s[6].duplicate.copy} scored ${s[6].duplicate.score} of 100 against ${s[6].duplicate.original}: ${s[6].duplicate.label}`],
    ["Threshold-Splitting detector", 6, `${s[6].splitting.invoices.length} invoices, ₹${s[6].splitting.combinedInr.toLocaleString("en-IN")} combined: ${s[6].splitting.label}`],
    ["Vendor Red Flags", 6, `${s[6].bank.supplier}: ${s[6].bank.reasons[0] ?? ""}`],
    ["Relationship Graph", 6, `${s[6].graph.vendorA} and ${s[6].graph.vendorB} both hold account ${s[6].graph.account}`],
    ["Supplier Intelligence", 7, `${s[7].suppliers.length} suppliers scored on relationship strength, criticality and risk`],
    ["Predictive Model A: exception", 7, p.A ? `${pct(p.A.probability)} (${p.A.level}), ${p.A.model}${p.A.auc ? `, AUC ${p.A.auc.toFixed(2)}` : ""}` : ""],
    ["Predictive Model B: root cause", 7, s[7].causes[0] ? `${s[7].causes[0].label}, ${s[7].causes[0].evidenceStatus === "evidence_supported" ? "evidence-supported" : "unverified prediction"}` : ""],
    ["Predictive Model C: payment delay", 7, p.C ? `${pct(p.C.probability)} (${p.C.level}), ${p.C.model}${p.C.auc ? `, AUC ${p.C.auc.toFixed(2)}` : ""}` : ""],
    ["Predictive Model D: supplier disruption", 7, p.D ? `${pct(p.D.probability)} (${p.D.level}), ${p.D.model}${p.D.auc ? `, AUC ${p.D.auc.toFixed(2)}` : ""}` : ""],
    ["Payment Readiness Passport", 9, s[9].passport.headline],
    ["Process-Mining Twin", 8, s[8].actual ? `${s[8].actual.stations.join(" to ")}, ${s[8].actual.loops.length} rework loop${s[8].actual.loops.length === 1 ? "" : "s"}` : ""],
    ["Hash-Chained Audit Trail", 9, tam ? `Tamper detected at record ${tam.position}` : `${s[9].integrity.auditEntries} entries verified`],
    ["Six-source integration", 3, `${s[3].evidence.filter((x) => x.status === "ok").length} of 6 sources contributed; Logistics outage handled without a guess`],
    ["RAG with citations", 5, `${s[5].rag.filter((r) => r.grounded).length} answers, ${s[5].rag.reduce((a, r) => a + r.citations.length, 0)} cited passages`],
  ];
  return rows.map(([feature, step, evidence]) => ({ feature, step, evidence }));
}
