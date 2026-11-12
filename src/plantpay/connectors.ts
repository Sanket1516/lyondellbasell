// Read-only connectors: one per source database, all behind the SourceConnector interface.
// Every read opens the file with SQLite's readonly flag (a write attempt throws), honours the outage toggle, records the last
// successful sync, and converts any failure into SourceUnavailableError so callers degrade instead of crashing.
// Connectors return records in the source's own native shape; src/plantpay/canonical.ts normalises them.
import fs from "node:fs";
import Database from "better-sqlite3";
import { isOutage, recordSourceError, touchSync } from "./integration";
import { SOURCE_IDS, SOURCE_META, type SourceId } from "./sources/schemas";
import { SOURCES_DIR, sourceFile } from "./sources/build";

export class SourceUnavailableError extends Error {
  constructor(public readonly source: SourceId, public readonly reason: string) {
    super(`${SOURCE_META[source].label} is unavailable: ${reason}`);
    this.name = "SourceUnavailableError";
  }
}

export interface SourceHealth { id: SourceId; label: string; owner: string; holds: string; status: "up" | "down"; lastSync: string | null; records: number | null; error: string | null }
export interface SourceConnector { readonly id: SourceId; readonly label: string; health(): SourceHealth }

type Row = Record<string, unknown>;
const PRIMARY_TABLE: Record<SourceId, string> = { procurement: "purchase_orders", warehouse: "goods_receipts", quality: "inspections", finance: "invoices", logistics: "gate_entries", supplier: "suppliers" };

abstract class BaseConnector implements SourceConnector {
  readonly label: string;
  private conn?: Database.Database;
  private lastTouch = 0;
  constructor(readonly id: SourceId, private readonly integration: Database.Database, private readonly dir: string, private readonly now: () => string) { this.label = SOURCE_META[id].label; }

