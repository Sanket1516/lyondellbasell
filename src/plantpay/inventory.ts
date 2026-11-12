// Stage 4B: inventory-aware verification. Runs AFTER the unchanged three-way match and adds what three-way cannot see:
//   - returns and reversals recorded in the warehouse stock ledger (goods that came in and went back to the supplier),
//   - what earlier invoices on the same PO have already claimed against the same receipts (allocation),
//   - the same quantity claimed twice.
// Pure and deterministic. Missing inventory records never fail silently: the stage reports "skipped" with the reason.
//
// Not duplicated here: an invoice that bills more than was received on its own is the quantity check's finding; the line is
// marked "reported by the quantity check" and no second finding is raised.
import { uomFactor } from "../engine/match";
import { ENGINE_CONFIG } from "../engine/config";
import { fmtDate, fmtInr } from "../lib/format";
import { earlierThan } from "../foundation/threeWay";
import type { CanonicalBundle } from "./canonical";
import type { SkipInfo } from "./contractCheck";
import type { CrossFinding } from "./rules";

export interface PriorClaim { invoiceId: string; qty: number; status: string; invoiceDate: string }
export interface InventoryLineRow {
  lineNo: number; itemCode: string; uom: string;
  received: number; returned: number; reversed: number;
  /** received less returns and reversals: what the plant actually holds a claim to pay for. */
  net: number;
  previouslyBilled: number; thisInvoice: number;
  /** What this invoice may still bill: net less earlier claims (never below zero). */
  remaining: number;
  priorClaims: PriorClaim[];
  state: "ok" | "discrepancy" | "raised_by_quantity_check" | "raised_by_duplicate_check" | "skipped";
  note: string;
}
export interface InventoryOutcome { evaluated: boolean; skip?: SkipInfo; rows: InventoryLineRow[]; findings: CrossFinding[]; note: string }

const EPS = 1e-9;
const q = (n: number) => (Number.isInteger(n) ? fmtInr(n, 0) : fmtInr(Math.round(n * 1000) / 1000, 3).replace(/0+$/, "").replace(/\.$/, ""));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface InventoryOptions {
  /** Earlier invoices the three-way duplicate check already reports this invoice as a copy of. Not raised a second time here. */
  reportedDuplicates?: ReadonlySet<string>;
}

