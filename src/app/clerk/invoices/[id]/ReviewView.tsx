"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Panel, SplitView, StatusChip, Table, useToast, type ChipKind } from "@/components/ui";
import { DocumentViewer } from "@/components/DocumentViewer";
import { ENGINE_CONFIG } from "@/engine/config";
import type { BBox, PageSize } from "@/lib/extract/types";
import { fmtDate, fmtInr } from "@/lib/format";
import { STATUS_VIEW } from "@/lib/status";
import type { EvidenceRef, FindingKind, Invoice, InvoiceStatus, Verdict } from "@/lib/types";
import { decideDuplicate, releaseAction, reopenAction, requestFixAction, rerunMatch, simulateErpAction } from "../../actions";
import s from "./Review.module.css";

export interface TaskView {
  id: string; owner: string; status: "requested" | "done"; dueOn: string; resolution?: string;
  /** "erp": the demo control can apply the fix. "supplier": waits for a corrected invoice. "none": the owner acts outside this system. */
  simulate: "erp" | "supplier" | "none";
}
export interface FindingView {
  id: string; lineNo?: number; kind: FindingKind; kindLabel: string; verdict: Verdict; message: string; rootCause: string; owner: string;
  smallestFix: string; expected?: string; actual?: string; evidence: EvidenceRef[]; box: BBox | null;
  task: TaskView | null; canRequest: boolean;
}
export interface FlowView {
  /** Plain-language routing line, shown once the invoice is clean. */
  route: string | null;
  canRelease: boolean;
  canReopen: boolean;
  /** Reason a rejection or send-back was recorded. */
  note: string | null;
  approvedNote: string | null;
}
export interface LineView { lineNo: number; itemCode?: string; description: string; qty: number; uom: string; unitPrice: number; amount: number; verdict: Verdict }
export interface ReviewProps {
  id: string; vendor: string; poId: string; invoiceDate: string; receivedOn: string; subtotal: number; tax: number; total: number;
  statusView: { kind: ChipKind; label: string }; verdict: Verdict | null; summary: string; lines: LineView[]; findings: FindingView[]; flow: FlowView;
  doc: { src: string; kind: "pdf" | "image"; pages: PageSize[]; fixture: boolean } | null;
  hasSource: boolean;
  duplicate: { matched: { id: string; invoiceDate: string; poId: string; total: number; status: InvoiceStatus; resolvedOn?: string; lines: { description: string; qty: number; uom: string; unitPrice: number }[] }; fields: string } | null;
  decision: Invoice["duplicateDecision"] | null;
}

const BANNER: Record<Verdict, string> = { approve: "Approve", flag: "Flag", block: "Block" };

