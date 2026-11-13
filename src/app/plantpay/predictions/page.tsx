import Link from "next/link";
import { AiLabel } from "@/components/Info";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtInr } from "@/lib/format";
import { plantpay } from "@/plantpay/runtime";
import { DISCLAIMER } from "@/predict/predictor";
import { investigationQueue, modelSummary, predictionFor } from "@/predict/service";
import { PRIORITY_NOTE } from "@/predict/supplier";
import { Level, pct } from "../PredictParts";
import s from "../Plantpay.module.css";
import p from "../Predict.module.css";

export const dynamic = "force-dynamic";
const CHIP: Record<string, { kind: ChipKind; label: string }> = { pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" }, incomplete: { kind: "pending", label: "Incomplete" } };
const f = (x?: number) => (x == null ? "" : x.toFixed(3));

export default async function PredictionsHome() {
  const e = plantpay();
  const demoIds = (e.integration.prepare("SELECT invoice_id FROM demo_invoices ORDER BY invoice_id").all() as { invoice_id: string }[]).map((r) => r.invoice_id);
  const rows = demoIds.map((id) => ({ id, o: predictionFor(e, id, { factors: false }) }));
  let openIds: string[] = [];
  let queueError: string | undefined;
  try { openIds = e.connectors.finance.listInvoiceHeaders().filter((h) => String(h.status) !== "paid").map((h) => String(h.invoice_no)); } catch { queueError = "Finance DB is unavailable, so the queue cannot be built right now."; }
  const queue = queueError ? [] : investigationQueue(e, openIds, 10);
  const models = modelSummary();

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Predictions</h1>
      <div style={{ display: "flex", gap: 8, margin: "0 0 12px" }}><AiLabel kind="ai" /></div>
      <p className={s.lead}>Four trained models estimate, for each invoice, the chance of an exception, the likely root cause, the risk of late payment and the risk that the supplier disrupts supply. They add foresight to the deterministic checks; they never replace them.</p>
      <p className={p.disclaimer}>{DISCLAIMER}</p>

      <h2 className={s.h2}>Demo documents</h2>
      <div className={p.scroll}>
        <table className={p.tbl}>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Rules</th><th className={p.n}>Exception</th><th>Most likely cause</th><th className={p.n}>Late payment</th><th className={p.n}>Supplier disruption</th></tr></thead>
          <tbody>
            {rows.map(({ id, o }) => {
              if (!o.ok) return <tr key={id}><td><Link className="mono" href={`/plantpay/predictions/${encodeURIComponent(id)}`}>{id}</Link></td><td colSpan={6} className={p.small}>{o.message}</td></tr>;
              const x = o.prediction; const c = x.causes[0];
              return (
                <tr key={id}>
                  <td><Link className="mono" style={{ whiteSpace: "nowrap" }} href={`/plantpay/predictions/${encodeURIComponent(id)}`}>{id}</Link></td>
                  <td>{x.supplierName}</td>
                  <td><StatusChip kind={CHIP[x.rulesStatus].kind} label={CHIP[x.rulesStatus].label} /></td>
                  <td className={p.n}>{pct(x.exception.probability)} <Level band={x.exception.level} /></td>
                  <td>{c.label} <span className={p.small}>({pct(c.probabilityIfException)})</span> {c.evidenceStatus === "evidence_supported" ? <span className={p.verified}>evidence-supported</span> : <span className={p.unverified}>unverified prediction</span>}</td>
                  <td className={p.n}>{pct(x.delay.probability)} <Level band={x.delay.level} /></td>
                  <td className={p.n}>{pct(x.supplier.probability)} <Level band={x.supplier.level} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className={s.h2}>Investigation priority: open invoices</h2>
      <p className={s.lead}>Which open invoices a person should look at first, combining supplier scores with due date, value, pending approvals, early-payment discount and contract obligations. {PRIORITY_NOTE}</p>
      {queueError ? <div className={s.banner} role="status">{queueError}</div> : queue.length === 0 ? <p className={s.lead}>No open invoices.</p> : (
        <div className={p.scroll}>
          <table className={p.tbl}>
            <thead><tr><th>Invoice</th><th>Supplier</th><th className={p.n}>Total (₹)</th><th className={p.n}>Priority</th><th>Why</th></tr></thead>
            <tbody>{queue.map((q) => (
              <tr key={q.invoiceId}>
                <td><Link className="mono" style={{ whiteSpace: "nowrap" }} href={`/plantpay/predictions/${encodeURIComponent(q.invoiceId)}`}>{q.invoiceId}</Link></td>
                <td>{q.supplier}</td><td className={p.n}>{fmtInr(q.totalInr)}</td>
                <td className={p.n}>{q.priority} <span className={`${p.level} ${q.band === "Investigate first" ? p.High : q.band === "Investigate soon" ? p.Medium : p.Low}`}>{q.band}</span></td>
                <td className={p.small}>{q.explanation}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={s.h2}>How good are the models?</h2>
      <p className={s.lead}>Trained on {models.invoicesInHistory.toLocaleString("en-IN")} synthetic historical invoices and {models.suppliersInHistory} fictional suppliers. Each algorithm was fitted on the oldest 60% of the history, the best was chosen on the next 20%, and the numbers below are from the newest 20%, which no model saw. The same metrics are saved in <span className="mono">data/ml/metrics.json</span>.</p>
      <div className={p.two}>
        {models.tasks.map((t) => {
          const binary = t.test && "auc" in t.test;
          return (
            <div key={t.task} className={s.panel}>
              <h3>{t.title}</h3>
              <p className={p.small}>{t.question} {t.data.test.toLocaleString("en-IN")} test rows.</p>
              <div className={p.scroll}>
                <table className={p.tbl}>
                  <thead><tr><th>Algorithm</th>{binary ? <><th className={p.n}>AUC</th><th className={p.n}>F1</th><th className={p.n}>Log-loss</th></> : <><th className={p.n}>Accuracy</th><th className={p.n}>Macro F1</th><th className={p.n}>Top-2</th></>}</tr></thead>
                  <tbody>{t.comparison.map((c) => {
                    const m = c.test as unknown as Record<string, number>;
                    return <tr key={c.algorithm} className={c.chosen ? p.chosen : undefined}><td>{c.algorithm === "logistic" ? "Logistic regression" : c.algorithm === "forest" ? "Random forest" : "Gradient boosting"}{c.chosen ? " (chosen)" : ""}</td>{binary ? <><td className={p.n}>{f(m.auc)}</td><td className={p.n}>{f(m.f1)}</td><td className={p.n}>{f(m.logLoss)}</td></> : <><td className={p.n}>{f(m.accuracy)}</td><td className={p.n}>{f(m.macroF1)}</td><td className={p.n}>{f(m.top2Accuracy)}</td></>}</tr>;
                  })}</tbody>
                </table>
              </div>
              <p className={p.small}>Most influential inputs overall: {t.importance.slice(0, 4).map((i) => i.feature).join(", ")}.{!binary && ` Always guessing the commonest cause would be right ${pct((t.test as unknown as { baselineAccuracy: number }).baselineAccuracy)} of the time.`}</p>
            </div>
          );
        })}
      </div>
      <p className={s.lead} style={{ marginTop: 12 }}>See also <Link href="/plantpay/suppliers">supplier relationship scores</Link>.</p>
    </>
  );
}
