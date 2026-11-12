// Foundation database: open, load a Dataset into the relational tables, read rows back as the engine's domain types.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Contract, DeliveryNote, GoodsReceipt, Invoice, PurchaseOrder, UomRule, Vendor } from "../lib/types";
import type { MatchData } from "../engine/match";
import type { Dataset } from "./generate";
import { FOUNDATION_SCHEMA_VERSION, SCHEMA_SQL } from "./schema";

export const FOUNDATION_DB_FILE = process.env.FOUNDATION_DB_FILE ?? path.join(process.cwd(), "data", "foundation.db");

export function openFoundationDb(file = FOUNDATION_DB_FILE): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Stage 4 widened the stock-ledger transaction types (RETURN, REVERSAL). CREATE IF NOT EXISTS keeps an older table, so rebuild it
  // (nothing references it and the data set is reloaded from the generator).
  const ledger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_transactions'").get() as { sql: string } | undefined;
  if (ledger && !ledger.sql.includes("'RETURN'")) db.exec("DROP TABLE inventory_transactions");
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(FOUNDATION_SCHEMA_VERSION));
  return db;
}

const TABLES = [
  "match_results", "demo_documents", "planted_cases", "invoice_line_items", "invoices", "inventory_transactions", "delivery_note_lines", "delivery_notes",
  "gr_line_items", "goods_receipts", "po_change_history", "po_line_items", "purchase_orders", "contract_amendments", "contract_prices", "contracts",
  "material_uoms", "materials", "employees", "vendor_bank_accounts", "addresses", "vendors",
];

