// Splits the Stage 1 dataset into the six source databases (the migration) and writes them as SQLite files.
// Source-native conventions are applied here (paise, tonnes, GRN-/PO-/SUP- prefixes); connectors undo them.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Dataset } from "../../foundation/generate";
import { SOURCE_DDL, SOURCE_IDS, type SourceId } from "./schemas";

export const SOURCES_DIR = process.env.PLANTPAY_SOURCES_DIR ?? path.join(process.cwd(), "data", "sources");
export const sourceFile = (id: SourceId, dir = SOURCES_DIR) => path.join(dir, `${id}.db`);

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const supplierCode = (vendorId: string) => `SUP-${vendorId.slice(2)}`;

/** Synthetic commercial terms per contract (early-payment discount, late-payment interest, whether the payment date is contractual).
 *  Deterministic from the contract number, so every rebuild is identical. */
export function contractTermsFor(contractNo: string) {
  let h = 2166136261; for (const ch of contractNo) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const discount = [0, 0, 1, 1.5, 2][h % 5];
  return { earlyPayDiscountPct: discount, earlyPayWithinDays: discount ? 10 : 0, latePaymentInterestPctMonth: 1.5, strictPaymentDate: ((h >>> 8) % 3) === 0 };
}

/** Create (or replace) the six database files from a dataset. `dir` may be a temp folder for tests. */
export function buildSourceDatabases(ds: Dataset, dir = SOURCES_DIR): void {
  fs.mkdirSync(dir, { recursive: true });
  const dbs = {} as Record<SourceId, Database.Database>;
  for (const id of SOURCE_IDS) {
    for (const ext of ["", "-wal", "-shm"]) fs.rmSync(sourceFile(id, dir) + ext, { force: true });
    dbs[id] = new Database(sourceFile(id, dir));
    dbs[id].exec(SOURCE_DDL[id]);
  }
  const ins = (id: SourceId, table: string, rows: unknown[][]) => {
    if (!rows.length) return;
    const st = dbs[id].prepare(`INSERT INTO ${table} VALUES (${rows[0].map(() => "?").join(",")})`);
    dbs[id].transaction(() => rows.forEach((r) => st.run(...r)))();
  };
  const insNamed = (id: SourceId, table: string, cols: string, rows: unknown[][]) => {
    if (!rows.length) return;
    const st = dbs[id].prepare(`INSERT INTO ${table} (${cols}) VALUES (${rows[0].map(() => "?").join(",")})`);
    dbs[id].transaction(() => rows.forEach((r) => st.run(...r)))();
  };
  const emp = (name: string) => ds.employees.find((e) => e.name === name.replace(/ \(Stores\)$/, ""))!.id;

  // procurement
  ins("procurement", "suppliers_ref", ds.vendors.map((v) => [v.id, v.name, v.gstin, v.active ? 1 : 0]));
  ins("procurement", "buyers", ds.employees.filter((e) => e.role === "buyer").map((e) => [e.id, e.name, e.title]));
  ins("procurement", "materials", ds.materials.map((m) => [m.code, m.description, m.baseUom, m.standardPrice, m.hsn]));
  ins("procurement", "material_uoms", ds.materialUoms.map((u) => [u.itemCode, u.fromUom, u.toUom, u.factor]));
  ins("procurement", "contracts", ds.contracts.map((c) => [c.id, c.vendorId, c.validFrom, c.validTo]));
  ins("procurement", "contract_prices", ds.contractPrices.map((p) => [p.contractId, p.materialCode, p.uom, p.unitPrice, p.effectiveFrom]));
  insNamed("procurement", "contract_amendments", "contract_no,material_code,old_price,new_price,effective_from,signed_on,note", ds.amendments.map((a) => [a.contractId, a.materialCode, a.oldPrice, a.newPrice, a.effectiveFrom, a.signedOn, a.note]));
  ins("procurement", "contract_terms", ds.contracts.map((c) => { const t = contractTermsFor(c.id); return [c.id, t.earlyPayDiscountPct, t.earlyPayWithinDays, t.latePaymentInterestPctMonth, t.strictPaymentDate ? 1 : 0]; }));
  ins("procurement", "purchase_orders", ds.purchaseOrders.map((p) => [p.id, p.vendorId, p.contractId || null, emp(p.buyer), p.issuedOn]));
  ins("procurement", "po_lines", ds.purchaseOrders.flatMap((p) => p.lines.map((l) => [p.id, l.lineNo, l.itemCode, l.description, l.qty, l.uom, l.unitPrice, l.taxCode, l.taxRatePct])));
  insNamed("procurement", "po_change_history", "po_number,line_no,field,old_value,new_value,changed_on,changed_by,reason", ds.poHistory.map((h) => [h.poId, h.lineNo, h.field, h.oldValue, h.newValue, h.changedOn, h.changedBy, h.reason]));

  // warehouse
  ins("warehouse", "store_staff", ds.employees.filter((e) => e.role === "stores").map((e) => [e.id, e.name, e.title]));
  ins("warehouse", "goods_receipts", ds.goodsReceipts.map((g) => [`GRN-${g.id}`, `PO-${g.poId}`, g.receivedOn, emp(g.receivedBy)]));
  ins("warehouse", "grn_lines", ds.goodsReceipts.flatMap((g) => g.lines.map((l) => [`GRN-${g.id}`, l.lineNo, l.qtyReceived, l.uom])));
  ins("warehouse", "delivery_notes", ds.deliveryNotes.map((d) => [d.id, `PO-${d.poId}`, d.deliveredOn]));
  ins("warehouse", "delivery_note_lines", ds.deliveryNotes.flatMap((d) => d.lines.map((l) => [d.id, l.itemCode, l.qty, l.uom])));
  insNamed("warehouse", "stock_transactions", "material_code,txn_type,qty,uom,txn_date,ref_type,ref_id", ds.inventory.map((t) => [t.materialCode, t.type, t.qty, t.uom, t.date, t.refType, t.refType === "GR" || t.refType === "RETURN" || t.refType === "REVERSAL" ? `GRN-${t.refId}` : t.refId]));

  // quality
  ins("quality", "inspections", ds.inspections.map((i) => [i.id, `GRN-${i.grId}`, `PO-${i.poId}`, i.inspectedOn, i.inspector]));
  ins("quality", "inspection_lines", ds.inspections.flatMap((i) => i.lines.map((l) => [i.id, l.poLineNo, l.qtyInspected, l.qtyAccepted, l.qtyRejected, l.uom, l.reason ?? null])));

  // finance (amounts in paise)
  ins("finance", "finance_staff", ds.employees.filter((e) => ["ap_clerk", "approver_l1", "approver_l2"].includes(e.role)).map((e) => [e.id, e.name, e.title, e.role, e.limit]));
  ins("finance", "invoices", ds.invoices.map((i) => [i.id, i.vendorId, i.poId ?? null, i.invoiceDate, i.receivedOn, i.currency, toPaise(i.subtotal), toPaise(i.tax), toPaise(i.total), i.status, i.sourceFile ?? null, ds.remit[i.id]?.accountNo ?? null, ds.remit[i.id]?.ifsc ?? null, i.resolvedOn ?? null, ds.invoiceGstin?.[i.id] ?? ds.vendors.find((v) => v.id === i.vendorId)?.gstin ?? null]));
  ins("finance", "invoice_lines", ds.invoices.flatMap((i) => i.lines.map((l) => [i.id, l.lineNo, l.itemCode ?? null, l.description, l.qty, l.uom, toPaise(l.unitPrice), l.taxRatePct, toPaise(l.amount)])));
  ins("finance", "approvals", ds.approvals.map((a) => [a.invoiceId, a.approverId, a.level, a.approvedOn]));
  ins("finance", "payments", ds.payments.map((p) => [p.invoiceId, p.paidOn, toPaise(p.amount), p.utr]));

  // logistics (weights in tonnes)
  ins("logistics", "shipments", ds.shipments.map((s) => [s.id, s.poId, s.dispatchedOn, s.deliveredOn ?? null, s.status]));
  ins("logistics", "gate_entries", ds.gateEntries.map((g) => [g.id, g.poId, `GRN-${g.grId}`, g.vehicleNo, g.enteredOn]));
  ins("logistics", "weighbridge_records", ds.weighbridge.map((w) => [w.id, w.gateEntryId, w.poId, w.weighedOn, w.grossKg / 1000, w.tareKg / 1000, w.netKg / 1000]));

  // supplier
  ins("supplier", "suppliers", ds.vendors.map((v) => [supplierCode(v.id), v.name, v.gstin, v.stateCode, v.active ? 1 : 0, v.paymentTermsDays, v.onboardedOn]));
  insNamed("supplier", "addresses", "supplier_code,kind,line,city,pincode,valid_from,valid_to", ds.addresses.map((a) => [supplierCode(a.vendorId), a.kind, a.line, a.city, a.pincode, a.validFrom ?? null, a.validTo ?? null]));
  insNamed("supplier", "contacts", "supplier_code,name,phone,email", ds.contacts.map((c) => [supplierCode(c.vendorId), c.name, c.phone, c.email]));
  ins("supplier", "bank_accounts", ds.banks.map((b) => [b.id, supplierCode(b.vendorId), b.bankName, b.accountNo, b.ifsc, b.status, b.validFrom, b.validTo ?? null, b.verifiedOn ?? null, b.verifiedBy ?? null, b.note ?? null]));

  for (const id of SOURCE_IDS) dbs[id].close();
}
