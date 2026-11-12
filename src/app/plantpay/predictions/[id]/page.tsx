import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import { plantpay } from "@/plantpay/runtime";
import { DISCLAIMER, lcFirst } from "@/predict/predictor";
import { predictionFor } from "@/predict/service";
import { PRIORITY_NOTE } from "@/predict/supplier";
import { FactorList, Level, Meter, ScoreRows, pct } from "../../PredictParts";
import s from "../../Plantpay.module.css";
import p from "../../Predict.module.css";

export const dynamic = "force-dynamic";
const CHIP: Record<string, { kind: ChipKind; label: string }> = { pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" }, incomplete: { kind: "pending", label: "Incomplete" } };

export default async function PredictionDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const e = plantpay();
  const o = predictionFor(e, id);
  if (!o.ok && o.status === 404) notFound();
  if (!o.ok) {
    return (<><Link href="/plantpay/predictions" className={s.back}>Back to predictions</Link><h1>{id}</h1><div className={s.banner} role="status"><strong>Predictions unavailable.</strong> {o.message}</div></>);
  }
  const x = o.prediction;
  const stored = e.stored(id);
  const topCause = x.causes[0];
  return (
    <>
      <Link href="/plantpay/predictions" className={s.back}>Back to predictions</Link>
      <h1 style={{ marginBottom: 6 }}>{id} <StatusChip kind={CHIP[x.rulesStatus].kind} label={`Rules: ${CHIP[x.rulesStatus].label}`} /></h1>
      <div className={s.meta}>
        <span>Supplier <b>{x.supplierName}</b></span>
        {stored?.meta && <><span>Total <b>₹{fmtInr(stored.meta.totalInr)}</b></span><span>Invoice date <b>{fmtDate(stored.meta.invoiceDate)}</b></span></>}
        <span>Due in <b>{x.delay.dueInDays} day{Math.abs(x.delay.dueInDays) === 1 ? "" : "s"}</b></span>
        <Link href={`/plantpay/invoices/${encodeURIComponent(id)}`}>Open the matching result</Link>
      </div>
      <p className={p.disclaimer}>{DISCLAIMER}</p>

      <div className={p.cards}>
        <div className={p.card}>
          <h3>Exception probability</h3><p className={p.q}>Will a person need to resolve something on this invoice?</p>
          <span className={p.big}>{pct(x.exception.probability)}</span><Level band={x.exception.level} />
          <Meter value={x.exception.probability * 100} band={x.exception.level} label="Exception probability" />
          <span className={p.small}>Alert threshold {pct(x.exception.threshold)}. {x.exception.model.algorithm}, AUC {x.exception.model.auc?.toFixed(2)} on held-out data.</span>
        </div>
        <div className={p.card}>
          <h3>Payment delay risk</h3><p className={p.q}>Will payment go past the due date?</p>
          <span className={p.big}>{pct(x.delay.probability)}</span><Level band={x.delay.level} />
          <Meter value={x.delay.probability * 100} band={x.delay.level} label="Delay risk" />
          <span className={p.small}>{x.delay.dueInDays >= 0 ? `${x.delay.dueInDays} days left.` : `${Math.abs(x.delay.dueInDays)} days overdue.`} {x.delay.model.algorithm}, AUC {x.delay.model.auc?.toFixed(2)}.</span>
        </div>
        <div className={p.card}>
          <h3>Supplier disruption risk</h3><p className={p.q}>Will {x.supplierName} disrupt supply within 90 days?</p>
          <span className={p.big}>{pct(x.supplier.probability)}</span><Level band={x.supplier.level} />
          <Meter value={x.supplier.probability * 100} band={x.supplier.level} label="Supplier risk" />
          <span className={p.small}>{x.supplier.model.algorithm}, AUC {x.supplier.model.auc?.toFixed(2)}, trained on {x.supplier.model.trainedOn}.</span>
        </div>
        <div className={p.card}>
          <h3>Investigation priority</h3><p className={p.q}>How soon should a person look at this?</p>
          <span className={p.big}>{x.priority.priority}</span><span className={p.small}> of 100</span><span className={`${p.level} ${x.priority.band === "Investigate first" ? p.High : x.priority.band === "Investigate soon" ? p.Medium : p.Low}`}>{x.priority.band}</span>
          <Meter value={x.priority.priority} band={x.priority.band === "Investigate first" ? "High" : x.priority.band === "Investigate soon" ? "Medium" : "Low"} label="Priority" />
          <span className={p.small}>Rule-based combination of supplier scores and invoice facts.</span>
        </div>
      </div>

      <h2 className={s.h2}>Likely root causes</h2>
      <p className={s.lead}>If an exception arises, these are the most likely causes according to the model ({x.causeModel.algorithm}, trained on {x.causeModel.trainedOn}). A cause is marked <span className={p.verified}>evidence-supported</span> only when a record in the six systems confirms it; otherwise it stays an <span className={p.unverified}>unverified prediction</span>, however probable it looks.</p>
      <div className={p.scroll}>
        <table className={p.tbl}>
          <thead><tr><th>Cause</th><th className={p.n}>If an exception occurs</th><th className={p.n}>Overall</th><th>Status</th><th>Evidence and main drivers</th></tr></thead>
          <tbody>
            {x.causes.map((c) => (
              <tr key={c.cause}>
                <td><strong>{c.label}</strong></td>
                <td className={p.n}>{pct(c.probabilityIfException)}</td>
                <td className={p.n}>{pct(c.overallProbability)}</td>
                <td>{c.evidenceStatus === "evidence_supported" ? <span className={p.verified}>evidence-supported</span> : <span className={p.unverified}>unverified prediction</span>}</td>
                <td>
                  {c.evidence.length > 0 ? <ul className={p.evl}>{c.evidence.map((t) => <li key={t}>{t}</li>)}</ul> : <span className={p.small}>No record confirms this cause for this invoice.</span>}
                  {c.factors.length > 0 && <div className={p.small} style={{ marginTop: 4 }}>Model drivers: {c.factors.map((f) => `${f.label.toLowerCase()} (${f.effectPoints >= 0 ? "+" : "−"}${Math.abs(f.effectPoints).toFixed(0)})`).join(", ")}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {topCause && x.exception.probability < x.exception.threshold && <p className={p.small}>The exception probability is below the alert threshold, so these causes are shown for completeness only.</p>}

      <h2 className={s.h2}>Top contributing factors</h2>
      <p className={p.small} style={{ marginBottom: 8 }}>SHAP-style attribution (sampled Shapley values) compared with a typical historical invoice. Red bars push the probability up, green bars pull it down; the numbers are percentage points.</p>
      <div className={p.two}>
        <div className={s.panel}><h3>Exception probability</h3><FactorList factors={x.exception.factors} /></div>
        <div className={s.panel}><h3>Payment delay risk</h3><FactorList factors={x.delay.factors} /></div>
        <div className={s.panel}><h3>Supplier disruption risk</h3><FactorList factors={x.supplier.factors} /></div>
        {topCause && <div className={s.panel}><h3>Leading cause: {lcFirst(topCause.label)}</h3><FactorList factors={topCause.factors} /></div>}
      </div>

      <h2 className={s.h2}>Supporting historical evidence</h2>
      <div className={p.two}>
        <div className={s.panel}>
          <h3>From the training history</h3>
          <ul className={p.hist}>{[...x.exception.history, ...x.delay.history, ...x.supplier.history].map((t) => <li key={t}>{t}</li>)}</ul>
          {x.exception.history.length + x.delay.history.length + x.supplier.history.length === 0 && <p className={p.small}>No comparable group in the history is large enough to quote.</p>}
        </div>
        <div className={s.panel}>
          <h3>From this plant&apos;s own records</h3>
          <ul className={p.hist}>{x.supplierEvidence.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>

      <h2 className={s.h2}>Supplier intelligence: {x.supplierName}</h2>
      <p className={p.small} style={{ marginBottom: 8 }}>Three separate scores. Relationship strength is how healthy the relationship is, criticality is how much a stoppage would hurt, and risk is how likely trouble is. One does not imply another. <Link href={`/plantpay/suppliers/${x.supplierId}`}>Full supplier profile</Link></p>
      <div className={p.two}>
        <div className={s.panel}><ScoreRows title="Relationship strength" score={x.supplier.scores.relationshipStrength} tone="good" /></div>
        <div className={s.panel}><ScoreRows title="Supply criticality" score={x.supplier.scores.supplyCriticality} tone="crit" /></div>
        <div className={s.panel}><ScoreRows title="Supplier risk" score={x.supplier.scores.supplierRisk} tone="risk" /></div>
      </div>

      <h2 className={s.h2}>Investigation priority</h2>
      <p>{x.priority.explanation}</p>
      <div className={p.scroll}>
        <table className={p.tbl}><thead><tr><th>Factor</th><th className={p.n}>Points</th><th>Why</th></tr></thead>
          <tbody>{x.priority.contributions.map((c) => <tr key={c.label}><td>{c.label}</td><td className={p.n}>{c.points.toFixed(1)}</td><td>{c.why}</td></tr>)}</tbody></table>
      </div>
      <p className={s.ok} style={{ marginTop: 10 }}>{PRIORITY_NOTE}</p>

      <h2 className={s.h2}>Recommended actions</h2>
      <ul className={p.actions}>{x.actions.map((a) => <li key={a}>{a}</li>)}</ul>
    </>
  );
}
