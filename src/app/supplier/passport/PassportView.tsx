import { fmtDate, fmtRupees } from "@/lib/format";
import type { Passport } from "@/plantpay/passport";
import s from "./Passport.module.css";

const STATE_LABEL = { done: "✓ Done", current: "● In progress", blocked: "! Needs attention", upcoming: "○ Not started" } as const;

/** Renders one restricted passport. It only ever receives a Passport (the allow-listed shape), never the engine result. */
export default function PassportView({ p }: { p: Passport }) {
  const due = p.daysToDue;
  return (
    <>
      <div className={s.head}>
        <span>Invoice <b className="mono">{p.invoiceNumber}</b></span>
        {p.invoiceDate && <span>Invoice date <b>{fmtDate(p.invoiceDate)}</b></span>}
        {p.amountInr !== undefined && <span>Amount <b>{fmtRupees(p.amountInr)}</b></span>}
        {p.poNumber && <span>Purchase order <b className="mono">{p.poNumber}</b></span>}
        <span>Status as of <b>{fmtDate(p.asOf)}</b></span>
      </div>
      <p className={`${s.headline} ${s[p.tone]}`} role="status">{p.headline}</p>

      <div className={s.tiles}>
        <div className={`${s.tile} ${p.atRisk.flag ? s.risk : s.riskOk}`}>
          <strong>{p.paidOn ? "Paid" : p.atRisk.flag ? "At risk" : "On track"}</strong>
          <span>{p.atRisk.reason}</span>
        </div>
        <div className={s.tile}>
          <strong>{p.dueDate ? fmtDate(p.dueDate) : "Not available"}</strong>
          <span>Due date{p.paymentTermsDays ? ` (${p.paymentTermsDays}-day terms)` : ""}</span>
        </div>
        <div className={s.tile}>
          <strong>{p.paidOn ? "Paid" : due === undefined ? "Not available" : due < 0 ? `${-due} overdue` : due}</strong>
          <span>{p.paidOn ? `Paid on ${fmtDate(p.paidOn)}` : due === undefined || due < 0 ? "Days to due date" : due === 1 ? "Day to due date" : "Days to due date"}</span>
        </div>
      </div>

      <h2 className={s.h2}>Progress to payment</h2>
      <ol className={s.steps} aria-label="Payment milestones">
        {p.milestones.map((m) => (
          <li key={m.id} className={`${s.step} ${s[`s_${m.state}`]}`}>
            <span className={s.state}>{STATE_LABEL[m.state]}</span>
            <h3>{m.label}</h3>
            <p>{m.note}</p>
          </li>
        ))}
      </ol>

      <h2 className={s.h2}>What is holding this invoice</h2>
      {p.blockers.length === 0 ? <p className={s.empty}>{p.paidOn ? "Nothing. This invoice has been paid." : "Nothing is holding this invoice."}</p> : p.blockers.map((b) => (
        <div key={b.id} className={s.item}>
          <h3>{b.title}</h3>
          <p>{b.detail}</p>
          <p className={s.team}>With: {b.team}</p>
          {b.supplierAction && <p><strong>What you can do:</strong> {b.supplierAction}</p>}
        </div>
      ))}

      <h2 className={s.h2}>Actions our teams still have to take</h2>
      {p.actions.length === 0 ? <p className={s.empty}>No internal action is pending.</p> : (
        <div className={s.scroll}>
          <table className={s.table}>
            <thead><tr><th>Team</th><th>Action</th><th>Waiting since</th><th className={s.num}>Days waiting</th></tr></thead>
            <tbody>
              {p.actions.map((a) => (
                <tr key={`${a.team}|${a.action}`}>
                  <td>{a.team}</td><td>{a.action}</td>
                  <td>{a.waitingSince ? fmtDate(a.waitingSince) : "Not started"}</td>
                  <td className={s.num}>{a.waitingDays ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={s.foot}>This page shows the status of your own invoice only. The due date uses your agreed payment terms from the invoice date. A flag means the due date may be missed, not that anything is wrong with your invoice.</p>
    </>
  );
}
