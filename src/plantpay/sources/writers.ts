// Department-side simulators. In a real plant, Warehouse, Quality and Supplier master data post their own records; these functions
// play that role in the demo and tests by writing to the source database FILE directly (the integration connectors never write),
// then publish the matching event to the outbox. This is the only code that writes to a source database after seeding.
import Database from "better-sqlite3";
import type { EventType } from "../integration";
import { emitEvent } from "../integration";
import { SOURCES_DIR, sourceFile, supplierCode } from "./build";
import type { SourceId } from "./schemas";

export interface WriterCtx { integration: Database.Database; dir?: string; now?: () => string }
const withDb = <T,>(ctx: WriterCtx, id: SourceId, fn: (db: Database.Database) => T): T => {
  const db = new Database(sourceFile(id, ctx.dir ?? SOURCES_DIR));
  try { return db.transaction(() => fn(db))(); } finally { db.close(); }
};
const at = (ctx: WriterCtx) => (ctx.now ?? (() => new Date().toISOString()))();
const emit = (ctx: WriterCtx, type: EventType, source: SourceId, payload: Record<string, unknown>) => emitEvent(ctx.integration, type, source, payload, at(ctx));

/** Warehouse posts a goods receipt against a PO. Returns the new GRN number. */
export function postGoodsReceipt(ctx: WriterCtx, o: { poId: string; receivedOn: string; receivedBy?: string; lines: { lineNo: number; qty: number; uom: string }[] }): string {
  const grn = withDb(ctx, "warehouse", (db) => {
    const max = (db.prepare("SELECT MAX(CAST(SUBSTR(grn_no, 5) AS INTEGER)) m FROM goods_receipts").get() as { m: number | null }).m ?? 5000000000;
    const no = `GRN-${Math.max(max, 5200000000) + 1}`;
    const staff = (db.prepare("SELECT id FROM store_staff ORDER BY id LIMIT 1").get() as { id: string }).id;
    db.prepare("INSERT INTO goods_receipts VALUES (?,?,?,?)").run(no, `PO-${o.poId}`, o.receivedOn, o.receivedBy ?? staff);
    for (const l of o.lines) db.prepare("INSERT INTO grn_lines VALUES (?,?,?,?)").run(no, l.lineNo, l.qty, l.uom);
    return no;
  });
  emit(ctx, "grn_posted", "warehouse", { poId: o.poId, grnNo: grn });
  return grn;
}

/** Quality records an inspection result for a goods receipt. */
export function recordInspection(ctx: WriterCtx, o: { poId: string; grnNo: string; inspectedOn: string; inspector?: string; lines: { lineNo: number; inspected: number; accepted: number; uom: string; reason?: string }[] }): string {
  const no = withDb(ctx, "quality", (db) => {
    const n = `QI-${o.grnNo}`;
    db.prepare("INSERT INTO inspections VALUES (?,?,?,?,?)").run(n, o.grnNo, `PO-${o.poId}`, o.inspectedOn, o.inspector ?? "Mahesh Gaikwad (QC)");
    for (const l of o.lines) db.prepare("INSERT INTO inspection_lines VALUES (?,?,?,?,?,?,?)").run(n, l.lineNo, l.inspected, l.accepted, l.inspected - l.accepted, l.uom, l.reason ?? null);
    return n;
  });
  emit(ctx, "inspection_completed", "quality", { poId: o.poId, inspectionNo: no });
  return no;
}