/** Replace everything with `ds` in one transaction. Re-running with the same dataset gives the same database. */
export function loadDataset(db: Database.Database, ds: Dataset): void {
  db.transaction(() => {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence");
    const run = (sql: string, rows: unknown[][]) => { const st = db.prepare(sql); for (const r of rows) st.run(...r); };

    run("INSERT INTO vendors VALUES (?,?,?,?,?,?,?)", ds.vendors.map((v) => [v.id, v.name, v.gstin, v.stateCode, v.active ? 1 : 0, v.paymentTermsDays, v.onboardedOn]));
    run("INSERT INTO addresses (vendor_id,kind,line,city,pincode) VALUES (?,?,?,?,?)", ds.addresses.map((a) => [a.vendorId, a.kind, a.line, a.city, a.pincode]));
    run("INSERT INTO vendor_bank_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)", ds.banks.map((b) => [b.id, b.vendorId, b.bankName, b.accountNo, b.ifsc, b.status, b.validFrom, b.validTo ?? null, b.verifiedOn ?? null, b.verifiedBy ?? null, b.note ?? null]));
    run("INSERT INTO employees VALUES (?,?,?,?,?)", ds.employees.map((e) => [e.id, e.name, e.title, e.role, e.limit]));
    run("INSERT INTO materials VALUES (?,?,?,?,?)", ds.materials.map((m) => [m.code, m.description, m.baseUom, m.standardPrice, m.hsn]));
    run("INSERT INTO material_uoms VALUES (?,?,?,?)", ds.materialUoms.map((u) => [u.itemCode, u.fromUom, u.toUom, u.factor]));
    run("INSERT INTO contracts VALUES (?,?,?,?)", ds.contracts.map((c) => [c.id, c.vendorId, c.validFrom, c.validTo]));
    run("INSERT INTO contract_prices VALUES (?,?,?,?,?)", ds.contractPrices.map((p) => [p.contractId, p.materialCode, p.uom, p.unitPrice, p.effectiveFrom]));
    run("INSERT INTO contract_amendments (contract_id,material_code,old_price,new_price,effective_from,signed_on,note) VALUES (?,?,?,?,?,?,?)", ds.amendments.map((a) => [a.contractId, a.materialCode, a.oldPrice, a.newPrice, a.effectiveFrom, a.signedOn, a.note]));

    const eid = (name: string) => ds.employees.find((e) => e.name === name.replace(/ \(Stores\)$/, ""))!.id;
    run("INSERT INTO purchase_orders VALUES (?,?,?,?,?)", ds.purchaseOrders.map((p) => [p.id, p.vendorId, p.contractId || null, eid(p.buyer), p.issuedOn]));
    run("INSERT INTO po_line_items VALUES (?,?,?,?,?,?,?,?,?)", ds.purchaseOrders.flatMap((p) => p.lines.map((l) => [p.id, l.lineNo, l.itemCode, l.description, l.qty, l.uom, l.unitPrice, l.taxCode, l.taxRatePct])));
    run("INSERT INTO po_change_history (po_id,line_no,field,old_value,new_value,changed_on,changed_by,reason) VALUES (?,?,?,?,?,?,?,?)", ds.poHistory.map((h) => [h.poId, h.lineNo, h.field, h.oldValue, h.newValue, h.changedOn, h.changedBy, h.reason]));
    run("INSERT INTO goods_receipts VALUES (?,?,?,?)", ds.goodsReceipts.map((g) => [g.id, g.poId, g.receivedOn, eid(g.receivedBy)]));
    run("INSERT INTO gr_line_items VALUES (?,?,?,?)", ds.goodsReceipts.flatMap((g) => g.lines.map((l) => [g.id, l.lineNo, l.qtyReceived, l.uom])));
    run("INSERT INTO delivery_notes VALUES (?,?,?)", ds.deliveryNotes.map((d) => [d.id, d.poId, d.deliveredOn]));
    run("INSERT INTO delivery_note_lines VALUES (?,?,?,?)", ds.deliveryNotes.flatMap((d) => d.lines.map((l) => [d.id, l.itemCode, l.qty, l.uom])));
    run("INSERT INTO inventory_transactions (material_code,txn_type,qty,uom,txn_date,ref_type,ref_id) VALUES (?,?,?,?,?,?,?)", ds.inventory.map((t) => [t.materialCode, t.type, t.qty, t.uom, t.date, t.refType, t.refId]));

    run("INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ds.invoices.map((i) => [i.id, i.vendorId, i.poId ?? null, i.invoiceDate, i.receivedOn, i.currency, i.subtotal, i.tax, i.total, i.status, i.sourceFile ?? null, ds.remit[i.id]?.accountNo ?? null, ds.remit[i.id]?.ifsc ?? null, i.resolvedOn ?? null]));
    run("INSERT INTO invoice_line_items VALUES (?,?,?,?,?,?,?,?,?)", ds.invoices.flatMap((i) => i.lines.map((l) => [i.id, l.lineNo, l.itemCode ?? null, l.description, l.qty, l.uom, l.unitPrice, l.taxRatePct, l.amount])));
    run("INSERT INTO planted_cases VALUES (?,?,?,?,?,?,?)", ds.planted.map((p) => [p.invoiceId, p.caseType, p.expectedStatus, p.expectedCheck ?? null, p.stage, p.note ?? null, p.plantpayStatus ?? null]));
    run("INSERT INTO demo_documents VALUES (?,?,?,?,?,?,?)", ds.demoDocs.map((d) => [d.file, d.invoiceId, d.layout, d.amountFormat, d.purpose, d.expectedStatus, d.plantpayStatus ?? null]));
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_for', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(ds.today);
  })();
}

// ---------------------------------------------------------------- read back as engine types
interface Row { [k: string]: unknown }
const all = (db: Database.Database, sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Row[];

export function loadInvoices(db: Database.Database): Invoice[] {
  const lines = new Map<string, Row[]>();
  for (const l of all(db, "SELECT * FROM invoice_line_items ORDER BY invoice_id, line_no")) {
    const k = l.invoice_id as string;
    (lines.get(k) ?? lines.set(k, []).get(k)!).push(l);
  }
  return all(db, "SELECT * FROM invoices ORDER BY received_on, id").map((r) => ({
    id: r.id as string, vendorId: r.vendor_id as string, poId: (r.po_id as string | null) ?? undefined, invoiceDate: r.invoice_date as string,
    receivedOn: r.received_on as string, currency: "INR" as const, subtotal: r.subtotal as number, tax: r.tax as number, total: r.total as number,
    status: r.status as Invoice["status"], sourceFile: (r.source_file as string | null) ?? undefined, resolvedOn: (r.resolved_on as string | null) ?? undefined,
    lines: (lines.get(r.id as string) ?? []).map((l) => ({
      lineNo: l.line_no as number, itemCode: (l.material_code as string | null) ?? undefined, description: l.description as string, qty: l.qty as number,
      uom: l.uom as string, unitPrice: l.unit_price as number, taxRatePct: l.tax_rate_pct as number, amount: l.amount as number,
    })),
  }));
}

/** Everything the matching engine reads, rebuilt from the relational tables. */
export function loadMatchData(db: Database.Database, invoices = loadInvoices(db)): MatchData {
  const vendors: Vendor[] = all(db, "SELECT * FROM vendors ORDER BY id").map((v) => ({ id: v.id as string, name: v.name as string, gstin: v.gstin as string, active: !!v.active, paymentTermsDays: v.payment_terms_days as number }));
  const lines = new Map<string, PurchaseOrder["lines"]>();
  for (const l of all(db, "SELECT * FROM po_line_items ORDER BY po_id, line_no")) {
    const k = l.po_id as string;
    (lines.get(k) ?? lines.set(k, []).get(k)!).push({ lineNo: l.line_no as number, itemCode: l.material_code as string, description: l.description as string, qty: l.qty as number, uom: l.uom as string, unitPrice: l.unit_price as number, taxCode: l.tax_code as string, taxRatePct: l.tax_rate_pct as number });
  }
  const purchaseOrders: PurchaseOrder[] = all(db, "SELECT p.*, e.name AS buyer FROM purchase_orders p JOIN employees e ON e.id = p.buyer_id ORDER BY p.id").map((p) => ({
    id: p.id as string, vendorId: p.vendor_id as string, buyer: p.buyer as string, issuedOn: p.issued_on as string, contractId: (p.contract_id as string | null) ?? undefined, lines: lines.get(p.id as string) ?? [],
  }));
  const grl = new Map<string, GoodsReceipt["lines"]>();
  for (const l of all(db, "SELECT * FROM gr_line_items ORDER BY gr_id, po_line_no")) {
    const k = l.gr_id as string;
    (grl.get(k) ?? grl.set(k, []).get(k)!).push({ lineNo: l.po_line_no as number, qtyReceived: l.qty_received as number, uom: l.uom as string });
  }
  const goodsReceipts: GoodsReceipt[] = all(db, "SELECT g.*, e.name AS who FROM goods_receipts g JOIN employees e ON e.id = g.received_by ORDER BY g.id").map((g) => ({
    id: g.id as string, poId: g.po_id as string, receivedOn: g.received_on as string, receivedBy: g.who as string, lines: grl.get(g.id as string) ?? [],
  }));
  const dnl = new Map<string, DeliveryNote["lines"]>();
  for (const l of all(db, "SELECT * FROM delivery_note_lines")) {
    const k = l.dn_id as string;
    (dnl.get(k) ?? dnl.set(k, []).get(k)!).push({ itemCode: l.material_code as string, qty: l.qty as number, uom: l.uom as string });
  }
  const vendorOfPo = new Map(purchaseOrders.map((p) => [p.id, p.vendorId]));
  const deliveryNotes: DeliveryNote[] = all(db, "SELECT * FROM delivery_notes ORDER BY id").map((d) => ({ id: d.id as string, poId: d.po_id as string, vendorId: vendorOfPo.get(d.po_id as string) ?? "", deliveredOn: d.delivered_on as string, lines: dnl.get(d.id as string) ?? [] }));
  const uomRules: UomRule[] = all(db, "SELECT * FROM material_uoms").map((u) => ({ itemCode: u.material_code as string, fromUom: u.from_uom as string, toUom: u.to_uom as string, factor: u.factor as number }));

  // Contracts: each material's newest price is "current"; older prices become history (the amendment trail).
  const contracts: Contract[] = all(db, "SELECT * FROM contracts ORDER BY id").map((c) => {
    const rows = all(db, "SELECT * FROM contract_prices WHERE contract_id = ? ORDER BY material_code, effective_from DESC", c.id);
    const seen = new Set<string>();
    const prices: Contract["prices"] = [];
    const history: NonNullable<Contract["history"]> = [];
    let newest = c.valid_from as string;
    for (const r of rows) {
      const code = r.material_code as string;
      if (!seen.has(code)) { seen.add(code); prices.push({ itemCode: code, unitPrice: r.unit_price as number, uom: r.uom as string }); if ((r.effective_from as string) > newest) newest = r.effective_from as string; }
      else history.push({ itemCode: code, unitPrice: r.unit_price as number, uom: r.uom as string, effectiveFrom: r.effective_from as string });
    }
    return { id: c.id as string, vendorId: c.vendor_id as string, effectiveFrom: newest, prices, history };
  });
  return { vendors, purchaseOrders, goodsReceipts, contracts, deliveryNotes, uomRules, invoices };
}
