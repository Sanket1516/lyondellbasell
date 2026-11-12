import Link from "next/link";
import { StatusChip } from "@/components/ui";
import { graphFor } from "@/plantpay/risk";
import { plantpay } from "@/plantpay/runtime";
import GraphView from "./GraphView";
import s from "../Plantpay.module.css";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { shared_bank_account: "Shared bank account", shared_address: "Shared address", shared_tax_id: "Shared tax ID", approver_pattern: "Approver pattern" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ focus?: string; all?: string }> }) {
  const { focus, all } = await searchParams;
  const graph = graphFor(plantpay().connectors);
  if (!graph) {
    return (
      <div>
        <h1>Relationship graph</h1>
        <p className={s.evDown}>Source unavailable: the Supplier or Finance database is not reachable, so the graph cannot be drawn. Bring the source back on the PlantPay page and reload.</p>
        <p><Link href="/plantpay">Back to PlantPay</Link></p>
      </div>
    );
  }
  const clustered = [...new Set(graph.clusters.flatMap((c) => c.vendorIds))];
  const focusVendors = focus ? [focus] : clustered;
  const view = graph.toView({ focusVendors, includeTransactions: !!focus || all === "1" });
  const name = (id: string) => graph.nodes.get(`vendor:${id}`)?.label ?? id;
  return (
    <div>
      <h1>Relationship graph</h1>
      <p className={s.lead}>Vendors, bank accounts, addresses, approvers, purchase orders and invoices, linked by what the source databases say. It looks for patterns <em>across</em> records. Everything it surfaces is a <strong>warning, not proof</strong>: group companies legitimately share accounts and addresses. Attributes of a single supplier&apos;s own record are on the invoice page under Vendor red flags.</p>
      <p className={s.tabs}>
        <Link className={`${s.tab} ${!focus ? s.tabOn : ""}`} href="/plantpay/graph">Linked vendors</Link>
        {focus && <span className={`${s.tab} ${s.tabOn}`}>Around {name(focus)}</span>}
        <Link className={s.tab} href="/plantpay">Back to PlantPay</Link>
      </p>

      <GraphView nodes={view.nodes} edges={view.edges} findings={graph.findings.map((f) => ({ kind: f.kind, nodeIds: f.nodeIds, confirmedLegitimate: f.confirmedLegitimate, text: f.text }))} />

      <h2 className={s.h2}>Clusters</h2>
      {graph.clusters.length === 0 ? <p className={s.srcMeta}>No vendors are linked through a shared bank account, address or tax ID.</p> : (
        <div className={s.cols}>
          {graph.clusters.map((c) => (
            <section key={c.id} className={s.panel}>
              <h3>{c.vendorIds.map(name).join(" and ")} <StatusChip kind={c.allConfirmedLegitimate ? "pending" : "flag"} label={c.allConfirmedLegitimate ? "Confirmed group" : "To confirm"} /></h3>
              <ul>{c.links.map((l, i) => <li key={i}><strong>{KIND[l.kind]}:</strong> {l.text}</li>)}</ul>
              <p className={s.srcMeta}>Vendors: {c.vendorIds.map((v) => <span key={v}><Link href={`/plantpay/graph?focus=${encodeURIComponent(v)}`}>{name(v)}</Link> </span>)}</p>
              <p className={s.riskLabel}>warning, not proof</p>
            </section>
          ))}
        </div>
      )}

      <h2 className={s.h2}>What the graph found</h2>
      {graph.findings.length === 0 ? <p className={s.srcMeta}>No cross-record patterns.</p> : (
        <div className={s.vscroll}>
          <table className={s.table}>
            <thead><tr><th>Pattern</th><th>Detail</th><th>Status</th></tr></thead>
            <tbody>{graph.findings.map((f, i) => <tr key={i}><td>{KIND[f.kind]}</td><td>{f.text}</td><td>{f.confirmedLegitimate ? "Confirmed legitimate" : "Warning, not proof"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
