import { AiLabel } from "@/components/Info";
import s from "@/components/Info.module.css";

export const dynamic = "force-dynamic";

const ITEMS: [string, string][] = [
  ["Rules decide, AI explains", "Approve, flag or block comes from deterministic rules that give the same answer every time. Models only add predictions and explanations, and never sit in the decision path."],
  ["Every prediction shows its reasons", "Predictions list the factors that pushed them up or down, and their probabilities come from trained, evaluated models, never hard-coded values."],
  ["Unverified means unverified", "A predicted root cause is shown as a fact only when a record backs it. Otherwise it carries the label “unverified prediction”."],
  ["Warnings, not accusations", "Duplicate, splitting, vendor and graph findings read “Warning, not proof. Human review required.” A shared bank account can be legitimate. A risk flag never blocks payment on its own; it creates a review task."],
  ["Bank changes need a second check", "Any change to bank details is marked “Requires independent verification”, by someone other than the person who made the change."],
  ["Humans stay in the loop", "Approval limits are enforced by role, the person who worked on an invoice cannot approve it, and every rejection needs a written reason."],
  ["Audit trail you can verify", "Every decision is chained to the previous one by hash. The Verify integrity button on the audit page recomputes the chain and shows where it breaks, if it does."],
  ["Data isolation", "A supplier sees only its own invoices and never internal AP notes. Internal action is shown to suppliers as plain status wording."],
  ["Synthetic data only", "Every company, bank account and amount is fictional. No real LYB data, credentials or systems are used."],
];

export default function ResponsibleAi() {
  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Responsible AI</h1>
      <p className={s.prose}>The commitments PlantPay keeps, and where to see each one working.</p>
      <div style={{ display: "flex", gap: 8, margin: "0 0 10px" }}><AiLabel kind="rule" /><AiLabel kind="ai" /></div>
      <p className={s.note}>These two labels appear on the feature screens: Rule-based means a fixed rule produced the output; AI-assisted means a trained model did, and a person must review it.</p>
      <ol className={s.prose}>
        {ITEMS.map(([t, d]) => <li key={t}><strong>{t}.</strong> {d}</li>)}
      </ol>
    </>
  );
}
