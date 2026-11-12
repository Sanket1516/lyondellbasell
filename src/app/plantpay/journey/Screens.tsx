"use client";
// The nine journey screens. Each one only renders its own slice of the journey document; it never calls the engine.
import { useState, type ReactNode } from "react";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtInr } from "@/lib/format";
import type { JourneyData, JourneyStepData, Snapshot } from "@/plantpay/journey/types";
import PassportView from "@/app/supplier/passport/PassportView";
import ArchitectureDiagram from "../ArchitectureDiagram";
import FlowDiagram from "../process/FlowDiagram";
import { EXPECTED_HOURS } from "@/plantpay/processMining";
import j from "./Journey.module.css";

const CHIP: Record<string, { kind: ChipKind; label: string }> = {
  pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" }, incomplete: { kind: "pending", label: "Incomplete" },
};
const inr = (n: number) => `₹${fmtInr(n, Number.isInteger(n) ? 0 : 2)}`;
const lakh = (n: number) => `₹${(n / 100000).toFixed(2)} lakh`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const hrs = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hours`);

export function Feature({ children }: { children: ReactNode }) { return <span className={j.feature}>{children}</span>; }
const Status = ({ s }: { s: string }) => <StatusChip kind={(CHIP[s] ?? CHIP.incomplete).kind} label={(CHIP[s] ?? CHIP.incomplete).label} />;
function Card({ title, badge, children, tone }: { title: string; badge?: string; children: ReactNode; tone?: "warn" | "ok" | "bad" }) {
  return (
    <section className={`${j.card} ${tone ? j[tone] : ""}`}>
      <header className={j.cardHead}><h3>{title}</h3>{badge && <Feature>{badge}</Feature>}</header>
      {children}
    </section>
  );
}
const Warn = ({ label }: { label: string }) => <span className={j.warnLabel}>{label}</span>;
const List = ({ items }: { items: string[] }) => <ul className={j.list}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

// ------------------------------------------------------------------ 1
function Screen1({ d }: { d: JourneyStepData[1] }) {
  const t = d.counts;
  return (
    <>
      <div className={j.tiles}>
        {([["Invoices", t.total], ["Demo documents", t.demo], ["Pass", t.pass], ["Review", t.review], ["Block", t.block], ["Incomplete", t.incomplete]] as const).map(([k, v]) => <div key={k} className={j.tile}><strong>{v.toLocaleString("en-IN")}</strong><span>{k}</span></div>)}
      </div>
      <Card title="Architecture" badge="Feature: Six-source integration"><ArchitectureDiagram /></Card>
      <Card title="Source health">
        <div className={j.sources}>
          {d.sources.map((s) => (
            <div key={s.id} className={`${j.src} ${s.status === "down" ? j.srcDown : ""}`}>
              <strong><span className={`${j.dot} ${s.status === "down" ? j.dotDown : ""}`} aria-hidden="true" /> {s.label}</strong>
              <span>{s.holds}</span>
              <span>{s.status === "up" ? `Healthy, ${s.records?.toLocaleString("en-IN") ?? 0} records` : "Unavailable"}</span>
              <span>Last sync {s.lastSync ? `${s.lastSync.slice(0, 10)} ${s.lastSync.slice(11, 16)} UTC` : "never"}</span>
            </div>
          ))}
        </div>
      </Card>
      <div className={j.two}>
        <Card title="Audit trail" badge="Feature: Hash-Chained Audit Trail">
          <p className={d.integrity.ok ? j.okText : j.badText}>{d.integrity.ok ? `Intact: ${d.integrity.auditEntries.toLocaleString("en-IN")} audit entries and ${d.integrity.workflowEvents.toLocaleString("en-IN")} workflow events verified.` : "Integrity check failed. See the audit page."}</p>
          <h4 className={j.sub}>Open work by department</h4>
          <List items={d.openWork.map((w) => `${w.department}: ${w.open}`)} />
        </Card>
        <Card title="Story key">
          <p className={j.small}>The brief's names do not exist in the seeded data. These real demo records play each part.</p>
          <table className={j.tbl}><thead><tr><th>Story</th><th>Record</th><th>Supplier</th></tr></thead>
            <tbody>{d.story.map((r) => <tr key={r.story}><td>{r.story}</td><td className="mono">{r.actual}</td><td>{r.supplier}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 2
function Screen2({ d }: { d: JourneyStepData[2] }) {
  const v = d.invoice;
  return (
    <div>
      <Card title="Invoice received">
        <p className={j.metaLine}><b className="mono">{v.id}</b> from <b>{v.supplier}</b>, PO <span className="mono">{v.po}</span>, total <b>{inr(v.totalInr)}</b></p>
        {v.file && <p className={j.small}>Document: <span className="mono">{v.file.replace("demo:", "")}</span>, extracted into {v.lines.length} lines.</p>}
        <table className={j.tbl}><thead><tr><th>Line</th><th>Item</th><th className={j.num}>Qty</th><th className={j.num}>Unit price</th><th className={j.num}>Amount</th></tr></thead>
          <tbody>{v.lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description}</td><td className={j.num}>{l.qty} {l.uom}</td><td className={j.num}>{inr(l.unitPrice)}</td><td className={j.num}>{inr(l.amount)}</td></tr>)}</tbody></table>
      </Card>
      <Card title="What the supplier sees" badge="Feature: Payment Readiness Passport">
        <p className={j.small}>{d.supplierNote}</p>
        <PassportView p={d.passport} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ 3
function SnapshotView({ s, title }: { s: Snapshot; title: string }) {
  return (
    <div className={j.snap}>
      <h4 className={j.sub}>{title}</h4>
      <Status s={s.status} />
      <p className={j.small}>{s.summary}</p>
      {s.notEvaluated.length > 0 && <p className={j.badText}>Not evaluated: {s.notEvaluated.join(", ")} (source unavailable: {s.unavailable.join(", ")})</p>}
    </div>
  );
}
function Screen3({ d }: { d: JourneyStepData[3] }) {
  const [phase, setPhase] = useState<"online" | "offline" | "restored">("online");
  const o = d.outage;
  const shown = phase === "offline" ? o.offline : phase === "restored" ? o.restored : o.online;
  return (
    <>
      <Card title={`Evidence for ${d.invoiceId} from the six systems`} badge="Feature: Six-source integration">
        <div className={j.sources}>
          {d.evidence.map((e) => (
            <div key={e.source} className={`${j.src} ${phase === "offline" && e.source === o.source ? j.srcDown : ""}`}>
              <strong><span className={`${j.dot} ${phase === "offline" && e.source === o.source ? j.dotDown : ""}`} aria-hidden="true" /> {e.label}</strong>
              {phase === "offline" && e.source === o.source ? <span className={j.badText}>Unavailable. Records not read.</span> : e.facts.slice(0, 4).map((f, i) => <span key={i}>{f}</span>)}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Outage demo" badge="Feature: Outage handling" tone={phase === "offline" ? "bad" : undefined}>
        <div className={j.row}>
          <button type="button" className={j.btn} onClick={() => setPhase("offline")} disabled={phase === "offline"}>Take {o.label} offline</button>
          <button type="button" className={j.btn} onClick={() => setPhase(phase === "offline" ? "restored" : "online")} disabled={phase !== "offline"}>Restore {o.label}</button>
          <span className={j.small} role="status">{phase === "online" ? "All six sources online." : phase === "offline" ? `${o.label} is offline.` : `${o.label} restored. The same result is back.`}</span>
        </div>
        <div className={j.two}><SnapshotView s={o.online} title="Before" /><SnapshotView s={shown} title={phase === "offline" ? "During the outage" : phase === "restored" ? "After restore" : "Now"} /></div>
        <p className={j.small}>Checks that depend on the offline source: <b>{o.affectedChecks.join(", ")}</b>. {o.explanation}</p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ 4
const STATE_WORD: Record<string, string> = { pass: "Pass", review: "Review", block: "Block", skipped: "Skipped" };
function Screen4({ d }: { d: JourneyStepData[4] }) {
  const t = d.priceTrio;
  const v = d.validation;
  return (
    <>
      {t && (
        <Card title={`Three-way price check, ${t.description}`}>
          <div className={j.trio}>
            <div className={`${j.trioCell} ${j.bad}`}><span>Invoice</span><strong>{inr(t.invoice)}</strong><small>per {t.unit}</small></div>
            <div className={`${j.trioCell} ${j.bad}`}><span>Purchase order</span><strong>{inr(t.po)}</strong><small>differs by {(((t.invoice - t.po) / t.po) * 100).toFixed(1)}%</small></div>
            <div className={`${j.trioCell} ${j.ok}`}><span>Contract (amended)</span><strong>{inr(t.contract)}</strong><small>agrees with the invoice</small></div>
          </div>
        </Card>
      )}
      <Card title="Three validations side by side" badge="Feature: Contract-Aware matching">
        <div className={j.three}>
          <div className={j.vcol}><h4 className={j.sub}>Three-way match <b>{STATE_WORD[v.threeWay.state]}</b></h4><p className={j.small}>{v.threeWay.headline}</p><List items={v.threeWay.issues} /></div>
          <div className={j.vcol}><h4 className={j.sub}>Contract <b>{STATE_WORD[v.contract.state]}</b></h4><p className={j.small}>{v.contract.headline}</p><List items={v.contract.terms} /></div>
          <div className={j.vcol}><h4 className={j.sub}>Inventory <b>{STATE_WORD[v.inventory.state]}</b> <Feature>Feature: Inventory-Aware verification</Feature></h4><p className={j.small}>{v.inventory.headline}</p><List items={v.inventory.rows} /></div>
        </div>
      </Card>
      <div className={j.two}>
        <Card title="Unit normalisation">
          {d.normalisations.map((n) => (<div key={n.invoiceId}><p className={j.small}><b className="mono">{n.invoiceId}</b>, {n.supplier}</p><p>{n.text}</p><List items={n.evidence} /><p className={j.okText}>{n.purpose}</p></div>))}
        </Card>
        <Card title="Quality check applied">
          {d.qualityCase && <div><p className={j.small}><b className="mono">{d.qualityCase.invoiceId}</b>, {d.qualityCase.supplier}</p><p>{d.qualityCase.statement}</p><List items={d.qualityCase.evidence} /></div>}
        </Card>
      </div>
      <Card title={`All checks on ${d.invoiceId}`}>
        <p><Status s={d.status} /> <span className={j.small}>{d.summary}</span></p>
        <table className={j.tbl}><tbody>{d.checks.map((c) => <tr key={c.check}><td className={j.mark}>{c.passed === true ? "✓" : c.passed === false ? "✗" : "–"}</td><td>{c.label}</td><td className={j.small}>{c.detail}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ 5
function Screen5({ d }: { d: JourneyStepData[5] }) {
  const f = d.fix;
  return (
    <>
      {d.resolutions.map((r) => (
        <Card key={r.id} title={`${r.problem}`} badge="Feature: Root-Cause Resolver">
          <dl className={j.dl}>
            <dt>Root cause</dt><dd>{r.rootCause} <span className={r.evidenceStatus === "supported_by_evidence" ? j.verified : j.unverified}>{r.evidenceStatus === "supported_by_evidence" ? "supported by evidence" : "unverified prediction"}</span></dd>
            <dt>Evidence</dt><dd><List items={r.evidence.map((x) => `${x.source}, ${x.ref}: ${x.text}`)} /></dd>
            <dt>Owner</dt><dd>{r.responsible.department}, {r.responsible.role}{r.responsible.person ? `: ${r.responsible.person}` : ""}</dd>
            <dt>Correction</dt><dd>{r.correction}</dd>
            <dt>Counterfactual</dt><dd><Feature>Feature: Counterfactual Explanation</Feature><div className={j.counter}>{r.counterfactual}</div></dd>
          </dl>
        </Card>
      ))}
      <Card title="Ask why" badge="Feature: RAG with citations">
        {d.rag.map((r) => (
          <div key={r.question} className={j.qa}>
            <p className={j.q}>{r.question}</p>
            <p className={j.ans}>{r.answer.length > 520 ? `${r.answer.slice(0, 520).replace(/s+S*$/, "")}…` : r.answer}</p>
            <ul className={j.cites}>{r.citations.map((c) => <li key={c.id + c.ref}><b>[{c.title}]</b> {c.text.slice(0, 220)}{c.text.length > 220 ? "…" : ""}</li>)}</ul>
          </div>
        ))}
      </Card>
      <div className={j.two}>
        <Card title="Tasks routed" badge="Feature: Workflow routing">
          <ul className={j.list}>{d.tasks.map((t, i) => <li key={i}><b>{t.department}</b> ({t.owner}): {t.title}</li>)}</ul>
        </Card>
        <Card title="Simulate the fix, then re-match" tone={f.passes ? "ok" : "warn"}>
          <ol className={j.list}>{f.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
          <p className={j.beforeAfter}><Status s={f.before.status} /> <span aria-hidden="true">→</span> <Status s={f.after.status} /> <span className={j.small}>{f.passes ? "Re-match passes." : `${f.remaining.length} issue(s) remain.`}</span></p>
          <h4 className={j.sub}>Events logged ({f.auditEntriesAdded} audit entries added)</h4>
          <List items={f.events.map((e) => `${e.at.slice(11, 19)}  ${e.department}: ${e.note}`)} />
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 6
function RiskCard({ r, title, badge, children }: { r: JourneyStepData[6]["duplicate"] | JourneyStepData[6]["bank"] | JourneyStepData[6]["graph"] | JourneyStepData[6]["splitting"]; title: string; badge: string; children?: ReactNode }) {
  return (
    <Card title={title} badge={badge} tone="warn">
      <p><Warn label={r.label} /> <span className={j.score}>Score {r.score} of 100</span>{r.requiresIndependentVerification && <span className={j.verify}>Independent verification required</span>}</p>
      {children}
      <List items={r.reasons} />
      <p className={j.small}><b>Recommended:</b> {r.recommendedAction}</p>
    </Card>
  );
}
function Screen6({ d }: { d: JourneyStepData[6] }) {
  return (
    <div className={j.two}>
      <RiskCard r={d.duplicate} title={`Duplicate: ${d.duplicate.copy} against ${d.duplicate.original}`} badge="Feature: Duplicate Fingerprint" />
      <RiskCard r={d.splitting} title={`Splitting: ${d.splitting.invoices.length} invoices, ${lakh(d.splitting.combinedInr)} combined`} badge="Feature: Threshold-Splitting detector">
        <table className={j.tbl}><tbody>{d.splitting.invoices.map((x) => <tr key={x.id}><td className="mono">{x.id}</td><td>{x.date}</td><td className={j.num}>{inr(x.totalInr)}</td></tr>)}<tr><td colSpan={2}><b>Combined</b></td><td className={j.num}><b>{inr(d.splitting.combinedInr)}</b></td></tr></tbody></table>
      </RiskCard>
      <RiskCard r={d.bank} title={`Bank-account change: ${d.bank.supplier}`} badge="Feature: Vendor Red Flags">
        <p className={j.task}><b>Task created:</b> {d.bank.task}</p>
      </RiskCard>
      <RiskCard r={d.graph} title={`Graph link: ${d.graph.vendorA} and ${d.graph.vendorB}`} badge="Feature: Relationship Graph">
        <div className={j.edges} aria-label="Relationship graph">
          <span className={j.node}>{d.graph.vendorA}</span><span className={j.edge}>holds account</span><span className={`${j.node} ${j.nodeHot}`}>A/c {d.graph.account}</span><span className={j.edge}>held by</span><span className={j.node}>{d.graph.vendorB}</span>
        </div>
        <p className={j.small}>{d.graph.supplierNote}</p>
      </RiskCard>
    </div>
  );
}

// ------------------------------------------------------------------ 7
function Screen7({ d }: { d: JourneyStepData[7] }) {
  return (
    <>
      <Card title="Supplier scores and investigation priority" badge="Feature: Supplier Intelligence">
        <div className={j.scroll}>
          <table className={j.tbl}>
            <thead><tr><th>Supplier</th><th className={j.num}>Relationship strength</th><th className={j.num}>Supply criticality</th><th className={j.num}>Supplier risk</th><th className={j.num}>Investigation priority</th><th>Main materials</th></tr></thead>
            <tbody>{d.suppliers.map((s) => (
              <tr key={s.vendorId}><td><b>{s.name}</b><br /><span className={j.small}>{s.vendorId}</span></td>
                <td className={j.num}>{s.relationship.score} <small>{s.relationship.band}</small></td><td className={j.num}>{s.criticality.score} <small>{s.criticality.band}</small></td><td className={j.num}>{s.risk.score} <small>{s.risk.band}</small></td>
                <td className={j.num}>{s.priority ? <>{s.priority.score} <small>{s.priority.band}</small></> : "none open"}</td><td className={j.small}>{s.materials}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className={j.small}>{d.priorityNote}</p>
      </Card>
      <Card title={`Predictions for ${d.invoiceId}`} badge="Feature: Predictive Models A to D">
        <p className={j.small}>{d.disclaimer}</p>
        <div className={j.four}>
          {d.predictions.map((p) => (
            <div key={p.key} className={j.pred}>
              <h4 className={j.sub}>Model {p.key}: {p.title}</h4>
              <strong className={j.big}>{p.key === "B" ? d.causes[0]?.label ?? p.level : pct(p.probability)}</strong>
              <span className={j.small}>{p.key === "B" ? `${pct(p.probability)} if an exception occurs` : `${p.level} risk`}</span>
              <span className={j.small}>{p.model}{p.auc ? `, test AUC ${p.auc.toFixed(2)}` : ""}</span>
              <List items={p.factors.slice(0, 3).map((f) => `${f.label}: ${f.value} (${f.effectPoints >= 0 ? "+" : "−"}${Math.abs(f.effectPoints)} points)`)} />
            </div>
          ))}
        </div>
        <h4 className={j.sub}>Likely root causes</h4>
        <ul className={j.list}>{d.causes.map((c) => <li key={c.label}>{c.label}, {pct(c.probabilityIfException)} if an exception occurs: <span className={c.evidenceStatus === "evidence_supported" ? j.verified : j.unverified}>{c.evidenceStatus === "evidence_supported" ? "evidence-supported" : "unverified prediction"}</span>{c.evidence[0] ? `. ${c.evidence[0]}` : ""}</li>)}</ul>
        <p className={j.small}><b>Priority {d.priority.score} ({d.priority.band}).</b> {d.priority.explanation}</p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ 8
function Screen8({ d }: { d: JourneyStepData[8] }) {
  const a = d.actual;
  const maxShare = Math.max(1, ...d.stations.map((x) => x.sharePct));
  return (
    <>
      <Card title={`Expected path and the path ${d.invoiceId} actually took`} badge="Feature: Process-Mining Twin">
        <p><b>Expected</b></p><Strip stations={d.expected} />
        {a && <><p><b>Actual</b> <span className={j.pillWarn}>{a.loops.length} rework loop{a.loops.length === 1 ? "" : "s"}</span></p><Strip stations={a.stations} rework /><ul className={j.list}>{a.deviations.map((x) => <li key={x}>{x}</li>)}{a.exceptions.map((x, i) => <li key={i}>{x.check.replace(/_/g, " ")} check, sent to {x.department}: {x.open ? `open after ${hrs(x.hours)}` : `resolved after ${hrs(x.hours)}`}</li>)}</ul></>}
      </Card>
      <Card title="Where invoices spend their time">
        <FlowDiagram stats={d.stations} edges={d.edges} selected={a ?? undefined} />
      </Card>
      <div className={j.two}>
        <Card title="Bottleneck departments">
          <table className={j.tbl}><thead><tr><th>Station</th><th className={j.num}>Waiting (days)</th><th className={j.num}>Worked (days)</th><th>Share</th></tr></thead>
            <tbody>{d.stations.map((x) => <tr key={x.station}><td>{x.station}{d.bottlenecks.some((b) => b.station === x.station) ? " ⚑" : ""}</td><td className={j.num}>{(x.waitHours / 24).toFixed(0)}</td><td className={j.num}>{(x.workHours / 24).toFixed(0)}</td><td><span className={j.bar2} style={{ width: `${(x.sharePct / maxShare) * 90}px` }} /> {x.sharePct.toFixed(0)}%</td></tr>)}</tbody></table>
          <p className={j.small}>⚑ marks the largest shares of total time. Targets for the expected path are an assumption: {Object.entries(EXPECTED_HOURS).map(([k, v]) => `${k} ${v} h`).join(", ")}.</p>
        </Card>
        <Card title="Rework loops across all invoices">
          <p>{d.totals.reworkInvoices.toLocaleString("en-IN")} of {d.totals.invoices.toLocaleString("en-IN")} invoices ({d.totals.reworkPct.toFixed(0)}%) had a rework loop. Average cycle {d.totals.avgCycleDays.toFixed(1)} days; {d.totals.conformingPct.toFixed(0)}% followed the expected path.</p>
          <ul className={j.list}>{d.loops.map((l) => <li key={l.sequence}>{l.sequence}: {l.invoices} invoices, about {l.extraDays.toFixed(0)} extra days</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
function Strip({ stations, rework }: { stations: string[]; rework?: boolean }) {
  const seen = new Set<string>();
  return (
    <div className={j.strip} aria-label={stations.join(", then ")}>
      {stations.map((x, i) => { const again = rework && seen.has(x); seen.add(x); return <span key={i} className={j.stripItem}>{i > 0 && <span aria-hidden="true" className={j.arrow}>→</span>}<span className={`${j.st} ${again ? j.stAgain : rework && !["Intake", "AP review", "Approval", "Payment"].includes(x) ? j.stExtra : ""}`}>{x}{again ? " (again)" : ""}</span></span>; })}
    </div>
  );
}

// ------------------------------------------------------------------ 9
function Screen9({ d, onJump }: { d: JourneyStepData[9]; onJump: (n: number) => void }) {
  return (
    <>
      <div>
        <Card title="Audit trail: verify, then tamper" badge="Feature: Hash-Chained Audit Trail">
          <p className={d.integrity.ok ? j.okText : j.badText}>{d.integrity.ok ? `Verified intact: ${d.integrity.auditEntries.toLocaleString("en-IN")} entries, ${d.integrity.workflowEvents.toLocaleString("en-IN")} workflow events.` : "Integrity check failed."}</p>
          <p className={j.small}>Tamper tests run on copies. The live trail is never edited.</p>
          <table className={j.tbl}><thead><tr><th>Scenario</th><th>Result</th></tr></thead>
            <tbody>{d.tamper.map((t) => <tr key={t.label}><td>{t.label}</td><td className={t.ok ? j.okText : j.badText}>{t.ok ? "✓ " : "✗ Tampering detected. "}{t.position !== undefined ? `At record ${t.position}. ` : ""}<span className={j.small}>{t.reason}</span></td></tr>)}</tbody></table>
        </Card>
        <Card title="Supplier's Passport, after approval" badge="Feature: Payment Readiness Passport" tone={d.readyForPayment ? "ok" : "warn"}>
          <p className={j.ready} role="status">{d.readyForPayment ? "✓ Ready for payment" : "Not yet ready for payment"}</p>
          <p className={j.small}>{d.approvalNote}</p>
          <PassportView p={d.passport} />
        </Card>
      </div>
      <Card title="Everything this week showed">
        <table className={j.tbl}><thead><tr><th>Feature</th><th>Step</th><th>What the run showed</th></tr></thead>
          <tbody>{d.checklist.map((c) => <tr key={c.feature}><td><span className={j.tick} aria-hidden="true">✓</span> <b>{c.feature}</b></td><td><button type="button" className={j.linkBtn} onClick={() => onJump(c.step)}>Step {c.step}</button></td><td className={j.small}>{c.evidence}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}

export default function Screen({ step, data, onJump }: { step: number; data: JourneyData; onJump: (n: number) => void }) {
  const s = data.steps;
  switch (step) {
    case 1: return <Screen1 d={s[1]} />;
    case 2: return <Screen2 d={s[2]} />;
    case 3: return <Screen3 d={s[3]} />;
    case 4: return <Screen4 d={s[4]} />;
    case 5: return <Screen5 d={s[5]} />;
    case 6: return <Screen6 d={s[6]} />;
    case 7: return <Screen7 d={s[7]} />;
    case 8: return <Screen8 d={s[8]} />;
    default: return <Screen9 d={s[9]} onJump={onJump} />;
  }
}
