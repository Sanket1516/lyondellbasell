import Link from "next/link";
import type { ReactNode } from "react";
import s from "./Info.module.css";

/** Marks who produced an output: a deterministic rule, or a trained model that only predicts and explains. */
export function AiLabel({ kind }: { kind: "ai" | "rule" }) {
  return kind === "ai"
    ? <span className={s.ai} title="A trained model produced this. It predicts and explains; it never decides.">AI-assisted. Human review required</span>
    : <span className={s.rule} title="A deterministic rule produced this, the same way every time.">Rule-based</span>;
}

/** A page title block: one sentence on what the page shows, plus an optional label row. */
export function PageIntro({ children, labels }: { children: ReactNode; labels?: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "0 0 14px" }}>
      <p style={{ margin: 0, color: "var(--ink-soft)", maxWidth: "78ch" }}>{children}</p>
      {labels}
    </div>
  );
}

export function RoleBanner({ title, role, lines, note }: { title: string; role: string; lines: string[]; note?: string }) {
  return (
    <aside className={s.banner} aria-label={`What PlantPay does for the ${role}`}>
      <h2>{title}</h2>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      {note && <p className={s.note}>{note}</p>}
    </aside>
  );
}

/** The problem, in plain words, for the people who live with it. Collapsed after the first screen so it never crowds the work. */
export function ProblemBanner() {
  return (
    <details className={`${s.banner} ${s.problem}`} open>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Why we built this: the payables problem at Plant X</summary>
      <p>Plant X receives hundreds of supplier invoices a month. Each must agree with the purchase order and the goods actually received. Today clerks check that by hand, so mismatches sit for days, duplicate invoices slip through, approvals go missing, suppliers chase for payment, and auditors find the gaps later.</p>
      <p>PlantPay checks every invoice the moment it arrives, says exactly why one does not match and who must fix it, routes approvals by limit, and keeps a tamper-evident record of every decision.</p>
    </details>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className={s.spin} role="status" aria-live="polite"><i aria-hidden="true" />{label}…</div>;
}

export function SeeLive({ href }: { href: string }) {
  return <Link className={s.go} href={href}>See it live</Link>;
}

import { beforeAfter, IMPACT_ASSUMPTIONS, type Impact } from "@/lib/impact";

/** Quantified impact for the demo data, with the assumptions marked, and a before/after table. */
export function ImpactPanel({ m, compact }: { m: Impact; compact?: boolean }) {
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return (
    <section aria-label="Impact summary">
      <div className={s.tiles}>
        <div className={s.tile}><strong>{inr(m.duplicateValue)}</strong><span>{m.duplicateCount} possible duplicate {m.duplicateCount === 1 ? "payment" : "payments"} held back</span></div>
        <div className={s.tile}><strong>{m.autoClean} invoices</strong><span>matched clean first time, about {m.hoursSaved} clerk hours saved</span></div>
        <div className={s.tile}><strong>{m.exceptionsWithCause} of {m.exceptionsTotal}</strong><span>exceptions arrived with a root cause and owner, not days of chasing</span></div>
        <div className={s.tile}><strong>{inr(m.heldValue)}</strong><span>blocked from payment until a person looks</span></div>
      </div>
      {!compact && (
        <>
          <h2 className={s.sec}>What would happen without PlantPay?</h2>
          <table className={s.cmp}>
            <thead><tr><th>Task</th><th>Without PlantPay</th><th>With PlantPay</th></tr></thead>
            <tbody>{beforeAfter(m).map((r) => <tr key={r.what}><td>{r.what}{r.assumed && <span className={s.tag}>assumption</span>}</td><td>{r.before}</td><td>{r.after}</td></tr>)}</tbody>
          </table>
        </>
      )}
      <p className={s.note}>Counts and rupee values are measured from the demo records (synthetic, fictional suppliers). Rows tagged “assumption” use: {IMPACT_ASSUMPTIONS.manualMinutesPerInvoice} minutes per manual check, {IMPACT_ASSUMPTIONS.manualDaysToFindRootCause} days to find a root cause, {IMPACT_ASSUMPTIONS.manualSupplierReplyDays} working days for a supplier reply.</p>
    </section>
  );
}
