import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtInr } from "@/lib/format";
import { resolve } from "@/plantpay/resolver";
import { plantpay } from "@/plantpay/runtime";
import { STATUS_LABEL, simulate } from "@/plantpay/simulate";
import { SOURCE_META } from "@/plantpay/sources/schemas";
import s from "../../../Plantpay.module.css";

export const dynamic = "force-dynamic";
const CHIP: Record<string, ChipKind> = { pass: "approve", review: "flag", block: "block", incomplete: "pending" };

export default async function ExceptionDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sim?: string }> }) {
  const id = decodeURIComponent((await params).id);
  const { sim } = await searchParams;
  const e = plantpay();
  const { result, bundle } = e.compute(id);
  if (!bundle && !result.unavailable.length) notFound();
  const base = `/plantpay/invoices/${encodeURIComponent(id)}/exceptions`;
  if (!bundle) {
    return (
      <>
        <Link href={`/plantpay/invoices/${encodeURIComponent(id)}`} className={s.back}>Back to invoice</Link>
        <h1>{id}</h1>
        <div className={s.banner} role="status"><strong>Source unavailable:</strong> {result.unavailable.map((u) => SOURCE_META[u].label).join(", ")}. {result.summary} Exceptions cannot be explained until the invoice can be read.</div>
      </>
    );
  }
  const report = resolve(bundle, result);
  const simulation = sim ? simulate(e, id, sim === "all" ? "all" : { resolutionId: sim }) : undefined;
  const anySimulatable = report.resolutions.some((r) => r.corrections.length > 0);

  return (
    <>
      <Link href={`/plantpay/invoices/${encodeURIComponent(id)}`} className={s.back}>Back to invoice</Link>
      <h1 style={{ marginBottom: 6 }}>Exception resolution for {id} <StatusChip kind={CHIP[result.status]} label={STATUS_LABEL[result.status]} /></h1>
      <p className={s.lead}>For each problem: what is wrong, the most likely cause and the records it rests on, who can fix it, and what would make the invoice pass. Causes are rule-based. A cause is marked <em>supported by evidence</em> only when a record in a source system backs it; otherwise it is an <em>unverified prediction</em>.</p>
      {result.unavailable.length > 0 && <div className={s.banner} role="status"><strong>Source unavailable:</strong> {result.unavailable.map((u) => SOURCE_META[u].label).join(", ")}. Explanations that need it are limited.</div>}

      {report.resolutions.length === 0 ? (
        <div className={s.ok}>{result.status === "pass" ? "No exceptions: every evaluated check agrees across the sources." : "No explainable exceptions are open on this invoice."}</div>
      ) : (
        <>
          {anySimulatable && <p><Link className={`${s.btn} ${s.btnPrimary}`} style={{ textDecoration: "none", display: "inline-block" }} href={`${base}?sim=all#simulation`}>Simulate all recommended corrections</Link></p>}
          {report.resolutions.map((r, i) => (
            <section key={r.id} className={s.disc} aria-labelledby={`r${i}`}>
              <h3 id={`r${i}`}>{i + 1}. {r.problem}</h3>
              <div className={s.rootCause} role="note">
                <span className={s.rootIcon} aria-hidden="true">!</span>
                <p><strong>Root cause:</strong> {r.evidenceStatus === "supported_by_evidence" ? r.rootCause : <span className={s.unverified}>{r.rootCause}</span>}
                  <span className={s.tag}>{r.evidenceStatus === "supported_by_evidence" ? "supported by evidence" : "unverified prediction"}</span>
                  <span className={s.tag}>{r.severity === "block" ? "blocks payment" : r.severity === "review" ? "warning for human review" : "needs a fix before approval"}</span></p>
              </div>
              <p style={{ marginBottom: 2 }}><strong>Evidence</strong></p>
              {r.evidence.length === 0 ? <p className={s.srcMeta}>No supporting record was found, which is why this is only a prediction.</p> : (
                <ul>{r.evidence.map((x, k) => <li key={k}>{x.text} <span className={s.tag}>{SOURCE_META[x.source].label.replace(" DB", "")}</span></li>)}</ul>
              )}
              <p className={s.fixLine}><b>Responsible:</b> {r.responsible.department} · {r.responsible.role}{r.responsible.person ? ` (${r.responsible.person})` : ""}</p>
              <p className={s.fixLine}><b>Recommended correction:</b> {r.correction}</p>
              <div className={s.cfBlock}><b>What would make this pass</b>{r.counterfactual}</div>
              {r.corrections.length > 0
                ? <Link className={s.btn} style={{ textDecoration: "none", display: "inline-block" }} href={`${base}?sim=${encodeURIComponent(r.id)}#simulation`}>Simulate this correction</Link>
                : <p className={s.srcMeta}>Cannot be simulated: {r.notSimulatableReason ?? "a person has to supply information first."}</p>}
            </section>
          ))}
        </>
      )}

      {report.normalisations.length > 0 && (
        <>
          <h2 className={s.h2}>Normalised, not a mismatch</h2>
          {report.normalisations.map((n) => (
            <div key={n.lineNo} className={s.warn}>
              <div>{n.text}</div>
              <ul>{n.evidence.map((x, k) => <li key={k}>{x.text} <span className={s.tag}>{SOURCE_META[x.source].label.replace(" DB", "")}</span></li>)}</ul>
            </div>
          ))}
        </>
      )}

      {simulation && (
        <div id="simulation">
          <h2 className={s.h2}>Simulated correction</h2>
          {simulation.notSimulatable ? <div className={s.banner} role="status">{simulation.notSimulatable}</div> : (
            <div className={s.panel}>
              <p style={{ fontSize: "1.05rem" }}>
                <StatusChip kind={CHIP[simulation.before.status]} label={STATUS_LABEL[simulation.before.status]} /> &nbsp;→&nbsp; <StatusChip kind={CHIP[simulation.after.status]} label={STATUS_LABEL[simulation.after.status]} />
                &nbsp; <strong>{simulation.headline}</strong>
              </p>
              <h3>What was changed (in a sandbox copy)</h3>
              <ol>{simulation.steps.map((st, k) => <li key={k}>{st.description}</li>)}</ol>
              {simulation.after.issues.length > 0 ? <><h3>Still open after the correction</h3><ul>{simulation.after.issues.map((x, k) => <li key={k}>{x}</li>)}</ul></> : <p className={s.pass}>Every evaluated check now agrees across the sources.</p>}
              <p className={s.srcMeta}>This ran on a throw-away copy of the six source databases, using the same matching and event-driven re-matching as the live system. Nothing in the live data changed{result.meta ? `, so ${id} (₹${fmtInr(result.meta.totalInr)}) still shows its real status` : ""}.</p>
              <Link href={base}>Clear the simulation</Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}
