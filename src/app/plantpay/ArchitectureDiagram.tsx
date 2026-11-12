import s from "./Plantpay.module.css";

const SOURCES = [
  ["Procurement DB", "POs, contracts, prices"], ["Warehouse DB", "GRNs, stock"], ["Quality DB", "inspections"],
  ["Finance DB", "invoices, approvals"], ["Logistics DB", "gate, weighbridge"], ["Supplier DB", "identity, bank details"],
];

/** The PlantPay flow: six source systems, secure integration layer, intelligence engine, unified dashboard. Drawn as inline SVG so it follows the theme. */
export default function ArchitectureDiagram() {
  return (
    <div className={s.diagramWrap}>
      <svg className={s.diagram} viewBox="0 0 980 360" role="img" aria-label="PlantPay architecture: six source databases feed a read-only integration layer, then the intelligence engine, then the unified dashboard.">
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" className={s.dSub} /></marker></defs>
        <text x="10" y="18" className={s.dHead}>SOURCE SYSTEMS (one SQLite file each)</text>
        {SOURCES.map(([name, sub], i) => (
          <g key={name} transform={`translate(10 ${28 + i * 54})`}>
            <rect width="178" height="44" rx="6" className={s.dBox} />
            <text x="10" y="19" className={s.dText}>{name}</text>
            <text x="10" y="34" className={s.dSub}>{sub}</text>
            <path d="M178 22 H 222" className={s.dArrow} markerEnd="url(#arr)" />
          </g>
        ))}
        <text x="232" y="18" className={s.dHead}>SECURE INTEGRATION LAYER</text>
        <rect x="232" y="28" width="206" height="320" rx="8" className={s.dBoxHot} />
        {["6 read-only connectors", "Canonical data model", "REST facade + API keys", "Event stream (outbox)", "Request log to audit trail", "Outage handling"].map((t, i) => (
          <g key={t}><rect x="244" y={40 + i * 50} width="182" height="38" rx="5" className={s.dBox} /><text x="254" y={63 + i * 50} className={s.dText}>{t}</text></g>
        ))}
        <path d="M438 188 H 482" className={s.dArrow} markerEnd="url(#arr)" />
        <text x="492" y="18" className={s.dHead}>PLANTPAY INTELLIGENCE ENGINE</text>
        <rect x="492" y="28" width="236" height="320" rx="8" className={s.dBoxHot} />
        {[["Matching rules", "3-way + quality + weighbridge"], ["Risk detection", "warnings for human review"], ["Explain + predict", "root cause, counterfactual"], ["RAG", "contracts and policies, cited"], ["Workflow", "route, tasks, re-match on events"], ["Hash-chained audit trail", "tamper evident"]].map(([t, sub], i) => (
          <g key={t}><rect x="504" y={40 + i * 50} width="212" height="38" rx="5" className={s.dBox} /><text x="514" y={57 + i * 50} className={s.dText}>{t}</text><text x="514" y={71 + i * 50} className={s.dSub}>{sub}</text></g>
        ))}
        <path d="M728 188 H 772" className={s.dArrow} markerEnd="url(#arr)" />
        <text x="782" y="18" className={s.dHead}>UNIFIED DASHBOARD</text>
        <rect x="782" y="28" width="188" height="320" rx="8" className={s.dBoxHot} />
        {["Invoice status", "Discrepancies", "Approvals", "Audit reports", "Data-sources panel", "Evidence drill-down"].map((t, i) => (
          <g key={t}><rect x="794" y={40 + i * 50} width="164" height="38" rx="5" className={s.dBox} /><text x="804" y={63 + i * 50} className={s.dText}>{t}</text></g>
        ))}
      </svg>
    </div>
  );
}
