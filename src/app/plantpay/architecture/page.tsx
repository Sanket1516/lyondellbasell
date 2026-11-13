import Link from "next/link";
import s from "@/components/Info.module.css";
import { plantpay } from "@/plantpay/runtime";
import ArchitectureDiagram from "../ArchitectureDiagram";

export const dynamic = "force-dynamic";

export default function Architecture() {
  const health = plantpay().connectors.health();
  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Architecture</h1>
      <p className={s.prose}>Six department databases feed one read-only integration layer. Deterministic rules decide; trained models only predict and explain; people approve.</p>
      <ArchitectureDiagram />

      <h2 className={s.sec}>How data flows</h2>
      <ul className={s.prose}>
        <li><strong>Connect.</strong> Six read-only connectors (Procurement, Warehouse, Quality, Finance, Logistics, Supplier) turn each department&apos;s tables into one canonical invoice record.</li>
        <li><strong>Decide.</strong> Rule-based matching, contract and inventory checks and risk detectors run on that record. Every result lists the rule and the evidence behind it.</li>
        <li><strong>Explain and route.</strong> Models add predictions and the Root-Cause Resolver names an owner. A change in a source emits an event, and the affected invoices are re-matched.</li>
      </ul>

      <details className={s.det}>
        <summary>How the integration layer works</summary>
        <ul className={s.prose}>
          <li><strong>Connectors:</strong> one per source, read-only, each can be taken offline on its own. A missing source marks only the checks that need it as “source unavailable”.</li>
          <li><strong>Canonical data model:</strong> supplier, PO, goods receipt, inspection, weighbridge entry and invoice in one shape, whatever the source system calls them.</li>
          <li><strong>Event stream:</strong> a changed PO or receipt is written to an outbox; processing the queue re-matches only the invoices it touches.</li>
          <li><strong>REST facade:</strong> every call needs an API key or a clerk or approver session, and every request is logged to the audit trail. See the <Link href="/plantpay/api-docs">API reference</Link>.</li>
        </ul>
      </details>

      <details className={s.det}>
        <summary>Source health right now</summary>
        <ul className={s.prose}>
          {health.map((h) => <li key={h.id}>{h.label}: {h.status === "up" ? `healthy, ${h.records?.toLocaleString("en-IN")} records` : "unavailable (the rest of the pipeline continues)"}</li>)}
        </ul>
      </details>

      <details className={s.det} open>
        <summary>Scalability and production readiness</summary>
        <p className={s.prose}>The demo uses SQLite files so it runs on a laptop. Nothing in the design depends on that.</p>
        <ul className={s.prose}>
          <li><strong>Database swap:</strong> connectors sit behind an interface; moving each source to PostgreSQL changes the connector, not the rules or screens.</li>
          <li><strong>Horizontal scaling:</strong> matching is a pure function of one invoice&apos;s canonical record, and re-matching is event-driven, so workers can process the queue in parallel.</li>
          <li><strong>Authentication:</strong> the demo uses signed sessions and API keys; production would put SSO and per-role scopes in front of the same checks.</li>
          <li><strong>Audit compliance:</strong> the hash-chained trail records who, role, time, outcome and comment for every decision; production would also anchor the chain head in write-once storage.</li>
          <li><strong>Connector extensibility:</strong> a new source is one connector plus a mapping to the canonical model; the engine does not change.</li>
        </ul>
        <p className={s.note}>Caching: trained models are saved to disk and loaded once per process, and each invoice&apos;s evaluation is stored, so repeat page loads read results instead of recomputing them.</p>
      </details>
    </>
  );
}
