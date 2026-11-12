import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { readAudit } from "@/plantpay/integration";
import { plantpay } from "@/plantpay/runtime";
import { WORKFLOW_EVENT_TYPES, listWorkflowEvents, verifyIntegrity } from "@/plantpay/workflowEvents";
import s from "../Plantpay.module.css";

export const dynamic = "force-dynamic";
const PAGE = 50;
const LABEL: Record<string, string> = {
  invoice_received: "Invoice received", department_assigned: "Department assigned", review_started: "Review started", review_completed: "Review completed",
  exception_raised: "Exception raised", exception_resolved: "Exception resolved", approval_requested: "Approval requested", approval_granted: "Approval granted", payment_status_changed: "Payment status changed",
};

export default async function PlantPayAudit({ searchParams }: { searchParams: Promise<{ verify?: string; tab?: string; type?: string; invoice?: string; page?: string }> }) {
  const sp = await searchParams;
  const e = plantpay();
  const report = sp.verify === "1" ? verifyIntegrity(e.integration) : undefined;
  const tab = sp.tab === "audit" ? "audit" : "events";
  const page = Math.max(1, Number(sp.page) || 1);
  const type = sp.type && (WORKFLOW_EVENT_TYPES as readonly string[]).includes(sp.type) ? sp.type : undefined;
  const wf = listWorkflowEvents(e.integration, { type, invoiceId: sp.invoice?.trim() || undefined, limit: PAGE, offset: (page - 1) * PAGE });
  const total = (e.integration.prepare("SELECT MAX(seq) m FROM audit_events").get() as { m: number }).m;
  const audit = tab === "audit" ? readAudit(e.integration).slice().reverse().slice((page - 1) * PAGE, page * PAGE) : [];
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab: tab === "audit" ? "audit" : undefined, type, invoice: sp.invoice, ...o })) if (v) p.set(k, v);
    return [...p].length ? `/plantpay/audit?${p}` : "/plantpay/audit";
  };

  return (
    <>
      <Link href="/plantpay" className={s.back}>Back to PlantPay</Link>
      <h1 style={{ marginBottom: 6 }}>Audit trail</h1>
      <p className={s.lead}>Every workflow event and system action is written to an append-only log. Each entry stores a hash of its own content and the previous entry, so changing, deleting or reordering any past record breaks every hash after it. Workflow events are also checked against the hash their audit entry recorded.</p>

      <form action="/plantpay/audit" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="verify" value="1" />
        <button className={`${s.btn} ${s.btnPrimary}`} type="submit">Verify integrity</button>
      </form>
      {report && (report.ok
        ? <div className={s.ok} role="status"><strong>Integrity verified.</strong> {report.auditEntries.toLocaleString("en-IN")} audit entries and {report.workflowEvents.toLocaleString("en-IN")} workflow events checked; every link and every event matches.</div>
        : <div className={s.banner} role="alert"><strong>Tampering detected at record {report.position}.</strong> {report.reason} Everything before record {report.position} is still intact; the log should not be relied on from that point.</div>)}

      <nav className={s.tabs} aria-label="Log">
        <Link className={`${s.tab} ${tab === "events" ? s.tabOn : ""}`} href={href({ tab: undefined, page: undefined })}>Workflow events</Link>
        <Link className={`${s.tab} ${tab === "audit" ? s.tabOn : ""}`} href={href({ tab: "audit", page: undefined })}>Audit log ({total.toLocaleString("en-IN")} entries)</Link>
      </nav>

      {tab === "events" ? (
        <>
          <form className={s.search} action="/plantpay/audit" method="get">
            <label>Event type<select name="type" defaultValue={type ?? ""} style={{ padding: 6 }}><option value="">All types</option>{WORKFLOW_EVENT_TYPES.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select></label>
            <label>Invoice<input type="search" name="invoice" defaultValue={sp.invoice ?? ""} placeholder="exact invoice number" /></label>
            <button type="submit">Filter</button>
          </form>
          {wf.events.length === 0 ? <p className={s.lead}>No events match. <Link href="/plantpay/audit">Clear filters</Link></p> : (
            <table className={s.table}>
              <thead><tr><th>When</th><th>Event</th><th>Invoice</th><th>Department</th><th>Actor</th><th>Detail</th></tr></thead>
              <tbody>{wf.events.map((x) => (
                <tr key={x.id}><td style={{ whiteSpace: "nowrap" }}>{fmtDate(x.at.slice(0, 10))} {x.at.slice(11, 16)}</td><td>{LABEL[x.type]}</td>
                  <td><Link className="mono" href={`/plantpay/invoices/${encodeURIComponent(x.invoiceId)}`}>{x.invoiceId}</Link></td><td>{x.department}</td><td>{x.actor}</td>
                  <td className={s.why}>{Object.entries(x.payload).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ").slice(0, 160)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <div className={s.pager}><span>{wf.total.toLocaleString("en-IN")} events</span>{page > 1 && <Link href={href({ page: String(page - 1) })}>Previous</Link>}{page * PAGE < wf.total && <Link href={href({ page: String(page + 1) })}>Next</Link>}</div>
        </>
      ) : (
        <>
          <table className={s.table}>
            <thead><tr><th className={s.num}>#</th><th>When</th><th>Actor</th><th>Action</th><th>Invoice</th><th>Detail</th><th>Hash</th></tr></thead>
            <tbody>{audit.map((a) => (
              <tr key={a.seq}><td className={s.num}>{a.seq}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(a.at.slice(0, 10))} {a.at.slice(11, 16)}</td><td>{a.actor}</td><td>{a.action.replace(/_/g, " ")}</td>
                <td className="mono">{a.invoiceId ?? ""}</td><td className={s.why}>{a.detail.replace(/\s*\[event sha256 [0-9a-f]{64}\]/, "").slice(0, 150)}</td><td className="mono" title={a.hash}>{a.hash.slice(0, 10)}…</td></tr>
            ))}</tbody>
          </table>
          <div className={s.pager}><span>Newest first, {total.toLocaleString("en-IN")} entries</span>{page > 1 && <Link href={href({ page: String(page - 1) })}>Newer</Link>}{page * PAGE < total && <Link href={href({ page: String(page + 1) })}>Older</Link>}</div>
        </>
      )}
    </>
  );
}