export function ReviewView(p: ReviewProps) {
  const router = useRouter();
  const toast = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const activeFinding = p.findings.find((f) => f.id === active);
  const highlight = activeFinding?.box ?? null;
  const st = p.statusView;

  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function run<T extends { ok: boolean }>(call: () => Promise<T>, done: (r: T & { ok: true }) => string) {
    setBusy(true);
    const r = await call().catch(() => ({ ok: false, error: "That did not work. Try again." }) as unknown as T);
    setBusy(false);
    toast.show(r.ok ? done(r as T & { ok: true }) : (r as unknown as { error: string }).error);
    router.refresh();
  }

  async function rerun() {
    setBusy(true);
    const r = await rerunMatch(p.id).catch(() => ({ ok: false as const, error: "Could not re-run the match." }));
    setBusy(false);
    toast.show(r.ok ? (r.changed ? "Match re-run: results changed" : "Match re-run: no change") : r.error);
    router.refresh();
  }

  return (
    <div>
      <div className={s.head}>
        <div>
          <h1 className="mono">{p.id}</h1>
          <p className={s.sub}>
            {p.vendor} · PO <span className="mono">{p.poId || "none"}</span> · invoice dated {fmtDate(p.invoiceDate)} · received {fmtDate(p.receivedOn)}
          </p>
        </div>
        <div className={s.headRight}>
          <div className={s.total}><span className={s.totalLabel}>Invoice total</span><span className="mono">₹{fmtInr(p.total)}</span></div>
          <StatusChip kind={st.kind} label={st.label} />
        </div>
      </div>

      <section className={`${s.banner} ${p.verdict ? s[`banner_${p.verdict}`] : ""}`} aria-label="Verdict">
        {p.verdict ? <StatusChip kind={p.verdict} label={BANNER[p.verdict]} /> : <StatusChip kind="pending" label="Not matched" />}
        <p className={s.bannerText}>{p.summary}</p>
        <Button variant="quiet" onClick={rerun} disabled={busy}>{busy ? "Matching…" : "Re-run match"}</Button>
      </section>
      <p className={s.assump}>
        Rules used (assumptions): price within ±{ENGINE_CONFIG.pricePct}% of the PO, quantity up to {ENGINE_CONFIG.qtyPct}% above cumulative receipts, tax rate equal to the PO tax code.
      </p>

      <FlowPanel p={p} busy={busy} run={run} />

      <SplitView
        left={
          p.doc ? (
            <div className={s.sticky}>
              {p.doc.fixture && <p className={s.fixture} role="note">Fixture result: scanned image. Highlight positions come from the stored result.</p>}
              <DocumentViewer src={p.doc.src} kind={p.doc.kind} pages={p.doc.pages} highlight={highlight} />
              <p className={s.sub}>{active ? (highlight ? "Highlighted: where this finding points." : "This finding has no single place on the document.") : "Select a finding to see where it points."}</p>
            </div>
          ) : (
            <Panel title="Original document">
              <p className={s.sub}>
                {p.hasSource ? "A preview with highlights is not available for this file. The lines below are what the supplier submitted." : "No original document is stored for this invoice. The lines below are the recorded values."}
              </p>
            </Panel>
          )
        }
        right={
          <div className={s.stack}>
            <Panel title="Lines">
              <Table
                rows={p.lines}
                rowKey={(l) => String(l.lineNo)}
                columns={[
                  { header: "Line", render: (l) => l.lineNo },
                  { header: "Item", render: (l) => <span>{l.itemCode && <span className="mono">{l.itemCode} </span>}<span className={s.desc}>{l.description}</span></span> },
                  { header: "Billed", numeric: true, render: (l) => <span style={{ whiteSpace: "nowrap" }}>{`${fmtInr(l.qty, Number.isInteger(l.qty) ? 0 : 2)} ${l.uom} × ${fmtInr(l.unitPrice)}`}</span> },
                  { header: "Amount (₹)", numeric: true, render: (l) => fmtInr(l.amount) },
                  { header: "Result", render: (l) => <StatusChip kind={l.verdict} /> },
                ]}
              />
              <p className={s.totals}>Subtotal ₹{fmtInr(p.subtotal)} · Tax ₹{fmtInr(p.tax)} · Total ₹{fmtInr(p.total)}</p>
            </Panel>

            <Panel title={p.findings.length ? `Findings (${p.findings.length})` : "Findings"}>
              {p.findings.length === 0 && <p className={s.sub}>{p.verdict ? "No findings. Every check passed." : "Nothing to show until the invoice is matched."}</p>}
              <ol className={s.findings}>
                {p.findings.map((f) => (
                  <li key={f.id} className={`${s.finding} ${active === f.id ? s.findingOn : ""}`}>
                    <div className={s.findingTop}>
                      <StatusChip kind={f.verdict} />
                      <span className={s.findingKind}>{f.lineNo ? `Line ${f.lineNo}` : "Invoice"} · {f.kindLabel}</span>
                      <button type="button" className={s.linkBtn} onClick={() => setActive(active === f.id ? null : f.id)} aria-pressed={active === f.id} disabled={!p.doc}>
                        {active === f.id ? "Hide on document" : "Show on document"}
                      </button>
                    </div>
                    <p className={s.msg}>{f.message}</p>
                    <dl className={s.facts}>
                      {f.expected && <><dt>Expected</dt><dd className="mono">{f.expected}</dd></>}
                      {f.actual && <><dt>Billed</dt><dd className="mono">{f.actual}</dd></>}
                      <dt>Root cause</dt><dd>{f.rootCause}</dd>
                      <dt>Owner</dt><dd>{f.owner}</dd>
                      <dt>Smallest fix</dt><dd>{f.smallestFix}</dd>
                    </dl>
                    {f.evidence.length > 0 && (
                      <>
                        <button type="button" className={s.linkBtn} onClick={() => toggle(f.id)} aria-expanded={open.has(f.id)}>
                          {open.has(f.id) ? "Hide evidence" : `Show evidence (${f.evidence.length})`}
                        </button>
                        {open.has(f.id) && (
                          <ul className={s.evidence}>
                            {f.evidence.map((e, i) => <li key={i}>{e.text}</li>)}
                          </ul>
                        )}
                      </>
                    )}
                    <TaskLine f={f} invoiceId={p.id} busy={busy} run={run} />
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        }
      />

      {p.duplicate && <DuplicateView id={p.id} lines={p.lines} total={p.total} invoiceDate={p.invoiceDate} poId={p.poId} dup={p.duplicate} decision={p.decision} onDone={(m) => { toast.show(m); router.refresh(); }} />}
      {toast.node}
    </div>
  );
}

function DuplicateView({ id, lines, total, invoiceDate, poId, dup, decision, onDone }: {
  id: string; lines: LineView[]; total: number; invoiceDate: string; poId: string;
  dup: NonNullable<ReviewProps["duplicate"]>; decision: ReviewProps["decision"]; onDone: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = dup.matched;
  const mst = STATUS_VIEW[m.status];

  const rows: { label: string; a: string; b: string }[] = [
    { label: "Invoice number", a: id, b: m.id },
    { label: "Invoice date", a: fmtDate(invoiceDate), b: fmtDate(m.invoiceDate) },
    { label: "PO", a: poId, b: m.poId },
    { label: "Total (₹)", a: fmtInr(total), b: fmtInr(m.total) },
    { label: "Status", a: "This invoice", b: m.status === "paid" ? `Paid ${fmtDate(m.resolvedOn)}` : mst.label },
    ...Array.from({ length: Math.max(lines.length, m.lines.length) }, (_, i) => {
      const fmt = (l?: { description: string; qty: number; uom: string; unitPrice: number }) => (l ? `${l.description}, ${fmtInr(l.qty, Number.isInteger(l.qty) ? 0 : 2)} ${l.uom} × ${fmtInr(l.unitPrice)}` : "No line");
      return { label: `Line ${i + 1}`, a: fmt(lines[i]), b: fmt(m.lines[i]) };
    }),
  ];

  async function decide(d: "duplicate" | "not_duplicate") {
    setError(null);
    if (reason.trim().length < 8) return setError("Give a reason of at least a few words. It is saved in the audit trail.");
    setBusy(true);
    const r = await decideDuplicate(id, d, reason).catch(() => ({ ok: false as const, error: "The decision could not be saved." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(d === "duplicate" ? "Marked as a confirmed duplicate" : "Marked as not a duplicate");
  }

  return (
    <div className={s.dupWrap}>
      <Panel title={`Compare with ${m.id}`}>
        <p className={s.sub}>{dup.fields}</p>
        <table className={s.compare}>
          <thead><tr><th scope="col"><span className="sr-only">Field</span></th><th scope="col">This invoice ({id})</th><th scope="col">Earlier invoice ({m.id})</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const same = r.a === r.b;
              return (
                <tr key={r.label} className={same ? s.same : ""}>
                  <th scope="row">{r.label}</th>
                  <td className="mono">{r.a}</td>
                  <td className="mono">{r.b}{same ? <span className={s.sameTag}> same</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {decision ? (
          <p className={s.decided} role="status">
            {decision.decision === "duplicate" ? "Confirmed as a duplicate" : "Recorded as not a duplicate"} by {decision.by} on {fmtDate(decision.at.slice(0, 10))}. Reason: {decision.reason}
          </p>
        ) : (
          <form className={s.decide} onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="dup-reason" className={s.decideLabel}>Reason for your decision (required)</label>
            <textarea id="dup-reason" className={s.textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: second batch delivered on 09-Nov, confirmed with stores" />
            {error && <p role="alert" className={s.err}>{error}</p>}
            <div className={s.decideBtns}>
              <Button variant="primary" type="button" disabled={busy} onClick={() => decide("duplicate")}>Confirm duplicate</Button>
              <Button type="button" disabled={busy} onClick={() => decide("not_duplicate")}>Not a duplicate</Button>
            </div>
          </form>
        )}
      </Panel>
    </div>
  );
}

type Run = <T extends { ok: boolean }>(call: () => Promise<T>, done: (r: T & { ok: true }) => string) => Promise<void>;

function TaskLine({ f, invoiceId, busy, run }: { f: FindingView; invoiceId: string; busy: boolean; run: Run }) {
  const k = f.task;
  if (!k && !f.canRequest) return null;
  if (!k) {
    return (
      <div className={s.taskRow}>
        <Button type="button" disabled={busy} onClick={() => run(() => requestFixAction(invoiceId, f.id), () => `Fix requested from ${f.owner}`)}>Request fix from {f.owner}</Button>
      </div>
    );
  }
  return (
    <div className={s.taskRow}>
      <p className={s.taskMeta}>
        <span className="mono">{k.id}</span> · {k.owner} · due {fmtDate(k.dueOn)} · <strong>{k.status === "done" ? "Done" : "Requested"}</strong>
        {k.status === "done" && k.resolution ? `. ${k.resolution}` : ""}
      </p>
      {k.status === "requested" && k.simulate === "erp" && (
        <Button type="button" disabled={busy} onClick={() => run(() => simulateErpAction(k.id), (r) => `${r.summary} ${r.verdict === "approve" ? "The invoice now matches." : "Re-matched: still has open findings."}`)}>
          Demo: simulate ERP update by {k.owner}
        </Button>
      )}
      {k.status === "requested" && k.simulate === "supplier" && <p className={s.taskNote}>Waiting for supplier. They see exactly what to correct; their corrected invoice closes this task.</p>}
      {k.status === "requested" && k.simulate === "none" && <p className={s.taskNote}>No simulated update exists for this fix. {k.owner} acts outside this system.</p>}
    </div>
  );
}

function FlowPanel({ p, busy, run }: { p: ReviewProps; busy: boolean; run: Run }) {
  const [reason, setReason] = useState("");
  const f = p.flow;
  if (!f.route && !f.canReopen && !f.approvedNote && !f.note) return null;
  return (
    <section className={s.flow} aria-label="Next step">
      {f.approvedNote && <p className={s.flowText}>{f.approvedNote}</p>}
      {f.note && <p className={s.flowText}>{f.note}</p>}
      {f.route && (
        <div className={s.flowRow}>
          <p className={s.flowText}>{f.route}</p>
          {f.canRelease && <Button variant="primary" disabled={busy} onClick={() => run(() => releaseAction(p.id), () => "Released. Marked ready for payment.")}>Release</Button>}
        </div>
      )}
      {f.canReopen && (
        <form className={s.decide} onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="reopen-reason" className={s.decideLabel}>Reason for returning it to approval (required)</label>
          <textarea id="reopen-reason" className={s.textarea} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: price evidence attached, buyer confirmed" />
          <div className={s.decideBtns}>
            <Button type="button" disabled={busy} onClick={() => run(() => reopenAction(p.id, reason), () => "Returned to the matching and approval queue")}>Return to approval</Button>
          </div>
        </form>
      )}
    </section>
  );
}
