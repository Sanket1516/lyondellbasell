import Link from "next/link";
import { AiLabel } from "@/components/Info";
import { fmtDate } from "@/lib/format";
import { CHECK_LABEL, COMPLEX_LOOPS, COMPLEX_STATIONS, EXPECTED_HOURS, EXPECTED_PATH, type Conformance, type InvoicePath } from "@/plantpay/processMining";
import { processTwin } from "@/plantpay/processService";
import { HERO_INVOICE } from "@/plantpay/history";
import { plantpay } from "@/plantpay/runtime";
import FlowDiagram from "./FlowDiagram";
import s from "./Process.module.css";

export const dynamic = "force-dynamic";
const CONF: Record<Conformance, { label: string; cls: string }> = {
  conforming: { label: "Follows the expected path", cls: s.pOk }, on_track: { label: "In progress, on the expected path", cls: s.pNeutral },
  rework: { label: "Rework loop", cls: s.pRework }, extra_steps: { label: "Extra steps", cls: s.pWarn },
};
const hrs = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hours`);
const stamp = (iso: string) => `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

function PathStrip({ stations, loops }: { stations: string[]; loops: InvoicePath["loops"] }) {
  const exp = EXPECTED_PATH as readonly string[];
  // Mark the station that closes a loop (the second visit) as rework; stations outside the expected path as extra
  const seen = new Set<string>();
  return (
    <div className={s.path} aria-label={stations.join(", then ")}>
      {stations.map((x, i) => {
        const back = seen.has(x) && loops.length > 0; seen.add(x);
        return (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span className={s.arrow} aria-hidden="true">→</span>}
            <span className={`${s.st} ${back ? s.stRework : !exp.includes(x) ? s.stExtra : ""}`}>{x}{back ? " (again)" : ""}</span>
          </span>
        );
      })}
    </div>
  );
}

