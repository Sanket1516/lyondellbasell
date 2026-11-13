import Link from "next/link";
import { AiLabel } from "@/components/Info";
import { notFound } from "next/navigation";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import { loadCanonical, type CanonicalBundle } from "@/plantpay/canonical";
import { tasksFor } from "@/plantpay/integration";
import { plantpay } from "@/plantpay/runtime";
import { SOURCE_META, type SourceId } from "@/plantpay/sources/schemas";
import { workflowEventsFor } from "@/plantpay/workflowEvents";
import { reevaluate, simulateGoodsReceipt, simulateInspection } from "../../actions";
import { RiskSignals } from "../../RiskPanel";
import { ValidationSideBySide } from "../../ValidationPanel";
import s from "../../Plantpay.module.css";

export const dynamic = "force-dynamic";
const CHIP: Record<string, { kind: ChipKind; label: string }> = {
  pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" }, incomplete: { kind: "pending", label: "Incomplete" },
};
const EVENT_LABEL: Record<string, string> = {
  invoice_received: "Invoice received", department_assigned: "Department assigned", review_started: "Review started", review_completed: "Review completed",
  exception_raised: "Exception raised", exception_resolved: "Exception resolved", approval_requested: "Approval requested", approval_granted: "Approval granted", payment_status_changed: "Payment status changed",
};
const n = (v: number) => fmtInr(v, Number.isInteger(v) ? 0 : 3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

export default async function PlantPayInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const id = decodeURIComponent((await params).id);
  const { q } = await searchParams;
  const e = plantpay();
  let r = e.stored(id);
  if (!r) { r = e.evaluate(id, { actor: "system" }); }
  if (r.summary.startsWith("Incomplete: Invoice") && r.sources.every((x) => x.status === "ok")) notFound();
  const canon = loadCanonical(e.connectors, id);
  const b = canon.bundle;
  const tasks = tasksFor(e.integration, id);
  const timeline = workflowEventsFor(e.integration, id);
  const answer = q && q.trim().length > 2 ? e.ask(q.trim(), id) : undefined;
  const down = (src: SourceId) => canon.unavailable.includes(src);
  const hasCheck = (c: string) => r!.discrepancies.some((d) => d.check === c);
  const needsGrn = b && b.goodsReceipts.length === 0 && !down("warehouse") && hasCheck("quantity");
  const needsInspection = b && b.goodsReceipts.some((g) => !b.inspections.some((i) => i.grId === g.id)) && hasCheck("quality");

  return (
    <>
      <Link href="/plantpay" className={s.back}>Back to PlantPay</Link>
      <h1 style={{ marginBottom: 6 }}>{id} <StatusChip kind={CHIP[r.status].kind} label={CHIP[r.status].label} /></h1>
      <div style={{ display: "flex", gap: 8, margin: "0 0 12px" }}><AiLabel kind="rule" /></div>
      <p className={s.lead}>{r.summary}</p>
      <div className={s.meta}>
        {r.meta && <><span>Supplier <b>{r.meta.vendorName}</b></span><span>PO <b className="mono">{r.meta.poId ?? "none"}</b></span><span>Invoice date <b>{fmtDate(r.meta.invoiceDate)}</b></span><span>Total <b>₹{fmtInr(r.meta.totalInr)}</b></span></>}
        <span>Evaluated <b>{fmtDate(r.evaluatedAt.slice(0, 10))}</b></span>
      </div>
      {r.unavailable.length > 0 && <div className={s.banner} role="status"><strong>Source unavailable:</strong> {r.unavailable.map((u) => SOURCE_META[u].label).join(", ")}. {r.notEvaluated.length ? `${r.notEvaluated.length} check(s) could not be evaluated.` : ""} Showing the last evaluation; it will be re-run when the source returns.</div>}

      <h2 className={s.h2}>Sources that contributed to this decision</h2>
      <p className={s.chips} style={{ marginBottom: 8 }}>{r.sources.map((u) => <span key={u.source} className={`${s.tag} ${u.status === "ok" ? "" : s.evDown}`} style={{ marginLeft: 0, marginRight: 6 }}>{SOURCE_META[u.source].label}: {u.status === "ok" ? "contributed" : "unavailable"}</span>)}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 6px" }}>
        <form action={reevaluate}><input type="hidden" name="invoice" value={id} /><button className={`${s.btn} ${s.btnPrimary}`} type="submit">Re-evaluate from the sources</button></form>
        <Link className={s.btn} href={`/plantpay/invoices/${encodeURIComponent(id)}/passport`} style={{ textDecoration: "none" }}>Supplier view (payment passport)</Link>
        <Link className={s.btn} href={`/plantpay/process?invoice=${encodeURIComponent(id)}`} style={{ textDecoration: "none" }}>Process path</Link>
        {needsGrn && <form action={simulateGoodsReceipt}><input type="hidden" name="invoice" value={id} /><button className={s.btn} type="submit">Demo: Warehouse posts the goods receipt</button></form>}
        {needsInspection && <form action={simulateInspection}><input type="hidden" name="invoice" value={id} /><button className={s.btn} type="submit">Demo: Quality records inspection (all accepted)</button></form>}
      </div>

      {(r.discrepancies.length > 0 || r.warnings.some((w) => w.severity === "review")) && <p><Link href={`/plantpay/invoices/${encodeURIComponent(id)}/exceptions`}><strong>Open the exception resolution view</strong></Link>: root cause, evidence, owner, correction, counterfactual, and a simulated fix.</p>}

      {r.validation && <ValidationSideBySide v={r.validation} />}

      {r.risk && <RiskSignals risk={r.risk} vendorId={r.meta?.vendorId} />}

      <h2 className={s.h2}>Checks</h2>
      <ul className={s.checks}>
        {r.checks.map((c) => (
          <li key={c.check}>
            <span className={c.passed === null ? s.skip : c.passed ? s.pass : s.fail} aria-label={c.passed === null ? "not evaluated" : c.passed ? "passed" : "failed"}>{c.passed === null ? "–" : c.passed ? "✓" : "✗"}</span>
            <span><strong>{c.label}.</strong> {c.detail} <span className={s.tag}>{c.sources.map((x) => SOURCE_META[x].label.replace(" DB", "")).join(" + ")}</span></span>
          </li>
        ))}
      </ul>

      {r.discrepancies.length > 0 && <h2 className={s.h2}>Discrepancies</h2>}
      {r.discrepancies.map((d, i) => (
        <div key={i} className={s.disc}>
          <h3>{d.lineNo ? `Line ${d.lineNo}: ` : ""}{d.message}</h3>
          <div>Likely cause: <strong>{d.rootCause}</strong><span className={s.tag}>{d.rootCauseStatus === "supported_by_evidence" ? "supported by evidence" : "unverified prediction"}</span></div>
          {d.expected && <div>Expected {d.expected}; found {d.actual}{d.deltaPct !== undefined ? ` (${d.deltaPct}%)` : ""}.</div>}
          {d.evidence.length > 0 && <ul>{d.evidence.map((x, k) => <li key={k}>{x}</li>)}</ul>}
          <div>Smallest fix: {d.suggestedFix} Routed to <strong>{d.department}</strong>.</div>
        </div>
      ))}
      {r.warnings.length > 0 && <h2 className={s.h2}>Warnings for human review</h2>}
      {r.warnings.map((w, i) => (
        <div key={i} className={s.warn}>
          <div>{w.message}{w.requiresIndependentVerification && <span className={s.tag}>independent verification required</span>}{w.severity === "info" && <span className={s.tag}>for information</span>}</div>
          {w.evidence.length > 0 && <ul>{w.evidence.map((x, k) => <li key={k}>{x}</li>)}</ul>}
        </div>
      ))}
      {r.prediction.available === false ? <p className={s.srcMeta}>Prediction: {r.prediction.reason}</p> : (
        <>
          <h2 className={s.h2}>Predictions (estimates, not decisions)</h2>
          <ul>{r.prediction.items.map((it) => <li key={it.label}>{it.label}: <strong>{Math.round(it.probability * 100)}%</strong> <span className={s.srcMeta}>({it.model}, trained on {it.trainedOn})</span></li>)}</ul>
          <p><Link href={`/plantpay/predictions/${encodeURIComponent(id)}`}>Open the full prediction view: contributing factors, evidence status, supplier scores and recommended actions</Link></p>
        </>
      )}

      {tasks.length > 0 && <><h2 className={s.h2}>Tasks routed to departments</h2><ul>{tasks.map((t) => <li key={t.id}><strong>{t.department}</strong> ({t.status}): {t.title}</li>)}</ul></>}

      <h2 className={s.h2}>Ask why</h2>
      <form className={s.search} action={`/plantpay/invoices/${encodeURIComponent(id)}`} method="get">
        <label>Question about this invoice, the contract or the policies<input type="search" name="q" defaultValue={q ?? ""} placeholder="Why was this flagged? What does the contract say?" style={{ minWidth: 340 }} /></label>
        <button type="submit">Ask</button>
      </form>
      {answer && (
        <div className={s.panel}>
          <p className={s.answer}>{answer.answer}</p>
          {answer.notes.map((x, i) => <p key={i} className={s.srcMeta}>{x}</p>)}
          {answer.citations.length > 0 && <><h3>Sources cited</h3>{answer.citations.map((c, i) => <div key={i} className={s.cite}><strong>[{c.id}, {c.ref}]</strong> {c.title}<br />{c.text}</div>)}</>}
        </div>
      )}

      <h2 className={s.h2}>Evidence from each source</h2>
      <div className={s.evidence}>
        <EvBox title="Procurement DB" src="procurement" down={down("procurement")} used={r.sources}>
          {b?.po && <Tbl head={["Line", "Item", "Qty", "Unit", "PO price"]} rows={b.po.lines.map((l) => [l.lineNo, l.itemCode, n(l.qty), l.uom, fmtInr(l.unitPrice)])} caption={`PO ${b.po.id}, issued ${fmtDate(b.po.issuedOn)}, buyer ${b.po.buyer}`} />}
          {b?.contract && <p>Contract {b.contract.id}: {b.contract.prices.slice(0, 4).map((p) => `${p.itemCode} ₹${fmtInr(p.unitPrice)}/${p.uom}`).join(", ")}{b.contract.prices.length > 4 ? "…" : ""}</p>}
          {b?.amendments.map((a, i) => <p key={i}>Amendment: {a.materialCode} ₹{fmtInr(a.oldPrice)} to ₹{fmtInr(a.newPrice)} from {fmtDate(a.effectiveFrom)}</p>)}
          {b?.poChanges.map((c, i) => <p key={i}>PO change: {c.field} {c.oldValue} to {c.newValue} ({fmtDate(c.changedOn)}, {c.reason})</p>)}
          {b && !b.po && !down("procurement") && <p>No PO found.</p>}
        </EvBox>
        <EvBox title="Warehouse DB" src="warehouse" down={down("warehouse")} used={r.sources}>
          {b && b.goodsReceipts.length === 0 && !down("warehouse") && <p>No goods receipt posted for this PO.</p>}
          {b && b.goodsReceipts.length > 0 && <Tbl head={["GRN", "Date", "Line", "Received"]} rows={b.goodsReceipts.flatMap((g) => g.lines.map((l) => [g.id, fmtDate(g.receivedOn), l.lineNo, `${n(l.qtyReceived)} ${l.uom}`]))} />}
          {b?.deliveryNotes.map((d) => <p key={d.id}>Delivery note {d.id}, {fmtDate(d.deliveredOn)}: {d.lines.map((l) => `${l.itemCode} ${n(l.qty)} ${l.uom}`).join(", ")}</p>)}
        </EvBox>
        <EvBox title="Quality DB" src="quality" down={down("quality")} used={r.sources}>
          {b && b.inspections.length === 0 && !down("quality") && <p>No inspection report on file.</p>}
          {b && b.inspections.length > 0 && <Tbl head={["Inspection", "Line", "Inspected", "Accepted", "Rejected"]} rows={b.inspections.flatMap((i) => i.lines.map((l) => [i.id, l.poLineNo, n(l.qtyInspected), n(l.qtyAccepted), l.qtyRejected ? `${n(l.qtyRejected)}${l.reason ? ` (${l.reason})` : ""}` : "0"]))} />}
        </EvBox>
        <EvBox title="Finance DB" src="finance" down={down("finance")} used={r.sources}>
          {b && <Tbl head={["Line", "Item", "Qty", "Unit", "Rate", "Amount"]} rows={b.invoice.lines.map((l) => [l.lineNo, l.itemCode ?? "", n(l.qty), l.uom, fmtInr(l.unitPrice), fmtInr(l.amount)])} caption={`Invoice ${b.invoice.id}, status ${b.invoice.status}, total ₹${fmtInr(b.invoice.total)}`} />}
          {b?.approvals.map((a, i) => <p key={i}>Approval: {a.approver} ({a.level}) on {fmtDate(a.approvedOn)}</p>)}
          {b?.payment && <p>Paid {fmtDate(b.payment.paidOn)}, ₹{fmtInr(b.payment.amount)}, {b.payment.utr}</p>}
        </EvBox>
        <EvBox title="Logistics DB" src="logistics" down={down("logistics")} used={r.sources}>
          {b?.shipments.map((x) => <p key={x.id}>Shipment {x.id}: {x.status.replace("_", " ")}, dispatched {fmtDate(x.dispatchedOn)}{x.deliveredOn ? `, delivered ${fmtDate(x.deliveredOn)}` : ""}</p>)}
          {b?.gateEntries.map((g) => <p key={g.id}>Gate entry {g.id}: vehicle {g.vehicleNo}, {fmtDate(g.enteredOn)}</p>)}
          {b?.weighbridge.map((w) => <p key={w.id}>Weighbridge {w.id}: gross {n(w.grossKg)} kg, tare {n(w.tareKg)} kg, <strong>net {n(w.netKg)} kg</strong></p>)}
          {b && b.shipments.length + b.gateEntries.length + b.weighbridge.length === 0 && !down("logistics") && <p>No logistics records.</p>}
        </EvBox>
        <EvBox title="Supplier DB" src="supplier" down={down("supplier")} used={r.sources}>
          {b?.vendor && <p>{b.vendor.name}, GSTIN {b.vendor.gstin}, {b.vendor.active ? "active" : "inactive"}; terms {b.vendor.paymentTermsDays} days</p>}
          {b?.vendor && <Tbl head={["Bank", "Account", "IFSC", "Status"]} rows={b.vendor.bankAccounts.map((a) => [a.bankName, a.accountNo, a.ifsc, a.status.replace("_", " ")])} />}
          {b?.remit && <p>Invoice asks for payment to <span className="mono">{b.remit.accountNo}</span> ({b.remit.ifsc}).</p>}
          {b?.accountHolders.length ? <p>Same account also held by: {b.accountHolders.map((h) => h.name).join(", ")}.</p> : null}
          {b?.vendor?.contacts[0] && <p>Contact on file: {b.vendor.contacts[0].name}, {b.vendor.contacts[0].phone}</p>}
        </EvBox>
      </div>

      <h2 className={s.h2}>Workflow history</h2>
      {timeline.length === 0 ? <p className={s.srcMeta}>No workflow events recorded yet.</p> : (
        <ul className={s.timeline}>
          {timeline.map((t) => <li key={t.id}><time dateTime={t.at}>{fmtDate(t.at.slice(0, 10))} {t.at.slice(11, 16)}</time><span><strong>{EVENT_LABEL[t.type]}</strong> · {t.department} · {t.actor}{detail(t.payload)}</span></li>)}
        </ul>
      )}
    </>
  );
}

const detail = (p: Record<string, unknown>) => { const t = (p.message ?? p.resolution ?? p.reason ?? p.stage ?? (p.to ? `${p.from ?? ""} to ${p.to}` : "")) as string; return t ? `: ${String(t).slice(0, 140)}` : ""; };

function EvBox({ title, src, down, used, children }: { title: string; src: SourceId; down: boolean; used: { source: SourceId; contributed: string[] }[]; children: React.ReactNode }) {
  const u = used.find((x) => x.source === src);
  return (
    <div className={s.evBox}>
      <h3><span>{title}</span><span className={down ? s.evDown : s.srcMeta}>{down ? "Source unavailable" : `${u?.contributed.length ?? 0} record group(s)`}</span></h3>
      {down ? <p className={s.evDown}>This source is unavailable right now, so its evidence cannot be shown and the checks that depend on it were not evaluated.</p> : children}
    </div>
  );
}

function Tbl({ head, rows, caption }: { head: string[]; rows: (string | number)[][]; caption?: string }) {
  return (
    <>
      {caption && <p>{caption}</p>}
      <table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>
    </>
  );
}

export type { CanonicalBundle };
