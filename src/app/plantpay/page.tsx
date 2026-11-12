import Link from "next/link";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import { SourceUnavailableError } from "@/plantpay/connectors";
import type { PlantPayResult } from "@/plantpay/engine";
import { getSourceStates, openTaskCounts, pendingEvents } from "@/plantpay/integration";
import { plantpay } from "@/plantpay/runtime";
import { SOURCE_IDS, SOURCE_META } from "@/plantpay/sources/schemas";
import { verifyIntegrity } from "@/plantpay/workflowEvents";
import ArchitectureDiagram from "./ArchitectureDiagram";
import { processQueue, toggleOutage } from "./actions";
import s from "./Plantpay.module.css";

export const dynamic = "force-dynamic";
const PAGE = 40;
const CHIP: Record<string, { kind: ChipKind; label: string }> = {
  pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" }, incomplete: { kind: "pending", label: "Incomplete" },
};
const LETTER: Record<string, string> = { procurement: "P", warehouse: "W", quality: "Q", finance: "F", logistics: "L", supplier: "S" };

export default async function PlantPayHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; view?: string; page?: string }> }) {
  const sp = await searchParams;
  const e = plantpay();
  const health = e.connectors.health();
  const states = getSourceStates(e.integration);
  const down = health.filter((h) => h.status === "down");

  const evals = (e.integration.prepare("SELECT result_json FROM evaluations").all() as { result_json: string }[]).map((r) => JSON.parse(r.result_json) as PlantPayResult);
  const demoIds = new Set((e.integration.prepare("SELECT invoice_id FROM demo_invoices").all() as { invoice_id: string }[]).map((r) => r.invoice_id));
  const view = sp.view === "all" ? "all" : "demo";
  const counts = { all: evals.length, pass: 0, review: 0, block: 0, incomplete: 0 } as Record<string, number>;
  for (const r of evals) counts[r.status]++;
  const status = sp.status && CHIP[sp.status] ? sp.status : undefined;
  const q = sp.q?.trim().toLowerCase();
  const rows = evals
    .filter((r) => view === "all" || demoIds.has(r.invoiceId))
    .filter((r) => !status || r.status === status)
    .filter((r) => !q || r.invoiceId.toLowerCase().includes(q) || (r.meta?.vendorName ?? "").toLowerCase().includes(q) || (r.meta?.poId ?? "").includes(q))
    .sort((a, b) => (b.meta?.receivedOn ?? "").localeCompare(a.meta?.receivedOn ?? "") || a.invoiceId.localeCompare(b.invoiceId));
  const page = Math.max(1, Number(sp.page) || 1);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  let approvals: { invoice_no: string; level: string; approved_on: string; approver: string; total_paise: number }[] | undefined;
  try { approvals = e.connectors.finance.recentApprovals(6) as never; } catch (err) { if (!(err instanceof SourceUnavailableError)) throw err; }
  const tasks = openTaskCounts(e.integration);
  const integrity = verifyIntegrity(e.integration);
  const queued = pendingEvents(e.integration).length;
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, q: sp.q, view: view === "all" ? "all" : undefined, ...o })) if (v) p.set(k, v);
    return [...p].length ? `/plantpay?${p}` : "/plantpay";
  };

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>PlantPay Intelligence Engine</h1>
      <p className={s.lead}>One view of every invoice, built from six separate department systems through a read-only integration layer. Deterministic rules decide; nothing here is an accusation, only a prompt for a person to look.</p>
      <ArchitectureDiagram />

      <h2 className={s.h2}>Data sources</h2>
      {down.length > 0 && <div className={s.banner} role="status"><strong>Source unavailable:</strong> {down.map((d) => d.label).join(", ")}. Checks that depend on {down.length === 1 ? "it" : "them"} show as not evaluated and affected invoices are marked incomplete. Nothing is guessed.</div>}
      <div className={s.sources}>
        {health.map((h) => (
          <div key={h.id} className={`${s.src} ${h.status === "down" ? s.srcDown : ""}`}>
            <span className={s.srcName}><span className={`${s.dot} ${h.status === "down" ? s.dotDown : ""}`} aria-hidden="true" />{h.label} <span className="sr-only">{h.status === "up" ? "healthy" : "unavailable"}</span></span>
            <span className={s.srcMeta}>{h.holds}</span>
            <span className={s.srcMeta}>{h.status === "up" ? `Healthy, ${h.records?.toLocaleString("en-IN")} records` : `Unavailable${h.error ? `: ${h.error}` : ""}`}</span>
            <span className={s.srcMeta}>Last sync {h.lastSync ? `${fmtDate(h.lastSync.slice(0, 10))} ${h.lastSync.slice(11, 16)} UTC` : "never"}</span>
            <form action={toggleOutage}>
              <input type="hidden" name="source" value={h.id} />
              <input type="hidden" name="outage" value={states.find((x) => x.source === h.id)?.outage ? "0" : "1"} />
              <button className={s.srcBtn} type="submit">{states.find((x) => x.source === h.id)?.outage ? "Bring back online" : "Simulate outage"}</button>
            </form>
          </div>
        ))}
      </div>

      <div className={s.tiles}>
        <Link href={href({ status: undefined, page: undefined })} className={`${s.tile} ${!status ? s.tileOn : ""}`}><strong>{view === "all" ? counts.all : evals.filter((r) => demoIds.has(r.invoiceId)).length}</strong><span>{view === "all" ? "All invoices" : "Demo documents"}</span></Link>
        {Object.entries(CHIP).map(([k, c]) => <Link key={k} href={href({ status: k, page: undefined })} className={`${s.tile} ${status === k ? s.tileOn : ""}`}><strong>{(view === "all" ? evals : evals.filter((r) => demoIds.has(r.invoiceId))).filter((r) => r.status === k).length}</strong><span>{c.label}</span></Link>)}
      </div>

      <div className={s.cols}>
        <div className={s.panel}>
          <h3>Open work by department</h3>
          {Object.keys(tasks).length === 0 ? <p className={s.srcMeta}>No open tasks.</p> : <ul>{Object.entries(tasks).sort((a, b) => b[1] - a[1]).map(([d, n]) => <li key={d}>{d}: <strong>{n}</strong></li>)}</ul>}
          <p className={s.srcMeta} style={{ marginTop: 8 }}>{queued} event{queued === 1 ? "" : "s"} waiting.</p>
          <form action={processQueue}><button className={s.btn} type="submit">Process event queue</button></form>
        </div>
        <div className={s.panel}>
          <h3>Recent approvals (Finance DB)</h3>
          {!approvals ? <p className={s.evDown}>Source unavailable: Finance DB. Approvals cannot be listed right now.</p> : <ul>{approvals.map((a) => <li key={a.invoice_no}><Link href={`/plantpay/invoices/${encodeURIComponent(a.invoice_no)}`} className="mono">{a.invoice_no}</Link> ₹{fmtInr(a.total_paise / 100, 0)}, {a.level} {a.approver}, {fmtDate(a.approved_on)}</li>)}</ul>}
        </div>
        <div className={s.panel}>
          <h3>Audit reports</h3>
          {integrity.ok ? <p>Audit trail intact: {integrity.auditEntries.toLocaleString("en-IN")} entries, {integrity.workflowEvents.toLocaleString("en-IN")} workflow events verified.</p> : <p className={s.evDown}>Integrity check failed at record {integrity.position}: {integrity.reason}</p>}
          <Link href="/plantpay/audit">Open the audit trail and verify integrity</Link>
          <br /><Link href="/plantpay/graph">Open the relationship graph (shared accounts, addresses, clusters)</Link>
        </div>
      </div>

      <h2 className={s.h2}>Invoices</h2>
      <nav className={s.tabs} aria-label="Invoice set">
        <Link className={`${s.tab} ${view === "demo" ? s.tabOn : ""}`} href={href({ view: undefined, page: undefined })}>Demo documents</Link>
        <Link className={`${s.tab} ${view === "all" ? s.tabOn : ""}`} href={href({ view: "all", page: undefined })}>All invoices ({counts.all})</Link>
      </nav>
      <form className={s.search} action="/plantpay" method="get">
        {status && <input type="hidden" name="status" value={status} />}{view === "all" && <input type="hidden" name="view" value="all" />}
        <label>Search invoice, supplier or PO<input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="e.g. Thane, 4600009003" /></label>
        <button type="submit">Search</button>
      </form>
      {shown.length === 0 ? <p className={s.lead}>No invoices match these filters. <Link href="/plantpay">Clear filters</Link></p> : (
        <table className={s.table}>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Received</th><th className={s.num}>Total (₹)</th><th>Decision</th><th>Sources</th><th>What needs attention</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.invoiceId}>
                <td><Link className="mono" style={{ whiteSpace: "nowrap" }} href={`/plantpay/invoices/${encodeURIComponent(r.invoiceId)}`}>{r.invoiceId}</Link></td>
                <td>{r.meta?.vendorName ?? ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.meta?.receivedOn)}</td>
                <td className={s.num}>{r.meta ? fmtInr(r.meta.totalInr) : ""}</td>
                <td><StatusChip kind={CHIP[r.status].kind} label={CHIP[r.status].label} /></td>
                <td><span className={s.chips} aria-label="Sources used">{SOURCE_IDS.map((id) => { const u = r.sources.find((x) => x.source === id); const ok = u?.status === "ok"; return <span key={id} title={`${SOURCE_META[id].label}: ${ok ? "contributed" : "unavailable"}`} className={`${s.chip} ${ok ? s.chipOn : s.chipOff}`}>{LETTER[id]}</span>; })}</span></td>
                <td className={s.why}>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={s.pager}>
        <span>{rows.length} invoice{rows.length === 1 ? "" : "s"}</span>
        {page > 1 && <Link href={href({ page: String(page - 1) })}>Previous</Link>}
        {page * PAGE < rows.length && <Link href={href({ page: String(page + 1) })}>Next</Link>}
        <span>Source letters: P procurement, W warehouse, Q quality, F finance, L logistics, S supplier master.</span>
      </div>
    </>
  );
}