  protected open(): Database.Database {
    if (isOutage(this.integration, this.id)) throw new SourceUnavailableError(this.id, "simulated outage");
    if (!this.conn) {
      const file = sourceFile(this.id, this.dir);
      if (!fs.existsSync(file)) throw new SourceUnavailableError(this.id, "database file not found. Run: npm run seed:sources");
      this.conn = new Database(file, { readonly: true, fileMustExist: true });
    }
    return this.conn;
  }
  /** Run a read query. Never throws anything except SourceUnavailableError. */
  protected rows(sql: string, ...params: unknown[]): Row[] {
    try {
      const out = this.open().prepare(sql).all(...params) as Row[];
      const t = Date.now();
      if (t - this.lastTouch > 1000) { this.lastTouch = t; touchSync(this.integration, this.id, this.now()); }
      return out;
    } catch (e) {
      if (e instanceof SourceUnavailableError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.conn?.close(); this.conn = undefined;
      recordSourceError(this.integration, this.id, msg);
      throw new SourceUnavailableError(this.id, "read failed");
    }
  }
  protected one(sql: string, ...params: unknown[]): Row | undefined { return this.rows(sql, ...params)[0]; }

  close() { this.conn?.close(); this.conn = undefined; }

  /** True when a write attempt is rejected, which proves the connection is read-only. */
  assertReadOnly(): boolean {
    try { this.open().exec("CREATE TABLE _write_probe (x INTEGER)"); return false; } catch (e) { if (e instanceof SourceUnavailableError) throw e; return true; }
  }

  health(): SourceHealth {
    const meta = SOURCE_META[this.id];
    const state = this.integration.prepare("SELECT last_sync, last_error FROM source_state WHERE source = ?").get(this.id) as { last_sync: string | null; last_error: string | null };
    try {
      const n = (this.one(`SELECT COUNT(*) n FROM ${PRIMARY_TABLE[this.id]}`) as { n: number }).n;
      const fresh = this.integration.prepare("SELECT last_sync FROM source_state WHERE source = ?").get(this.id) as { last_sync: string | null };
      return { id: this.id, label: meta.label, owner: meta.owner, holds: meta.holds, status: "up", lastSync: fresh.last_sync, records: n, error: null };
    } catch (e) {
      return { id: this.id, label: meta.label, owner: meta.owner, holds: meta.holds, status: "down", lastSync: state.last_sync, records: null, error: e instanceof SourceUnavailableError ? e.reason : "unavailable" };
    }
  }
}

export class ProcurementConnector extends BaseConnector {
  purchaseOrder(poNumber: string) {
    const header = this.one("SELECT p.*, b.name AS buyer_name FROM purchase_orders p LEFT JOIN buyers b ON b.id = p.buyer_id WHERE po_number = ?", poNumber);
    return header ? { header, lines: this.rows("SELECT * FROM po_lines WHERE po_number = ? ORDER BY line_no", poNumber), changes: this.rows("SELECT * FROM po_change_history WHERE po_number = ? ORDER BY id", poNumber) } : undefined;
  }
  contract(contractNo: string) {
    const header = this.one("SELECT * FROM contracts WHERE contract_no = ?", contractNo);
    return header ? { header, prices: this.rows("SELECT * FROM contract_prices WHERE contract_no = ? ORDER BY material_code, effective_from DESC", contractNo), amendments: this.rows("SELECT * FROM contract_amendments WHERE contract_no = ? ORDER BY effective_from", contractNo) } : undefined;
  }
  contractsForSupplier(supplierId: string) { return this.rows("SELECT contract_no FROM contracts WHERE supplier_id = ?", supplierId).map((r) => r.contract_no as string); }
  uomRules(materialCodes: string[]) { return materialCodes.length ? this.rows(`SELECT * FROM material_uoms WHERE material_code IN (${materialCodes.map(() => "?").join(",")})`, ...materialCodes) : []; }
  material(code: string) { return this.one("SELECT * FROM materials WHERE code = ?", code); }
  supplierRef(supplierId: string) { return this.one("SELECT * FROM suppliers_ref WHERE supplier_id = ?", supplierId); }
  allContracts() { return this.rows("SELECT contract_no FROM contracts").map((r) => r.contract_no as string); }
  supplierNames(): Record<string, string> { return Object.fromEntries(this.rows("SELECT supplier_id, name FROM suppliers_ref").map((r) => [String(r.supplier_id), String(r.name)])); }
  /** Bulk reads for supplier intelligence and the prediction models. */
  poSummaries() { return this.rows("SELECT po_number, supplier_id, contract_no, issued_on FROM purchase_orders"); }
  poLineValues() { return this.rows("SELECT po_number, material_code, qty * unit_price AS value FROM po_lines"); }
  allMaterials() { return this.rows("SELECT code, description, base_uom FROM materials"); }
  allAmendments() { return this.rows("SELECT a.contract_no, c.supplier_id, a.material_code, a.old_price, a.new_price, a.effective_from, a.signed_on FROM contract_amendments a JOIN contracts c USING (contract_no)"); }
  poChangeCounts() { return this.rows("SELECT po_number, COUNT(*) AS n FROM po_change_history GROUP BY po_number"); }
  contractTerms() { return this.rows("SELECT t.*, c.supplier_id, c.valid_from, c.valid_to FROM contract_terms t JOIN contracts c USING (contract_no)"); }
  allPoNumbers() { return this.rows("SELECT po_number FROM purchase_orders").map((r) => r.po_number as string); }
}

export class WarehouseConnector extends BaseConnector {
  receiptsForPo(poRef: string) {
    return this.rows("SELECT g.*, s.name AS received_by_name FROM goods_receipts g LEFT JOIN store_staff s ON s.id = g.received_by WHERE po_ref = ? ORDER BY received_on, grn_no", poRef)
      .map((header) => ({ header, lines: this.rows("SELECT * FROM grn_lines WHERE grn_no = ? ORDER BY po_line_no", header.grn_no as string) }));
  }
  deliveryNotesForPo(poRef: string) {
    return this.rows("SELECT * FROM delivery_notes WHERE po_ref = ? ORDER BY delivered_on", poRef).map((header) => ({ header, lines: this.rows("SELECT * FROM delivery_note_lines WHERE dn_no = ?", header.dn_no as string) }));
  }
  /** Stock ledger rows that belong to goods receipts: the receipt itself (GR), returns to the supplier (RETURN) and reversals (REVERSAL). */
  ledgerForGrns(grnNos: string[]) {
    return grnNos.length ? this.rows(`SELECT * FROM stock_transactions WHERE ref_type IN ('GR','RETURN','REVERSAL') AND ref_id IN (${grnNos.map(() => "?").join(",")}) ORDER BY txn_date, id`, ...grnNos) : [];
  }
  receiptSummaries() { return this.rows("SELECT po_ref, MIN(received_on) AS first_on, MAX(received_on) AS last_on, COUNT(*) AS n FROM goods_receipts GROUP BY po_ref"); }
  stockFor(materialCodes: string[]) {
    return materialCodes.length ? this.rows(`SELECT material_code, SUM(qty) AS on_hand, uom FROM stock_transactions WHERE material_code IN (${materialCodes.map(() => "?").join(",")}) GROUP BY material_code, uom`, ...materialCodes) : [];
  }
}

export class QualityConnector extends BaseConnector {
  inspectionTotals() { return this.rows("SELECT i.po_ref, SUM(l.qty_inspected) AS inspected, SUM(l.qty_rejected) AS rejected FROM inspections i JOIN inspection_lines l USING (inspection_no) GROUP BY i.po_ref"); }
  inspectionsForPo(poRef: string) {
    return this.rows("SELECT * FROM inspections WHERE po_ref = ? ORDER BY inspected_on, inspection_no", poRef)
      .map((header) => ({ header, lines: this.rows("SELECT * FROM inspection_lines WHERE inspection_no = ? ORDER BY po_line_no", header.inspection_no as string) }));
  }
}

export class FinanceConnector extends BaseConnector {
  invoice(invoiceNo: string) {
    const header = this.one("SELECT * FROM invoices WHERE invoice_no = ?", invoiceNo);
    return header ? { header, lines: this.rows("SELECT * FROM invoice_lines WHERE invoice_no = ? ORDER BY line_no", invoiceNo), approvals: this.rows("SELECT a.*, f.name AS approver_name FROM approvals a LEFT JOIN finance_staff f ON f.id = a.approver_id WHERE invoice_no = ?", invoiceNo), payment: this.one("SELECT * FROM payments WHERE invoice_no = ?", invoiceNo) } : undefined;
  }
  /** Invoices for the duplicate and splitting checks: the same supplier, with their lines. */
  invoicesForSupplier(supplierId: string) {
    return this.rows("SELECT * FROM invoices WHERE supplier_id = ? ORDER BY received_on, invoice_no", supplierId).map((header) => ({ header, lines: this.rows("SELECT * FROM invoice_lines WHERE invoice_no = ? ORDER BY line_no", header.invoice_no as string) }));
  }
  recentApprovals(limit = 8) { return this.rows("SELECT a.invoice_no, a.level, a.approved_on, f.name AS approver, i.total_paise FROM approvals a JOIN invoices i ON i.invoice_no = a.invoice_no LEFT JOIN finance_staff f ON f.id = a.approver_id ORDER BY a.approved_on DESC, a.invoice_no LIMIT ?", limit); }
  invoiceNumbersForPo(poRef: string) { return this.rows("SELECT invoice_no FROM invoices WHERE po_ref = ?", poRef).map((r) => r.invoice_no as string); }
  /** Every invoice header with its approvals, for the relationship graph and history-wide checks. */
  allInvoicesWithApprovals(): (Row & { approvals: { approver_id: string; level: string; approved_on: string }[] })[] {
    const apps = new Map<string, { approver_id: string; level: string; approved_on: string }[]>();
    for (const a of this.rows("SELECT invoice_no, approver_id, level, approved_on FROM approvals")) { const k = String(a.invoice_no); (apps.get(k) ?? apps.set(k, []).get(k)!).push(a as never); }
    return this.rows("SELECT invoice_no, supplier_id, po_ref, invoice_date, total_paise, remit_account_no FROM invoices").map((h) => ({ ...(h as Record<string, unknown>), approvals: apps.get(String(h.invoice_no)) ?? [] })) as (Row & { approvals: { approver_id: string; level: string; approved_on: string }[] })[];
  }
  /** Every invoice with its payment (if any), for supplier payment history and model features. */
  invoiceFacts() { return this.rows("SELECT i.invoice_no, i.supplier_id, i.po_ref, i.invoice_date, i.received_on, i.total_paise, i.status, i.resolved_on, p.paid_on FROM invoices i LEFT JOIN payments p USING (invoice_no)"); }
  approverNames() { return this.rows("SELECT id, name, role, approval_limit_inr FROM finance_staff"); }
  /** Cheap change detector: the graph is rebuilt when these counts move. */
  fingerprint() { const r = this.one("SELECT (SELECT COUNT(*) FROM invoices) a, (SELECT COUNT(*) FROM approvals) b"); return `${r?.a}/${r?.b}`; }
  listInvoiceHeaders() { return this.rows("SELECT invoice_no, supplier_id, po_ref, invoice_date, received_on, total_paise, status, source_file FROM invoices ORDER BY received_on DESC, invoice_no"); }
}

export class LogisticsConnector extends BaseConnector {
  allShipments() { return this.rows("SELECT shipment_no, po_no, dispatched_on, delivered_on, status FROM shipments"); }
  shipmentsForPo(poNo: string) { return this.rows("SELECT * FROM shipments WHERE po_no = ? ORDER BY dispatched_on", poNo); }
  gateEntriesForPo(poNo: string) { return this.rows("SELECT * FROM gate_entries WHERE po_no = ? ORDER BY entered_on", poNo); }
  weighbridgeForPo(poNo: string) { return this.rows("SELECT * FROM weighbridge_records WHERE po_no = ? ORDER BY weighed_on", poNo); }
}

export class SupplierConnector extends BaseConnector {
  supplier(code: string) { return this.one("SELECT * FROM suppliers WHERE supplier_code = ?", code); }
  addresses(code: string) { return this.rows("SELECT * FROM addresses WHERE supplier_code = ?", code); }
  contacts(code: string) { return this.rows("SELECT * FROM contacts WHERE supplier_code = ?", code); }
  bankAccounts(code: string) { return this.rows("SELECT * FROM bank_accounts WHERE supplier_code = ? ORDER BY valid_from", code); }
  /** Other suppliers that hold the same account number (shared accounts can be legitimate). */
  allSuppliers() { return this.rows("SELECT * FROM suppliers ORDER BY supplier_code"); }
  allBankAccounts() { return this.rows("SELECT * FROM bank_accounts ORDER BY supplier_code, valid_from"); }
  allAddresses() { return this.rows("SELECT * FROM addresses ORDER BY supplier_code, id"); }
  fingerprint() { const r = this.one("SELECT (SELECT COUNT(*) FROM bank_accounts) a, (SELECT COUNT(*) FROM addresses) b, (SELECT COUNT(*) FROM suppliers) c, (SELECT COALESCE(SUM(status = 'pending_verification'), 0) FROM bank_accounts) d, (SELECT COALESCE(MAX(verified_on), '') FROM bank_accounts) e"); return `${r?.a}/${r?.b}/${r?.c}/${r?.d}/${r?.e}`; }
  holdersOfAccount(accountNo: string) { return this.rows("SELECT b.supplier_code, s.legal_name, b.status, b.note FROM bank_accounts b JOIN suppliers s ON s.supplier_code = b.supplier_code WHERE b.account_no = ?", accountNo); }
}

/** The six connectors, constructed over one integration DB. */
export class Connectors {
  readonly procurement: ProcurementConnector; readonly warehouse: WarehouseConnector; readonly quality: QualityConnector;
  readonly finance: FinanceConnector; readonly logistics: LogisticsConnector; readonly supplier: SupplierConnector;
  constructor(integration: Database.Database, readonly dir = SOURCES_DIR, now: () => string = () => new Date().toISOString()) {
    this.procurement = new ProcurementConnector("procurement", integration, this.dir, now);
    this.warehouse = new WarehouseConnector("warehouse", integration, dir, now);
    this.quality = new QualityConnector("quality", integration, dir, now);
    this.finance = new FinanceConnector("finance", integration, dir, now);
    this.logistics = new LogisticsConnector("logistics", integration, dir, now);
    this.supplier = new SupplierConnector("supplier", integration, dir, now);
  }
  get(id: SourceId): SourceConnector { return this[id]; }
  close() { for (const id of SOURCE_IDS) (this[id] as unknown as { close(): void }).close(); }
  health(): SourceHealth[] { return SOURCE_IDS.map((id) => this[id].health()); }
}