export function inventoryCheck(b: CanonicalBundle, opts: InventoryOptions = {}): InventoryOutcome {
  const none = (kind: SkipInfo["kind"], reason: string): InventoryOutcome => ({ evaluated: false, skip: { kind, reason }, rows: [], findings: [], note: `Skipped: ${reason}` });
  const po = b.po;
  if (!po) return none("not_applicable", "there is no PO to allocate quantities against.");
  if (b.goodsReceipts.length === 0) return none("not_applicable", "nothing has been received on this PO yet, so there is no inventory to verify. The quantity check covers this.");
  const missing = b.goodsReceipts.filter((g) => !b.stockLedger.some((t) => t.grId === g.id && t.type === "GR"));
  if (missing.length) return none("no_records", `the stock ledger has no entries for ${missing.map((g) => `GRN ${g.id}`).join(", ")}, so receipt quantities, returns and earlier allocations could not be verified.`);

  const tol = ENGINE_CONFIG.qtyPct;
  // A clerk who compared two documents and recorded, with a reason, that this is a different bill has made a documented decision: that
  // earlier invoice is not counted against this one.
  const dec = b.invoice.duplicateDecision;
  const earlier = earlierThan(b.invoice, b.relatedInvoices).filter((o) => o.poId === po.id && !(dec?.decision === "not_duplicate" && dec.matchedInvoiceId === o.id));
  const rows: InventoryLineRow[] = [];
  const findings: CrossFinding[] = [];

  for (const line of b.invoice.lines) {
    const pl = po.lines.find((p) => (line.itemCode ? p.itemCode === line.itemCode : p.description.toLowerCase() === line.description.toLowerCase()));
    if (!pl) continue; // the purchase-order check owns lines that are not on the PO
    const blank = { lineNo: line.lineNo, itemCode: pl.itemCode, uom: pl.uom, received: 0, returned: 0, reversed: 0, net: 0, previouslyBilled: 0, thisInvoice: 0, remaining: 0, priorClaims: [] as PriorClaim[] };
    const conv = uomFactor(b.uomRules, pl.itemCode, line.uom, pl.uom);
    if (!conv) { rows.push({ ...blank, state: "skipped", note: `Invoice unit ${line.uom} has no conversion to ${pl.uom}; the unit check owns this.` }); continue; }
    const toPo = (qty: number, uom: string) => qty * (uomFactor(b.uomRules, pl.itemCode, uom, pl.uom)?.factor ?? 1);
    const billed = r3(line.qty * conv.factor);
    const grRows = b.goodsReceipts.flatMap((g) => g.lines.filter((l) => l.lineNo === pl.lineNo).map((l) => ({ g, l })));
    const received = r3(grRows.reduce((a, r) => a + r.l.qtyReceived, 0));
    const rets = b.stockLedger.filter((t) => t.materialCode === pl.itemCode && t.type === "RETURN");
    const revs = b.stockLedger.filter((t) => t.materialCode === pl.itemCode && t.type === "REVERSAL");
    const returned = r3(rets.reduce((a, t) => a + toPo(t.qty, t.uom), 0)), reversed = r3(revs.reduce((a, t) => a + toPo(t.qty, t.uom), 0));
    const net = r3(received - returned - reversed);
    const priorClaims: PriorClaim[] = earlier.flatMap((o) => o.lines.filter((l) => l.itemCode === pl.itemCode).map((l) => ({ invoiceId: o.id, qty: r3(toPo(l.qty, l.uom)), status: o.status, invoiceDate: o.invoiceDate })));
    const prior = r3(priorClaims.reduce((a, c) => a + c.qty, 0));
    const remaining = Math.max(0, r3(net - prior));
    const row = { ...blank, received, returned, reversed, net, previouslyBilled: prior, thisInvoice: billed, remaining, priorClaims };
    const cumulative = prior + billed;

    if (cumulative <= net * (1 + tol / 100) + EPS) { rows.push({ ...row, state: "ok", note: `${q(billed)} ${pl.uom} billed${prior ? ` after ${q(prior)} ${pl.uom} on earlier invoices` : ""}; ${q(net)} ${pl.uom} net received${returned + reversed ? " after returns" : ""}.` }); continue; }
    if (billed > received * (1 + tol / 100) + EPS) { rows.push({ ...row, state: "raised_by_quantity_check", note: `Billed ${q(billed)} ${pl.uom} is above the ${q(received)} ${pl.uom} received; the quantity check reports this.` }); continue; }

    const grEv = grRows.map((r) => `Goods receipt ${r.g.id} (${fmtDate(r.g.receivedOn)}): ${q(r.l.qtyReceived)} ${r.l.uom} on PO line ${pl.lineNo}.`);
    const retEv = [...rets.map((t) => `Stock ledger ${fmtDate(t.date)}: ${q(t.qty)} ${t.uom} of ${t.materialCode} RETURNED to the supplier against GRN ${t.grId}.`), ...revs.map((t) => `Stock ledger ${fmtDate(t.date)}: receipt of ${q(t.qty)} ${t.uom} of ${t.materialCode} REVERSED against GRN ${t.grId}.`)];
    const priorEv = priorClaims.map((c) => `Earlier invoice ${c.invoiceId} (${fmtDate(c.invoiceDate)}, ${c.status.replace("_", " ")}) claims ${q(c.qty)} ${pl.uom}.`);
    const allowedInv = r3(remaining / conv.factor);
    const fixQty = `${q(allowedInv)} ${line.uom}`;
    const returnedGoods = returned + reversed > 0 && cumulative <= received * (1 + tol / 100) + EPS;
    const same = priorClaims.find((c) => Math.abs(c.qty - billed) <= EPS && c.qty > 0);
    const duplicateClaim = !returnedGoods && !!same;
    if (duplicateClaim && opts.reportedDuplicates?.has(same!.invoiceId)) { rows.push({ ...row, state: "raised_by_duplicate_check", note: `Same quantity as ${same!.invoiceId}; the duplicate check already reports this invoice as a possible copy of it.` }); continue; }
    let f: CrossFinding;
    if (returnedGoods) {
      f = {
        check: "inventory", lineNo: line.lineNo,
        message: `Line ${line.lineNo} (${pl.itemCode}): ${q(cumulative)} ${pl.uom} is billed${prior ? ` including earlier invoices` : ""}, but ${q(returned + reversed)} ${pl.uom} of the ${q(received)} ${pl.uom} received was ${returned ? "returned to the supplier" : "reversed"}, leaving ${q(net)} ${pl.uom} to pay for.`,
        expected: `${q(net)} ${pl.uom} net of returns`, actual: `${q(cumulative)} ${pl.uom} billed`,
        rootCause: "Returned goods are included in the invoice", owner: "Supplier",
        smallestFix: remaining > 0 ? `Passes if the supplier issues a credit note or corrected invoice reducing this line to ${fixQty}, or Warehouse reverses the return entry if it was posted in error.` : "Passes if the supplier credits this invoice in full, or Warehouse reverses the return entry if it was posted in error.",
        evidence: [...grEv, ...retEv, ...priorEv],
      };
    } else if (duplicateClaim) {
      f = {
        check: "inventory", lineNo: line.lineNo,
        message: `Line ${line.lineNo} (${pl.itemCode}): this invoice claims ${q(billed)} ${pl.uom}, the same quantity an earlier invoice (${priorClaims.find((c) => Math.abs(c.qty - billed) <= EPS)!.invoiceId}) already claims against the ${q(received)} ${pl.uom} received. Together they claim ${q(cumulative)} ${pl.uom}.`,
        expected: `At most ${q(net)} ${pl.uom} claimed in total`, actual: `${q(cumulative)} ${pl.uom} claimed`,
        rootCause: "Same quantity claimed by two invoices", owner: "AP Clerk",
        smallestFix: remaining > 0 ? `Passes if a clerk compares the two invoices with the supplier and this one is reduced to ${fixQty}, or the supplier shows a second delivery.` : "Passes if a clerk compares the two invoices with the supplier and confirms a second delivery, or this invoice is withdrawn.",
        evidence: [...grEv, ...priorEv],
      };
    } else {
      f = {
        check: "inventory", lineNo: line.lineNo,
        message: `Line ${line.lineNo} (${pl.itemCode}): this invoice bills ${q(billed)} ${pl.uom}; earlier invoices already claim ${q(prior)} ${pl.uom} of the ${q(net)} ${pl.uom} received${returned + reversed ? " (net of returns)" : ""}, so ${q(cumulative)} ${pl.uom} would be claimed in total.`,
        expected: `At most ${q(net)} ${pl.uom} claimed in total`, actual: `${q(cumulative)} ${pl.uom} claimed`,
        rootCause: "Receipt already allocated to earlier invoices", owner: "AP Clerk",
        smallestFix: remaining > 0 ? `Passes if the supplier reduces this invoice to the ${fixQty} still unbilled, or Warehouse posts a further receipt if more goods were delivered.` : "Passes if Warehouse posts a further receipt that covers this invoice, or the supplier withdraws it.",
        evidence: [...grEv, ...retEv, ...priorEv],
      };
    }
    findings.push(f);
    rows.push({ ...row, state: "discrepancy", note: f.message });
  }
  return {
    evaluated: true, rows, findings,
    note: findings.length ? findings.map((f) => f.message).join(" ") : `Receipts, returns and earlier invoices were reconciled for ${rows.length} line(s); ${rows.every((r) => r.state === "ok") ? "billing stays within what the plant holds a claim to pay for" : "the quantity check reports the remaining difference"}.`,
  };
}
