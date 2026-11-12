import Link from "next/link";
import { StatusChip } from "@/components/ui";
import { buildControlsReport } from "@/lib/controls";
import { PLANT } from "@/lib/constants";
import { fmtDateTime, fmtRupees } from "@/lib/format";
import { getState } from "@/lib/store";
import { PrintButton } from "./PrintButton";
import s from "./Report.module.css";

export const dynamic = "force-dynamic";

export default function ControlsReportPage() {
  const r = buildControlsReport(getState());
  return (
    <article className={s.page}>
      <header className={s.head}>
        <div>
          <h1>Payables controls report</h1>
          <p className={s.sub}>{PLANT.name} · generated {fmtDateTime(r.generatedAt)} IST from the live invoice records and audit trail</p>
        </div>
        <div className={s.noPrint}><PrintButton /></div>
      </header>

      <p className={s.scope}>
        Scope: {r.scope.invoices} invoices, {r.scope.matched} matched, {r.scope.approvedOrPaid} approved or paid, {r.scope.auditRecords} audit records. Synthetic data for a prototype; no payment is made by this system.
      </p>

      <section aria-labelledby="tested">
        <h2 id="tested">Controls tested</h2>
        <table className={s.table}>
          <thead><tr><th>Control</th><th>Result</th><th>Status</th></tr></thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id}>
                <td className={s.control}>{l.control}</td>
                <td>{l.result}{l.detail && <div className={s.detail}>{l.detail}</div>}</td>
                <td className={s.status}><StatusChip kind={l.status === "pass" ? "approve" : l.status === "attention" ? "flag" : "pending"} label={l.status === "pass" ? "Pass" : l.status === "attention" ? "Read note" : "Context"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="exc" className={s.cols}>
        <div>
          <h2 id="exc">Exceptions summary</h2>
          <ul className={s.list}>
            <li><strong className="mono">{r.exceptions.open}</strong> open exceptions, <strong className="mono">{fmtRupees(r.exceptions.blockedValue)}</strong> of it blocked from payment.</li>
            {r.exceptions.topCause && <li>Top root cause: {r.exceptions.topCause.cause} ({r.exceptions.topCause.cases} {r.exceptions.topCause.cases === 1 ? "case" : "cases"}).</li>}
            <li>{r.exceptions.resolved} invoices had an exception and were resolved before approval.</li>
            <li>By type: {r.exceptions.byType.filter((t) => t.findings > 0).map((t) => `${t.label.split(" (")[0]} ${t.findings}`).join(", ") || "none"}.</li>
          </ul>
          <p className={s.noPrint}><Link href="/dashboard">Open the exceptions dashboard</Link></p>
        </div>
        <div>
          <h2>Sample evidence</h2>
          {r.evidence.length === 0 ? (
            <p className={s.detail}>No invoice has audit records yet. Evidence links appear once an invoice has been submitted and decided.</p>
          ) : (
            <ul className={s.list}>
              {r.evidence.map((e) => (
                <li key={e.invoiceId}><Link href={`/audit?invoice=${encodeURIComponent(e.invoiceId)}`} className="mono">{e.label}</Link>: {e.why}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className={s.foot}>Humans decide every payment-relevant step. Matching, routing and this report are rules applied to the records, with no runtime AI.</p>
    </article>
  );
}
