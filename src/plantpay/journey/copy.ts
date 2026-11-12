// Narrator caption, "what to notice" box and feature badges for each step.
export interface StepCopy { caption: string; notice: string[]; badges: string[] }

export const COPY: StepCopy[] = [
  { caption: "Monday, 09:00. A week at the plant begins in the control tower.", badges: ["Feature: Six-source integration", "Feature: Hash-Chained Audit Trail"],
    notice: ["Six separate department systems appear as one picture, read through read-only connectors.", "Every source shows its own health and last sync.", "The audit chain is verified on load, not assumed."] },
  { caption: "Vihar Chem Supplies uploads invoice INV-7781. The supplier gets a Passport, not a black box.", badges: ["Feature: Payment Readiness Passport"],
    notice: ["Each milestone has words and a symbol, never colour alone.", "Blocked steps name the team that has to act.", "No internal findings, scores or other suppliers appear here."] },
  { caption: "PlantPay pulls evidence from all six systems. Then Logistics goes down.", badges: ["Feature: Six-source integration"],
    notice: ["Each system keeps its own conventions; the canonical layer normalises them.", "During the outage the weighbridge check is 'not evaluated', not failed and not passed.", "Restoring the source brings the original result back."] },
  { caption: "The three-way match fails on price. Contract and inventory evidence are added.", badges: ["Feature: Contract-Aware matching", "Feature: Inventory-Aware verification"],
    notice: ["Invoice and contract agree at ₹412; the PO is stale at ₹398.", "5 MT against 5,000 kg is normalised, not flagged.", "A part-rejected delivery is caught by the quality check."] },
  { caption: "Each exception gets a cause, evidence, an owner and a way out. Then the fix is replayed.", badges: ["Feature: Root-Cause Resolver", "Feature: Counterfactual Explanation", "Feature: RAG with citations", "Feature: Workflow routing"],
    notice: ["Cause labels say 'supported by evidence' or 'unverified prediction'.", "The counterfactual ends: assuming all other checks pass.", "Answers quote their sources. The fix runs on a copy and is logged."] },
  { caption: "Four detectors look for patterns a single invoice cannot show. Every flag says: warning, not proof.", badges: ["Feature: Duplicate Fingerprint", "Feature: Threshold-Splitting detector", "Feature: Vendor Red Flags", "Feature: Relationship Graph"],
    notice: ["Each signal has a score, reasons and a recommended action.", "A bank-detail change always needs an independent call-back.", "A shared account can be legitimate. A person decides."] },
  { caption: "From one invoice to the supplier base: scores, priority and four trained models.", badges: ["Feature: Supplier Intelligence", "Feature: Predictive Models A to D"],
    notice: ["Relationship strength, criticality and risk are three different things.", "Priority orders review work; it does not set the payment order.", "Predictions show their model, test AUC and contributing factors."] },
  { caption: "Where does the process really spend its time? Replay every workflow event.", badges: ["Feature: Process-Mining Twin"],
    notice: ["The hero invoice left the expected path and came back: a rework loop.", "Waiting time and worked time are shown separately.", "The twin describes the process, not people."] },
  { caption: "Can the record be trusted? Try to tamper with it, then pay the invoice.", badges: ["Feature: Hash-Chained Audit Trail", "Feature: Payment Readiness Passport"],
    notice: ["Each tamper is detected and the exact record is reported.", "The supplier's Passport now reads approved: ready for payment.", "The checklist quotes a fact from this run for every feature."] },
];
