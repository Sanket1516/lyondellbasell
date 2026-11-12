import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/ui";
import { buildEvidence } from "@/lib/evidence";
import { fmtDate, fmtInr } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { workflowView } from "@/lib/workflow-status";
import { DecisionForm } from "./DecisionForm";
import s from "../../Approver.module.css";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const user = (await getSessionUser())!;
  const state = getState();
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv) notFound();

  const vendor = state.vendors.find((v) => v.id === inv.vendorId)?.name ?? inv.printedVendor?.name ?? "Unknown supplier";
  const card = buildEvidence(state, inv, { username: user.username, role: user.role, approverLevel: user.approverLevel });
  const st = workflowView(inv, state.tasks.filter((t) => t.invoiceId === id));
  const waiting = inv.status === "pending_approval" && inv.verdict === "approve";
  const failed = card.sod.find((c) => !c.ok);
  // Approve needs every check. Reject and send back are only stopped by role and limit, which the service enforces too.
  const canApprove = waiting && !failed;

  return (
    <>
      <p className={s.crumb}><Link href="/approver">Approvals</Link> / <span className="mono">{id}</span></p>
      <div className={s.head}>
        <div>
          <h1 className="mono">{id}</h1>
          <p className={s.sub}>{vendor} · PO <span className="mono">{inv.poId ?? "none"}</span> · invoice dated {fmtDate(inv.invoiceDate)} · received {fmtDate(inv.receivedOn)}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className={s.total}><span className={s.totalLabel}>Invoice total</span><span className="mono">₹{fmtInr(inv.total)}</span></div>
          <StatusChip kind={st.kind} label={st.label} />
        </div>
      </div>

      <div className={s.route}><StatusChip kind="pending" label="Routing" /> {card.route}</div>
      {card.lastDecision && <p className={s.note} role="note">{card.lastDecision}</p>}

      <div className={s.grid}>
        <div className={s.stack}>
          <section className="panel-like">
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>Invoice against PO and goods receipts</h2>
            <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
              <table className={s.diff}>
                <thead><tr><th>Line</th><th>Item</th><th>Invoice</th><th>PO</th><th>Received (total)</th><th>Result</th></tr></thead>
                <tbody>
                  {card.lines.map((l) => (
                    <tr key={l.lineNo}>
                      <td>{l.lineNo}</td>
                      <td>{l.item}</td>
                      <td className={s.mono}>{l.billed}</td>
                      <td className={s.mono}>{l.po}</td>
                      <td className={s.mono}>{l.received}</td>
                      <td><StatusChip kind={l.ok ? "approve" : "flag"} label={l.ok ? "Matches" : "Check"} /><div className={s.noteCell}>{l.note}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mono" style={{ marginTop: 8, textAlign: "right", fontSize: 12, color: "var(--ink-soft)" }}>
              Subtotal ₹{fmtInr(inv.subtotal)} · Tax ₹{fmtInr(inv.tax)} · Total ₹{fmtInr(inv.total)}
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>Findings and how they were resolved</h2>
            {card.resolved.length === 0 && card.autoCleared.length === 0 && <p className={s.muted}>The match was clean the first time. There was nothing to resolve.</p>}
            <ul className={s.list}>
              {card.resolved.map((r, i) => (
                <li key={i}>
                  <span className={s.listHead}>{r.title}</span> <span className={s.muted}>· {r.owner}{r.when ? ` · ${r.when}` : ""}</span>
                  <div>{r.how}</div>
                </li>
              ))}
              {card.autoCleared.map((a, i) => <li key={`a${i}`}><span className={s.listHead}>Cleared automatically</span><div>{a}</div></li>)}
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>Duplicate check</h2>
            <p>{card.duplicate}</p>
          </section>
        </div>

        <div className={s.stack}>
          <section>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>Segregation of duties</h2>
            <ul className={s.checks}>
              {card.sod.map((c) => (
                <li key={c.label} className={s.check}>
                  <span className={`${s.mark} ${c.ok ? s.pass : s.fail}`}>{c.ok ? "Pass" : "Fail"}</span>
                  <span>{c.label}{!c.ok && <span className={s.failMsg}>{c.message}</span>}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>Your decision</h2>
            {waiting ? (
              <DecisionForm invoiceId={id} canApprove={canApprove} blockedReason={failed?.message} />
            ) : (
              <p className={s.done}>This invoice is not waiting for approval. It is {st.label.toLowerCase()}.</p>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 14, marginBottom: 8 }}>History</h2>
            {card.history.length === 0 ? <p className={s.muted}>No events are recorded for this invoice.</p> : (
              <ol className={s.history}>
                {card.history.map((h, i) => (
                  <li key={i}>
                    <div className={s.historyWhen}>{h.when} · {h.actor}</div>
                    <div>{h.detail}{h.reason ? ` Reason: ${h.reason}` : ""}</div>
                  </li>
                ))}
              </ol>
            )}
            <p style={{ marginTop: 8 }}><Link href={`/audit?invoice=${encodeURIComponent(id)}`}>Open in the audit trail</Link></p>
          </section>
        </div>
      </div>
    </>
  );
}
