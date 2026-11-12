import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import type { ValidationPanel as Validation } from "@/plantpay/engine";
import s from "./Plantpay.module.css";

// Stage 4C: the three validations side by side. Three-way is the unchanged Stage 1 engine; contract and inventory run after it.
const CHIP: Record<string, { kind: ChipKind; label: string }> = {
  pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" }, skipped: { kind: "pending", label: "Skipped" },
};
const TERM: Record<string, string> = { ok: "Agrees", discrepancy: "Differs", raised_by_price_check: "In price check", skipped: "Skipped" };
const ROW: Record<string, string> = { ok: "Reconciles", discrepancy: "Over-claimed", raised_by_quantity_check: "In quantity check", raised_by_duplicate_check: "In duplicate check", skipped: "Skipped" };
const n = (v: number) => fmtInr(v, Number.isInteger(v) ? 0 : 3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
const money = (v?: number) => (v === undefined ? "–" : `₹${fmtInr(v)}`);

export function ValidationSideBySide({ v }: { v: Validation }) {
  return (
    <>
      <h2 className={s.h2}>Validation: three-way, contract and inventory</h2>
      <p className={s.srcMeta} style={{ marginBottom: 8 }}>Three-way matching is unchanged. Contract terms and inventory are checked after it, so a bill that matches its PO can still be held for a contract or stock reason.</p>
      <div className={s.cols}>
        <section className={s.panel} aria-label="Three-way match">
          <h3>Three-way match <StatusChip kind={CHIP[v.threeWay.state].kind} label={CHIP[v.threeWay.state].label} /></h3>
          <p>{v.threeWay.headline}</p>
          {v.threeWay.issues.length > 0 && <ul>{v.threeWay.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <p className={s.srcMeta}>Invoice against PO and goods receipt: price, quantity, unit, tax, totals, duplicates.</p>
        </section>

        <section className={s.panel} aria-label="Contract terms">
          <h3>Contract terms <StatusChip kind={CHIP[v.contract.state].kind} label={CHIP[v.contract.state].label} /></h3>
          <p>{v.contract.headline}</p>
          {v.contract.state === "skipped" && <p className={s.srcMeta}>This check was not performed, so it is not counted as a pass.</p>}
          {v.contract.terms.length > 0 && (
            <div className={s.vscroll}>
              <table className={s.table}>
                <thead><tr><th>Line</th><th>Item</th><th className={s.num}>Contract</th><th className={s.num}>PO</th><th className={s.num}>Invoice</th><th>Result</th></tr></thead>
                <tbody>{v.contract.terms.map((t) => <tr key={t.lineNo} title={t.note}><td>{t.lineNo}</td><td>{t.itemCode}</td><td className={s.num}>{money(t.contractPrice)}</td><td className={s.num}>{money(t.poPrice)}</td><td className={s.num}>{money(t.invoicePrice)}</td><td>{TERM[t.state]}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {v.contract.terms.some((t) => (t.state !== "ok" && t.state !== "discrepancy") || t.amendment) && <ul className={s.srcMeta}>{v.contract.terms.filter((t) => (t.state !== "ok" && t.state !== "discrepancy") || t.amendment).map((t) => <li key={t.lineNo}>Line {t.lineNo}: {t.note}</li>)}</ul>}
          {v.contract.contractId && <p className={s.srcMeta}>Contract {v.contract.contractId} valid {fmtDate(v.contract.validFrom)} to {fmtDate(v.contract.validTo)}; read on the delivery date {fmtDate(v.contract.referenceDate)}. Prices per PO unit.</p>}
        </section>

        <section className={s.panel} aria-label="Inventory">
          <h3>Inventory <StatusChip kind={CHIP[v.inventory.state].kind} label={CHIP[v.inventory.state].label} /></h3>
          <p>{v.inventory.headline}</p>
          {v.inventory.state === "skipped" && <p className={s.srcMeta}>This check was not performed, so it is not counted as a pass.</p>}
          {v.inventory.rows.length > 0 && (
            <div className={s.vscroll}>
              <table className={s.table}>
                <thead><tr><th>Line</th><th>Item</th><th className={s.num}>Received</th><th className={s.num}>Returned</th><th className={s.num}>Earlier bills</th><th className={s.num}>This bill</th><th className={s.num}>Left</th><th>Result</th></tr></thead>
                <tbody>{v.inventory.rows.map((r) => <tr key={r.lineNo} title={r.note}><td>{r.lineNo}</td><td>{r.itemCode}</td><td className={s.num}>{n(r.received)} {r.uom}</td><td className={s.num}>{r.returned + r.reversed ? `${n(r.returned + r.reversed)} ${r.uom}` : "0"}</td><td className={s.num}>{r.previouslyBilled ? `${n(r.previouslyBilled)} ${r.uom}` : "0"}</td><td className={s.num}>{n(r.thisInvoice)} {r.uom}</td><td className={s.num}>{n(r.remaining)} {r.uom}</td><td>{ROW[r.state]}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {v.inventory.rows.some((r) => r.priorClaims.length > 0) && <p className={s.srcMeta}>Earlier invoices on this PO: {v.inventory.rows.flatMap((r) => r.priorClaims.map((c) => `${c.invoiceId} (${n(c.qty)} ${r.uom})`)).join(", ")}.</p>}
          <p className={s.srcMeta}>Left = received, less returns and reversals, less what earlier invoices already claim. Billing above what was received is reported by the quantity check.</p>
        </section>
      </div>
    </>
  );
}