export default async function ProcessTwin({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const sp = await searchParams;
  const e = plantpay();
  const a = processTwin(e);
  const demo = (e.integration.prepare("SELECT invoice_id FROM demo_invoices ORDER BY invoice_id").all() as { invoice_id: string }[]).map((r) => r.invoice_id);
  const pick = sp.invoice && a.paths.has(sp.invoice) ? sp.invoice : a.paths.has(HERO_INVOICE) ? HERO_INVOICE : demo[0];
  const sel = pick ? a.paths.get(pick) : undefined;
  const maxShare = Math.max(1, ...a.stations.map((x) => x.sharePct));
  const maxEx = Math.max(1, ...a.exceptions.map((x) => x.totalDays));

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Process-mining twin</h1>
      <div style={{ display: "flex", gap: 8, margin: "0 0 12px" }}><AiLabel kind="rule" /></div>
      <p className={s.lead}>The path every invoice actually took, rebuilt from the workflow event log and compared with the expected path <strong>{EXPECTED_PATH.join(" → ")}</strong>. It shows where the time goes, which teams invoices wait for, where work is sent back, and which exception types cost the most days. It describes the process, not people: a long wait points at a queue, not at a person.</p>

      <div className={s.tiles}>
        <div className={s.tile}><strong>{a.invoices.toLocaleString("en-IN")}</strong><span>invoices rebuilt ({a.completed.toLocaleString("en-IN")} paid, {a.open} open)</span></div>
        <div className={s.tile}><strong>{a.avgCycleDays} days</strong><span>average, median {a.medianCycleDays} days, invoice to now or payment</span></div>
        <div className={s.tile}><strong>{a.conformingPct.toFixed(0)}%</strong><span>followed the expected path with no extra step</span></div>
        <div className={s.tile}><strong>{a.reworkPct.toFixed(0)}%</strong><span>had a rework loop ({a.reworkInvoices.toLocaleString("en-IN")} invoices)</span></div>
      </div>

      <h2 className={s.h2}>Flow of invoices between stations</h2>
      <p className={s.note}>Based on all {a.invoices.toLocaleString("en-IN")} invoices, as of {fmtDate(a.asOf.slice(0, 10))}. Pick a document to overlay its own path.</p>
      <div className={s.picker} role="navigation" aria-label="Pick an invoice to overlay">
        {demo.map((d) => <Link key={d} href={`/plantpay/process?invoice=${encodeURIComponent(d)}`} className={`${s.pick} ${d === pick ? s.pickOn : ""}`}>{d}</Link>)}
      </div>
      <FlowDiagram stats={a.stations} edges={a.edges} selected={sel} />

      {sel ? (
        <>
          <h2 className={s.h2}>Path of {sel.invoiceId} compared with the expected path</h2>
          <div className={s.panel}>
            <p style={{ margin: "0 0 4px" }}><strong>Expected</strong></p>
            <PathStrip stations={[...EXPECTED_PATH]} loops={[]} />
            <p style={{ margin: "8px 0 4px" }}><strong>Actual</strong> <span className={`${s.pill} ${CONF[sel.conformance].cls}`}>{CONF[sel.conformance].label}</span></p>
            <PathStrip stations={sel.stations} loops={sel.loops} />
            <p style={{ margin: "6px 0" }}>{sel.completed ? `Paid ${fmtDate(sel.endedAt.slice(0, 10))}, ` : "Still open, "}{hrs(sel.cycleHours)} since it arrived on {fmtDate(sel.startedAt.slice(0, 10))}.</p>
            {sel.deviations.length > 0 ? <ul>{sel.deviations.map((d) => <li key={d}>{d}</li>)}</ul> : <p className={s.empty}>No deviation from the expected path.</p>}
            <div className={s.scroll}>
              <table className={s.table} style={{ marginTop: 8 }}>
                <thead><tr><th>Station</th><th>State</th><th>From</th><th>To</th><th className={s.num}>Time</th></tr></thead>
                <tbody>
                  {sel.segments.map((g, i) => (
                    <tr key={i}><td>{g.station}</td><td>{g.phase === "working" ? "Being worked" : "Waiting"}{g.open ? " (still open)" : ""}</td><td>{stamp(g.from)}</td><td>{stamp(g.to)}</td><td className={s.num}>{hrs(g.hours)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sel.exceptions.length > 0 && (
              <>
                <p style={{ margin: "10px 0 4px" }}><strong>Exceptions on this invoice</strong></p>
                <ul>{sel.exceptions.map((x, i) => <li key={i}>{CHECK_LABEL[x.check] ?? x.check}, sent to {x.department}: {x.open ? `still open after ${hrs(x.hours)}` : `resolved after ${hrs(x.hours)}`}</li>)}</ul>
              </>
            )}
          </div>
        </>
      ) : <p className={s.empty}>No workflow events were found for the demo documents yet.</p>}

      <h2 className={s.h2}>Where the time is spent</h2>
      <p className={s.note}>Time is split into waiting (handed over, not yet picked up, or finished and not yet passed on) and being worked. Targets are an assumption for the expected path, not a measured service level.</p>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>Station</th><th className={s.num}>Invoices</th><th className={s.num}>Visits</th><th className={s.num}>Waiting (days)</th><th className={s.num}>Worked (days)</th><th className={s.num}>Avg per visit</th><th className={s.num}>Target per visit</th><th>Share of all time</th></tr></thead>
          <tbody>
            {a.stations.map((x) => (
              <tr key={x.station}>
                <td>{x.station}</td><td className={s.num}>{x.invoices.toLocaleString("en-IN")}</td><td className={s.num}>{x.visits.toLocaleString("en-IN")}</td>
                <td className={s.num}>{(x.waitHours / 24).toFixed(0)}</td><td className={s.num}>{(x.workHours / 24).toFixed(0)}</td>
                <td className={s.num}>{hrs(x.avgHoursPerVisit)}</td><td className={s.num}>{EXPECTED_HOURS[x.station] !== undefined ? hrs(EXPECTED_HOURS[x.station]) : "none, not on the expected path"}</td>
                <td><span className={s.bar} style={{ width: `${(x.sharePct / maxShare) * 110}px` }} /> {x.sharePct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.cols} style={{ marginTop: 14 }}>
        <div className={s.panel}>
          <h3>Bottleneck departments</h3>
          <p className={s.note}>Departments with at least 3 visits, ranked by average time an invoice stays per visit.</p>
          {a.bottlenecks.length === 0 ? <p className={s.empty}>Not enough visits to rank departments.</p> : <ol style={{ margin: 0, paddingLeft: 20 }}>{a.bottlenecks.map((b) => <li key={b.station}><strong>{b.station}</strong>: {hrs(b.avgHoursPerVisit)} per visit over {b.visits.toLocaleString("en-IN")} visits, {(b.waitHours / Math.max(1, b.totalHours) * 100).toFixed(0)}% of it waiting.</li>)}</ol>}
        </div>
        <div className={s.panel}>
          <h3>Overly complex workflows</h3>
          <p className={s.note}>More than {COMPLEX_STATIONS} stations, or {COMPLEX_LOOPS} or more rework loops. {a.complexCount} invoice{a.complexCount === 1 ? "" : "s"} qualif{a.complexCount === 1 ? "ies" : "y"}; the 10 most complex are listed.</p>
          {a.complex.length === 0 ? <p className={s.empty}>No invoice crosses the complexity threshold.</p> : <ul>{a.complex.map((c) => <li key={c.invoiceId}><Link className="mono" href={`/plantpay/process?invoice=${encodeURIComponent(c.invoiceId)}`}>{c.invoiceId}</Link>: {c.why}, {c.cycleDays} days</li>)}</ul>}
        </div>
      </div>

      <h2 className={s.h2}>Rework loops</h2>
      <p className={s.note}>A loop is work that returns to a station it already left, for example AP review → Procurement → AP review. Extra days is the time spent on the detour.</p>
      {a.loops.length === 0 ? <p className={s.empty}>No rework loops were found.</p> : (
        <div className={s.scroll}>
          <table className={s.table}>
            <thead><tr><th>Loop</th><th>Detour through</th><th className={s.num}>Invoices</th><th className={s.num}>Times</th><th className={s.num}>Days on the detour</th></tr></thead>
            <tbody>{a.loops.map((l) => <tr key={l.sequence}><td>{l.sequence}</td><td>{l.via}</td><td className={s.num}>{l.invoices}</td><td className={s.num}>{l.occurrences}</td><td className={s.num}>{l.extraDays}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <h2 className={s.h2}>Exception types causing the most delay</h2>
      <p className={s.note}>Time from an exception being raised to it being resolved. Exceptions still open are counted up to {fmtDate(a.asOf.slice(0, 10))} and shown separately.</p>
      {a.exceptions.length === 0 ? <p className={s.empty}>No exceptions were raised.</p> : (
        <div className={s.scroll}>
          <table className={s.table}>
            <thead><tr><th>Exception type</th><th>Usually sent to</th><th className={s.num}>Raised</th><th className={s.num}>Still open</th><th className={s.num}>Average days open</th><th className={s.num}>Total days</th><th>Share of delay</th></tr></thead>
            <tbody>{a.exceptions.map((x) => (
              <tr key={x.check}><td>{CHECK_LABEL[x.check] ?? x.check}</td><td>{x.department}</td><td className={s.num}>{x.count}</td><td className={s.num}>{x.open}</td><td className={s.num}>{x.avgDays}</td><td className={s.num}>{x.totalDays}</td>
                <td><span className={s.bar} style={{ width: `${(x.totalDays / maxEx) * 110}px` }} /> {x.sharePct.toFixed(0)}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <h2 className={s.h2}>Path variants</h2>
      <p className={s.note}>Every distinct path, most common first. The expected path is {EXPECTED_PATH.join(" → ")}.</p>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>Path</th><th>Compared with expected</th><th className={s.num}>Invoices</th><th className={s.num}>Share</th><th className={s.num}>Paid</th><th className={s.num}>Average days</th><th>Example</th></tr></thead>
          <tbody>
            {a.variants.map((v) => (
              <tr key={v.key}>
                <td>{v.key}</td><td><span className={`${s.pill} ${CONF[v.conformance].cls}`}>{CONF[v.conformance].label}</span></td>
                <td className={s.num}>{v.invoices.toLocaleString("en-IN")}</td><td className={s.num}>{v.sharePct.toFixed(1)}%</td><td className={s.num}>{v.completed.toLocaleString("en-IN")}</td><td className={s.num}>{v.avgCycleDays}</td>
                <td><Link className="mono" href={`/plantpay/process?invoice=${encodeURIComponent(v.example)}`}>{v.example}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
