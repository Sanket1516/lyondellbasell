import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { getState } from "@/lib/store";
import { VerifyChain } from "./VerifyChain";
import s from "./Audit.module.css";

export const dynamic = "force-dynamic";
const LIMIT = 300;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ invoice?: string; actor?: string; action?: string }> }) {
  const q = await searchParams;
  const events = getState().auditEvents;
  const invoice = (q.invoice ?? "").trim().toLowerCase();
  const shown = events
    .filter((e) => (!invoice || (e.invoiceId ?? "").toLowerCase().includes(invoice)) && (!q.actor || e.actor === q.actor) && (!q.action || e.action === q.action))
    .slice()
    .reverse();
  const actors = [...new Set(events.map((e) => e.actor))].sort();
  const actions = [...new Set(events.map((e) => e.action))].sort();
  const filtered = !!(invoice || q.actor || q.action);

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Audit trail</h1>
      <p className={s.lead}>
        Every state change, override, task, simulated ERP update, approval and rejection is written here and cannot be edited. Each record carries a hash of the record before it, so any change to an old record breaks the chain.
      </p>
      <div className={s.bar}>
        <form className={s.filters} method="get" aria-label="Filter the audit trail">
          <label>Invoice<input name="invoice" defaultValue={q.invoice ?? ""} placeholder="e.g. INV-7781" /></label>
          <label>Actor
            <select name="actor" defaultValue={q.actor ?? ""}><option value="">All actors</option>{actors.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </label>
          <label>Action
            <select name="action" defaultValue={q.action ?? ""}><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}</select>
          </label>
          <button type="submit" className={s.btn}>Filter</button>
          {filtered && <Link href="/audit">Clear</Link>}
        </form>
        <VerifyChain />
      </div>

      {events.length === 0 ? (
        <p className={s.lead}>No records yet. Records appear as invoices are submitted, matched and decided.</p>
      ) : (
        <div className={s.wrap}>
          <table className={s.table}>
            <thead>
              <tr><th>#</th><th>Time (IST)</th><th>Actor</th><th>Action</th><th>Invoice</th><th>What happened</th><th>Hash</th></tr>
            </thead>
            <tbody>
              {shown.slice(0, LIMIT).map((e) => (
                <tr key={e.seq} className={e.action === "refused" ? s.refused : undefined}>
                  <td className={s.seq}>{e.seq}</td>
                  <td className={s.when}>{fmtDateTime(e.at)}</td>
                  <td>{e.actor}<div className={s.role}>{e.role ?? ""}</div></td>
                  <td>{e.action.replace(/_/g, " ")}</td>
                  <td>{e.invoiceId ? <span className="mono">{e.invoiceId}</span> : "-"}</td>
                  <td className={s.detail}>
                    {e.detail}
                    {(e.before || e.after) && <div className={s.change}>{e.before ?? "-"} → {e.after ?? "-"}</div>}
                    {e.reason && <div className={s.reason}>Reason: {e.reason}</div>}
                  </td>
                  <td className={s.hash} title={e.hash}>{e.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={s.count}>{shown.length === events.length ? `${events.length} records` : `${shown.length} of ${events.length} records`}{shown.length > LIMIT ? `, newest ${LIMIT} shown` : ""}. Newest first.</p>
    </>
  );
}
