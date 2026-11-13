import Link from "next/link";
import { AiLabel } from "@/components/Info";
import { plantpay } from "@/plantpay/runtime";
import { supplierTable } from "@/predict/service";
import { Level } from "../PredictParts";
import s from "../Plantpay.module.css";
import p from "../Predict.module.css";

export const dynamic = "force-dynamic";
const SORTS = { criticality: "Supply criticality", risk: "Supplier risk", relationship: "Relationship strength", name: "Name" } as const;
type SortKey = keyof typeof SORTS;

export default async function SuppliersHome({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const sp = await searchParams;
  const sort: SortKey = sp.sort && sp.sort in SORTS ? (sp.sort as SortKey) : "criticality";
  const e = plantpay();
  const t = supplierTable(e);
  if ("error" in t) return (<><h1>Supplier relationship scores</h1><div className={s.banner} role="status"><strong>Unavailable.</strong> {t.error}</div></>);
  const rows = [...t].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "risk" ? b.scores.supplierRisk.score - a.scores.supplierRisk.score : sort === "relationship" ? b.scores.relationshipStrength.score - a.scores.relationshipStrength.score : b.scores.supplyCriticality.score - a.scores.supplyCriticality.score);
  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Supplier relationship scores</h1>
      <div style={{ display: "flex", gap: 8, margin: "0 0 12px" }}><><AiLabel kind="rule" /> <AiLabel kind="ai" /></></div>
      <p className={s.lead}>Three separate scores for each supplier, calculated from the six department systems: how strong the relationship is, how critical the supplier is to production, and how risky the supplier is. A supplier can be strong, critical and risky at once, so they are never merged into one number.</p>
      <p className={s.ok}>Scores order human review work. They do not set the payment order: final payment order must respect contracts and financial policy.</p>
      <p className={`${p.small} ${p.sort}`}>Sort by: {(Object.keys(SORTS) as SortKey[]).map((k) => k === sort ? <strong key={k} style={{ marginRight: 12 }}>{SORTS[k]}</strong> : <Link key={k} href={`/plantpay/suppliers?sort=${k}`}>{SORTS[k]}</Link>)}</p>
      <div className={p.scroll}>
        <table className={p.tbl}>
          <thead><tr><th>Supplier</th><th className={p.n}>Relationship strength</th><th className={p.n}>Supply criticality</th><th className={p.n}>Supplier risk</th><th>Main materials</th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.vendorId}>
                <td><Link href={`/plantpay/suppliers/${f.vendorId}`}>{f.name}</Link><br /><span className={p.small}>{f.vendorId}, {f.poCount} POs, {Math.round(f.tenureMonths)} months</span></td>
                <td className={p.n}>{f.scores.relationshipStrength.score} <Level band={f.scores.relationshipStrength.band} tone="good" /></td>
                <td className={p.n}>{f.scores.supplyCriticality.score} <Level band={f.scores.supplyCriticality.band} tone="crit" /></td>
                <td className={p.n}>{f.scores.supplierRisk.score} <Level band={f.scores.supplierRisk.band} /></td>
                <td className={p.small}>{f.materials.slice(0, 2).map((m) => `${m.description}${m.otherSuppliers === 0 ? " (sole source)" : ""}`).join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.lead} style={{ marginTop: 12 }}>Predicted disruption risk from the trained model is shown with each invoice on the <Link href="/plantpay/predictions">predictions page</Link>.</p>
    </>
  );
}
