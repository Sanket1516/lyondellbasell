import Link from "next/link";
import { StatusChip } from "@/components/ui";
import type { DetectorOutcome, RiskAssessment, RiskSignal } from "@/plantpay/risk/types";
import s from "./Plantpay.module.css";

// Stage 5: the four risk detectors. Every flag carries the words "warning, not proof".
// Vendor red flags (attributes of this supplier's record) and the relationship graph (links across records) are separate sections on purpose.

function Signal({ sig }: { sig: RiskSignal }) {
  const chip = sig.flag ? { kind: "flag" as const, label: sig.severity === "review" ? "Warning" : "Noted" } : { kind: "pending" as const, label: "Not flagged" };
  return (
    <div className={s.riskSignal}>
      <p style={{ margin: "0 0 4px" }}><StatusChip kind={chip.kind} label={chip.label} /> <strong className="mono">Score {sig.score} of 100</strong> <span className={s.srcMeta}>{sig.kind.replace(/_/g, " ")}</span></p>
      <ul>{sig.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {sig.supportingRecords.length > 0 && (
        <details className={s.riskDetails}>
          <summary>Supporting records ({sig.supportingRecords.length})</summary>
          <ul>{sig.supportingRecords.map((x, i) => <li key={i}><span className={s.srcMeta}>{x.source}, {x.ref}:</span> {x.text}</li>)}</ul>
        </details>
      )}
      <p><strong>Recommended action:</strong> {sig.recommendedAction}</p>
      {sig.requiresIndependentVerification && <p className={s.riskTask}>Independent verification task created for Supplier master data. Payment waits for the call-back.</p>}
      <p className={s.riskLabel}>{sig.label}</p>
    </div>
  );
}

function Card({ d, children }: { d: DetectorOutcome; children?: React.ReactNode }) {
  return (
    <section className={s.panel} aria-label={d.title}>
      <h3>{d.title} <StatusChip kind={d.flag ? "flag" : "approve"} label={d.flag ? "Flagged" : "Clear"} /></h3>
      <p className={s.srcMeta}>{d.summary}</p>
      {d.signals.map((sig, i) => <Signal key={i} sig={sig} />)}
      {children}
    </section>
  );
}

export function RiskSignals({ risk, vendorId }: { risk: RiskAssessment; vendorId?: string }) {
  const d = risk.detectors;
  return (
    <>
      <h2 className={s.h2}>Risk signals</h2>
      <p className={s.srcMeta} style={{ marginBottom: 8 }}>Four detectors look for patterns that deserve a second pair of eyes. Every flag is a <strong>warning, not proof</strong>: shared bank details, staged deliveries and address moves are often legitimate. Nothing here is a finding about a person.</p>
      <div className={s.cols}>
        <Card d={d.duplicate} />
        <Card d={d.splitting} />
      </div>
      <h3 className={s.h3}>Vendor red flags <span className={s.srcMeta}>(attributes of this supplier&apos;s own record)</span></h3>
      <div className={s.cols}><Card d={d.vendor} /></div>
      <h3 className={s.h3}>Relationship graph <span className={s.srcMeta}>(links across vendors, accounts, addresses and approvers)</span></h3>
      <div className={s.cols}>
        <Card d={d.graph}>
          <p><Link href={vendorId ? `/plantpay/graph?focus=${encodeURIComponent(vendorId)}` : "/plantpay/graph"}>Open the interactive graph{vendorId ? " for this supplier" : ""}</Link></p>
        </Card>
      </div>
    </>
  );
}
