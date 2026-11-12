import Link from "next/link";
import { Badge, EmptyState, Panel, StatusChip } from "@/components/ui";
import { AGE_BUCKETS, buildDashboard, TYPE_LABEL, TYPE_ORDER, typeOf, type AgeBucketId, type ExceptionType } from "@/lib/dashboard";
import { fmtDate, fmtInr, fmtRupees } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { workflowView } from "@/lib/workflow-status";
import { AgeBar, HBars } from "./Charts";
import s from "./Dashboard.module.css";

export const dynamic = "force-dynamic";

type Q = { supplier?: string; from?: string; to?: string; type?: string; age?: string; cause?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const state = getState();
  const user = await getSessionUser();
  const invoiceHref = (id: string) => `${user?.role === "approver" ? "/approver" : "/clerk"}/invoices/${encodeURIComponent(id)}`;
  const supplier = state.vendors.some((v) => v.id === q.supplier) ? q.supplier : undefined;
  const from = q.from && ISO.test(q.from) ? q.from : undefined;
  const to = q.to && ISO.test(q.to) ? q.to : undefined;
  const type = (TYPE_ORDER as readonly string[]).includes(q.type ?? "") ? (q.type as ExceptionType) : undefined;
  const age = AGE_BUCKETS.some((b) => b.id === q.age) ? (q.age as AgeBucketId) : undefined;
  const cause = q.cause?.slice(0, 120) || undefined;

  const d = buildDashboard(state, { supplier, from, to, type, age, cause });

  /** A link to this page with some parameters changed. Passing undefined removes one. */
  const href = (change: Partial<Q>) => {
    const next: Record<string, string | undefined> = { supplier, from, to, type, age, cause, ...change };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const str = p.toString();
    return str ? `/dashboard?${str}` : "/dashboard";
  };
  const tableFiltered = !!(type || age || cause);
  const topCause = d.causes[0];

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Exceptions dashboard</h1>
      <p className={s.lead}>
        Open exceptions are invoices that failed the match and are not yet approved. Figures are computed from the invoice records each time this page loads. Choose a bar to filter the list at the bottom.
      </p>

      <form className={s.filters} method="get" aria-label="Dashboard filters">
        <label>Supplier
          <select name="supplier" defaultValue={supplier ?? ""}>
            <option value="">All suppliers</option>
            {state.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label>Received from<input type="date" name="from" defaultValue={from ?? ""} /></label>
        <label>Received to<input type="date" name="to" defaultValue={to ?? ""} /></label>
        <button type="submit" className={s.btn}>Apply</button>
        {(supplier || from || to || tableFiltered) && <Link href="/dashboard">Clear all</Link>}
      </form>

      <dl className={s.kpis} aria-label="Key figures">
        <Kpi label="Open exceptions" value={String(d.kpi.open)} sub={d.kpi.open === 1 ? "invoice" : "invoices"}
          def="Invoices that failed the three-way match (flag or block) and are not yet approved or paid." />
        <Kpi label="Average age" value={`${d.kpi.avgAgeDays}`} sub="days" def="Mean days since receipt for the open exceptions, counted to the demo date, 12-Nov-2026." />
        <Kpi label="First-pass match rate" value={d.kpi.firstPassPct === null ? "-" : `${d.kpi.firstPassPct}%`} sub={`${d.kpi.firstPassClean} of ${d.kpi.firstPassOf} matched`}
          def="Share of matched invoices that were clean on the first match: no flag, no block, no owner task and no duplicate decision." />
        <Kpi label="Blocked value" value={fmtRupees(d.kpi.blockedValue)} sub={`${d.kpi.blockedCount} blocked`} def="Total of invoices currently blocked from payment: no PO, no receipt, unknown supplier or a possible duplicate." />
      </dl>

      {d.kpi.open === 0 ? (
        <EmptyState title="No open exceptions for this selection">Everything received in this window has matched or been approved. Clear the filters to see all suppliers.</EmptyState>
      ) : (
        <>
          <div className={s.grid2}>
            <Panel title="By type">
              <HBars
                caption="Open exception findings by type"
                data={d.byType.map((t) => ({ id: t.type, label: t.label, value: t.findings, href: href({ type: type === t.type ? undefined : t.type }), active: type === t.type }))}
              />
              <p className={s.note}>One invoice can carry more than one finding, so the bars can add up to more than the open count.</p>
            </Panel>
            <Panel title="By age">
              <AgeBar data={d.byAge.map((b) => ({ ...b, href: href({ age: age === b.id ? undefined : b.id }), active: age === b.id }))} />
              <p className={s.note}>Days since the invoice was received, for invoices with an open exception.</p>
            </Panel>
          </div>

          <div className={s.grid2}>
            <Panel title="By supplier">
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>Supplier</th><th className={s.r}>Open</th><th className={s.r}>Value (₹)</th><th className={s.r}>Oldest</th></tr></thead>
                  <tbody>
                    {d.bySupplier.map((r) => (
                      <tr key={r.vendorId}>
                        <td><Link href={href({ supplier: supplier === r.vendorId ? undefined : r.vendorId })}>{r.vendor}</Link></td>
                        <td className={`${s.r} mono`}>{r.open}</td>
                        <td className={`${s.r} mono`}>{fmtInr(r.value, 0)}</td>
                        <td className={s.r}><Badge days={r.oldestDays} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Root causes">
              <ol className={s.causes}>
                {d.causes.map((c, i) => (
                  <li key={c.cause}>
                    <details open={i === 0}>
                      <summary>
                        <span className={s.causeCount}>{c.cases}</span>
                        <span className={s.causeName}>{c.cause}<span className={s.causeOwner}>Owner: {c.owner}</span></span>
                      </summary>
                      <div className={s.causeBody}>
                        <p><strong>{c.fix}</strong></p>
                        <p className={s.causeList}>
                          {c.pos.map((p, n) => (
                            <span key={p.poId}>{n ? ", " : ""}
                              {p.invoiceIds.map((id, k) => <span key={id}>{k ? ", " : ""}<Link href={invoiceHref(id)} className="mono">{id}</Link></span>)}
                              {" "}<span className={s.po}>(PO {p.poId})</span>
                            </span>
                          ))}
                        </p>
                        <Link href={href({ cause: cause === c.cause ? undefined : c.cause })} className={s.small}>{cause === c.cause ? "Show all in the list" : "Show only these in the list"}</Link>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
              {topCause && <p className={s.note}>Top cause: {topCause.cause}, {topCause.cases} {topCause.cases === 1 ? "case" : "cases"}. Fixing it once upstream clears all of them.</p>}
            </Panel>
          </div>

          <h2 className={s.listHead}>Exceptions{tableFiltered ? " (filtered)" : ""}</h2>
          {tableFiltered && (
            <p className={s.chips}>
              Showing:{" "}
              {type && <span className={s.chip}>{TYPE_LABEL[type]}</span>}
              {age && <span className={s.chip}>{AGE_BUCKETS.find((b) => b.id === age)?.label}</span>}
              {cause && <span className={s.chip}>{cause}</span>}
              <Link href={href({ type: undefined, age: undefined, cause: undefined })}>Show all {d.rows.length}</Link>
            </p>
          )}
          {d.tableRows.length === 0 ? (
            <EmptyState title="Nothing matches that combination">Remove one of the filters above to widen the list.</EmptyState>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr><th>Invoice</th><th>Supplier</th><th className={s.r}>Amount (₹)</th><th>Issues</th><th>Root cause</th><th>Owner</th><th>Received</th><th>Age</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {d.tableRows.map((r) => {
                    const tasks = state.tasks.filter((t) => t.invoiceId === r.invoiceId);
                    const view = workflowView({ status: r.status, verdict: r.verdict, total: r.total }, tasks);
                    return (
                      <tr key={r.invoiceId}>
                        <td><Link href={invoiceHref(r.invoiceId)} className="mono">{r.invoiceId}</Link></td>
                        <td>{r.vendor}</td>
                        <td className={`${s.r} mono`}>{fmtInr(r.total)}</td>
                        <td>{[...new Set(r.findings.map((x) => TYPE_LABEL[typeOf(x.kind)].split(" (")[0]))].join(", ")}</td>
                        <td>{[...new Set(r.findings.map((x) => x.rootCause))].join("; ")}</td>
                        <td>{[...new Set(r.findings.map((x) => x.owner))].join(", ")}</td>
                        <td className={s.nowrap}>{fmtDate(r.receivedOn)}</td>
                        <td><Badge days={r.ageDays} /></td>
                        <td><StatusChip kind={view.kind} label={view.label} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={s.count}>{d.tableRows.length} of {d.rows.length} open exceptions listed. {d.resolvedCount} invoices in this selection had an exception and have since been approved.</p>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, def }: { label: string; value: string; sub: string; def: string }) {
  return (
    <div className={s.kpi} tabIndex={0}>
      <dt>{label}</dt>
      <dd><span className={s.kpiValue}>{value}</span> <span className={s.kpiSub}>{sub}</span></dd>
      <span className={s.tip} role="note">{def}</span>
    </div>
  );
}
