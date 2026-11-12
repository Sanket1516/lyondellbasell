import Link from "next/link";
import { notFound } from "next/navigation";
import { plantpay } from "@/plantpay/runtime";
import { supplierTable } from "@/predict/service";
import { PRIORITY_NOTE } from "@/predict/supplier";
import { ScoreRows, pct } from "../../PredictParts";
import s from "../../Plantpay.module.css";
import p from "../../Predict.module.css";

export const dynamic = "force-dynamic";

export default async function SupplierDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const t = supplierTable(plantpay());
  if ("error" in t) return (<><Link href="/plantpay/suppliers" className={s.back}>Back to suppliers</Link><h1>{id}</h1><div className={s.banner} role="status"><strong>Unavailable.</strong> {t.error}</div></>);
  const f = t.find((x) => x.vendorId === id);
  if (!f) notFound();
  const k = f.scores;
  return (
    <>
      <Link href="/plantpay/suppliers" className={s.back}>Back to suppliers</Link>
      <h1 style={{ marginBottom: 6 }}>{f.name}</h1>
      <div className={s.meta}><span>Supplier <b>{f.vendorId}</b></span><span>Relationship <b>{Math.round(f.tenureMonths)} months</b></span><span>Purchase orders <b>{f.poCount}</b></span><span>Invoices <b>{f.invoiceCount}</b></span><span>Payment terms <b>{f.paymentTermsDays} days</b></span></div>
      <p className={s.ok}>{PRIORITY_NOTE}</p>
      <div className={p.two}>
        <div className={s.panel}><ScoreRows title="Relationship strength" score={k.relationshipStrength} tone="good" /></div>
        <div className={s.panel}><ScoreRows title="Supply criticality" score={k.supplyCriticality} tone="crit" /></div>
        <div className={s.panel}><ScoreRows title="Supplier risk" score={k.supplierRisk} tone="risk" /></div>
      </div>
      <h2 className={s.h2}>What they supply</h2>
      <div className={p.scroll}>
        <table className={p.tbl}>
          <thead><tr><th>Material</th><th className={p.n}>Share of their spend</th><th className={p.n}>Criticality</th><th className={p.n}>Other suppliers</th></tr></thead>
          <tbody>{f.materials.map((m) => <tr key={m.code}><td>{m.description} <span className="mono">{m.code}</span></td><td className={p.n}>{pct(m.spendShare)}</td><td className={p.n}>{pct(m.criticality)}</td><td className={p.n}>{m.otherSuppliers === 0 ? "none (sole source)" : m.otherSuppliers}</td></tr>)}</tbody>
        </table>
      </div>
      {f.contractTerms && <><h2 className={s.h2}>Contract terms that matter for payment</h2>
        <ul className={p.actions}>
          <li>Contract <span className="mono">{f.contractTerms.contractNo}</span>{f.contractTerms.strictPaymentDate ? ": the payment date is fixed by the contract." : "."}</li>
          <li>{f.contractTerms.earlyPayDiscountPct ? `${f.contractTerms.earlyPayDiscountPct}% early-payment discount if paid within ${f.contractTerms.earlyPayWithinDays} days of the invoice date.` : "No early-payment discount."}</li>
          <li>{f.contractTerms.latePaymentInterestPctMonth}% a month interest on late payment.</li>
        </ul></>}
      <p className={s.lead} style={{ marginTop: 12 }}><Link href="/plantpay/predictions">See predictions for this supplier&apos;s invoices</Link></p>
    </>
  );
}