/** Supplier master data records a bank change request: the old account is closed, the new one is pending independent verification. */
export function changeBankDetails(ctx: WriterCtx, o: { vendorId: string; accountNo: string; ifsc: string; bankName: string; changedOn: string }): void {
  withDb(ctx, "supplier", (db) => {
    const code = supplierCode(o.vendorId);
    db.prepare("UPDATE bank_accounts SET status = 'closed', valid_to = ? WHERE supplier_code = ? AND status = 'verified'").run(o.changedOn, code);
    const n = (db.prepare("SELECT COUNT(*) n FROM bank_accounts WHERE supplier_code = ?").get(code) as { n: number }).n;
    db.prepare("INSERT INTO bank_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(`B-${o.vendorId.slice(2)}-${n + 1}`, code, o.bankName, o.accountNo, o.ifsc, "pending_verification", o.changedOn, null, null, null, "Change requested; call-back verification not yet done.");
  });
  emit(ctx, "bank_details_changed", "supplier", { supplierId: o.vendorId, accountNo: o.accountNo });
}

/** Supplier master data records that a call-back to a known contact confirmed the new account. */
export function verifyBankDetails(ctx: WriterCtx, o: { vendorId: string; accountNo: string; verifiedOn: string; verifiedBy: string }): void {
  withDb(ctx, "supplier", (db) => {
    db.prepare("UPDATE bank_accounts SET status = 'verified', verified_on = ?, verified_by = ?, note = 'Verified by call-back to a contact already on file.' WHERE supplier_code = ? AND account_no = ?").run(o.verifiedOn, o.verifiedBy, supplierCode(o.vendorId), o.accountNo);
  });
  emit(ctx, "bank_details_changed", "supplier", { supplierId: o.vendorId, accountNo: o.accountNo, verified: true });
}

/** Procurement amends a PO line price (for example to the amended contract price) and records the change history. */
export function amendPoPrice(ctx: WriterCtx, o: { poId: string; lineNo: number; newPrice: number; reason: string; changedBy?: string; changedOn: string }): void {
  withDb(ctx, "procurement", (db) => {
    const row = db.prepare("SELECT unit_price FROM po_lines WHERE po_number = ? AND line_no = ?").get(o.poId, o.lineNo) as { unit_price: number } | undefined;
    if (!row) throw new Error(`PO ${o.poId} line ${o.lineNo} not found`);
    const who = o.changedBy ?? (db.prepare("SELECT id FROM buyers ORDER BY id LIMIT 1").get() as { id: string }).id;
    db.prepare("INSERT INTO po_change_history (po_number,line_no,field,old_value,new_value,changed_on,changed_by,reason) VALUES (?,?,?,?,?,?,?,?)").run(o.poId, o.lineNo, "unit_price", String(row.unit_price), String(o.newPrice), o.changedOn, who, o.reason);
    db.prepare("UPDATE po_lines SET unit_price = ? WHERE po_number = ? AND line_no = ?").run(o.newPrice, o.poId, o.lineNo);
  });
  emit(ctx, "po_amended", "procurement", { poId: o.poId, lineNo: o.lineNo, newPrice: o.newPrice });
}

/** Procurement adds a unit conversion to the material unit table. */
export function addUnitConversion(ctx: WriterCtx, o: { poId: string; materialCode: string; fromUom: string; toUom: string; factor: number }): void {
  withDb(ctx, "procurement", (db) => { db.prepare("INSERT OR REPLACE INTO material_uoms VALUES (?,?,?,?)").run(o.materialCode, o.fromUom, o.toUom, o.factor); });
  emit(ctx, "master_data_changed", "procurement", { poId: o.poId, materialCode: o.materialCode });
}

/** Logistics confirms a re-weigh: the weighbridge record is replaced by the confirmed net weight. */
export function confirmReweigh(ctx: WriterCtx, o: { poId: string; netKg: number }): void {
  withDb(ctx, "logistics", (db) => {
    const rows = db.prepare("SELECT record_no, tare_t, net_t FROM weighbridge_records WHERE po_no = ? ORDER BY record_no").all(o.poId) as { record_no: string; tare_t: number; net_t: number }[];
    if (rows.length === 0) throw new Error(`No weighbridge record for PO ${o.poId}`);
    const others = rows.slice(1).reduce((a, r) => a + r.net_t, 0);
    const net = Math.max(0, o.netKg / 1000 - others);
    db.prepare("UPDATE weighbridge_records SET net_t = ?, gross_t = ? WHERE record_no = ?").run(net, net + rows[0].tare_t, rows[0].record_no);
  });
  emit(ctx, "weighbridge_recorded", "logistics", { poId: o.poId, netKg: o.netKg });
}

/** The supplier issues a corrected invoice: Finance records the new price, quantity, unit, tax rate or item code on a line and totals are recomputed. */
export function correctInvoiceLine(ctx: WriterCtx, o: { invoiceId: string; lineNo: number; set: { unitPrice?: number; qty?: number; taxRatePct?: number; materialCode?: string; uom?: string } }): void {
  withDb(ctx, "finance", (db) => {
    const l = db.prepare("SELECT * FROM invoice_lines WHERE invoice_no = ? AND line_no = ?").get(o.invoiceId, o.lineNo) as { qty: number; unit_price_paise: number; tax_rate_pct: number; material_code: string | null; uom: string } | undefined;
    if (!l) throw new Error(`Invoice ${o.invoiceId} line ${o.lineNo} not found`);
    const qty = o.set.qty ?? l.qty, price = o.set.unitPrice !== undefined ? Math.round(o.set.unitPrice * 100) : l.unit_price_paise, rate = o.set.taxRatePct ?? l.tax_rate_pct;
    db.prepare("UPDATE invoice_lines SET qty = ?, unit_price_paise = ?, tax_rate_pct = ?, material_code = ?, uom = ?, amount_paise = ? WHERE invoice_no = ? AND line_no = ?")
      .run(qty, price, rate, o.set.materialCode ?? l.material_code, o.set.uom ?? l.uom, Math.round(qty * price), o.invoiceId, o.lineNo);
    const all = db.prepare("SELECT amount_paise, tax_rate_pct FROM invoice_lines WHERE invoice_no = ?").all(o.invoiceId) as { amount_paise: number; tax_rate_pct: number }[];
    const sub = all.reduce((a, x) => a + x.amount_paise, 0), tax = Math.round(all.reduce((a, x) => a + (x.amount_paise * x.tax_rate_pct) / 100, 0));
    db.prepare("UPDATE invoices SET subtotal_paise = ?, tax_paise = ?, total_paise = ? WHERE invoice_no = ?").run(sub, tax, sub + tax, o.invoiceId);
  });
  emit(ctx, "invoice_corrected", "finance", { invoiceId: o.invoiceId, lineNo: o.lineNo });
}

/** An AP clerk records, with a reason, whether a look-alike invoice is a duplicate. */
export function recordDuplicateDecision(ctx: WriterCtx, o: { invoiceId: string; matchedInvoiceId: string; decision: "duplicate" | "not_duplicate"; by: string; reason: string }): void {
  ctx.integration.prepare("INSERT OR REPLACE INTO duplicate_decisions VALUES (?,?,?,?,?,?)").run(o.invoiceId, o.matchedInvoiceId, o.decision, o.by, o.reason, at(ctx));
  emit(ctx, "invoice_corrected", "finance", { invoiceId: o.invoiceId, decision: o.decision });
}

export const announceInvoiceReceived = (ctx: WriterCtx, invoiceId: string) => emit(ctx, "invoice_received", "finance", { invoiceId });
