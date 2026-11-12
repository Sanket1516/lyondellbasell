// Six mock source systems, one SQLite file each, each owned by a department and using its own conventions:
//   procurement: PO numbers are bare digits            warehouse: GRN-nnn, PO-nnn references
//   quality:     GRN-nnn references                    finance:   amounts in PAISE (integers)
//   logistics:   weights in TONNES                     supplier:  supplier codes SUP-nnnn (others use V-nnnn)
// The integration layer's canonical model (src/plantpay/canonical.ts) normalises all of this.
export const SOURCE_IDS = ["procurement", "warehouse", "quality", "finance", "logistics", "supplier"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_META: Record<SourceId, { label: string; owner: string; holds: string }> = {
  procurement: { label: "Procurement DB", owner: "Procurement", holds: "Purchase orders, contracts, agreed prices" },
  warehouse: { label: "Warehouse DB", owner: "Warehouse", holds: "Goods receipts, delivered quantities, stock records" },
  quality: { label: "Quality DB", owner: "Quality", holds: "Inspection reports, accepted and rejected quantities" },
  finance: { label: "Finance DB", owner: "Finance", holds: "Invoices, payment status, amounts, approvals" },
  logistics: { label: "Logistics DB", owner: "Logistics", holds: "Gate entry, shipment tracking, weighbridge records" },
  supplier: { label: "Supplier DB", owner: "Supplier master data", holds: "Supplier identity, contacts, verified bank details" },
};

export const SOURCE_DDL: Record<SourceId, string> = {
  procurement: `
CREATE TABLE suppliers_ref (supplier_id TEXT PRIMARY KEY, name TEXT NOT NULL, gstin TEXT NOT NULL, active INTEGER NOT NULL);
CREATE TABLE buyers (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE materials (code TEXT PRIMARY KEY, description TEXT NOT NULL, base_uom TEXT NOT NULL, standard_price REAL NOT NULL, hsn TEXT NOT NULL);
CREATE TABLE material_uoms (material_code TEXT NOT NULL, from_uom TEXT NOT NULL, to_uom TEXT NOT NULL, factor REAL NOT NULL, PRIMARY KEY (material_code, from_uom, to_uom));
CREATE TABLE contracts (contract_no TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL);
CREATE TABLE contract_prices (contract_no TEXT NOT NULL, material_code TEXT NOT NULL, uom TEXT NOT NULL, unit_price REAL NOT NULL, effective_from TEXT NOT NULL, PRIMARY KEY (contract_no, material_code, effective_from));
CREATE TABLE contract_amendments (id INTEGER PRIMARY KEY AUTOINCREMENT, contract_no TEXT NOT NULL, material_code TEXT NOT NULL, old_price REAL NOT NULL, new_price REAL NOT NULL, effective_from TEXT NOT NULL, signed_on TEXT NOT NULL, note TEXT);
CREATE TABLE purchase_orders (po_number TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, contract_no TEXT, buyer_id TEXT NOT NULL, issued_on TEXT NOT NULL);
CREATE TABLE po_lines (po_number TEXT NOT NULL, line_no INTEGER NOT NULL, material_code TEXT NOT NULL, description TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL, unit_price REAL NOT NULL, tax_code TEXT NOT NULL, tax_rate_pct REAL NOT NULL, PRIMARY KEY (po_number, line_no));
CREATE TABLE po_change_history (id INTEGER PRIMARY KEY AUTOINCREMENT, po_number TEXT NOT NULL, line_no INTEGER NOT NULL, field TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, changed_on TEXT NOT NULL, changed_by TEXT NOT NULL, reason TEXT NOT NULL);
CREATE TABLE contract_terms (contract_no TEXT PRIMARY KEY, early_pay_discount_pct REAL NOT NULL, early_pay_within_days INTEGER NOT NULL, late_payment_interest_pct_month REAL NOT NULL, strict_payment_date INTEGER NOT NULL);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);`,
  warehouse: `
CREATE TABLE store_staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE goods_receipts (grn_no TEXT PRIMARY KEY, po_ref TEXT NOT NULL, received_on TEXT NOT NULL, received_by TEXT NOT NULL);
CREATE TABLE grn_lines (grn_no TEXT NOT NULL, po_line_no INTEGER NOT NULL, qty_received REAL NOT NULL, uom TEXT NOT NULL, PRIMARY KEY (grn_no, po_line_no));
CREATE TABLE delivery_notes (dn_no TEXT PRIMARY KEY, po_ref TEXT NOT NULL, delivered_on TEXT NOT NULL);
CREATE TABLE delivery_note_lines (dn_no TEXT NOT NULL, material_code TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL);
CREATE TABLE stock_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, material_code TEXT NOT NULL, txn_type TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL, txn_date TEXT NOT NULL, ref_type TEXT, ref_id TEXT);
CREATE INDEX idx_grn_po ON goods_receipts(po_ref);`,
  quality: `
CREATE TABLE inspections (inspection_no TEXT PRIMARY KEY, grn_ref TEXT NOT NULL, po_ref TEXT NOT NULL, inspected_on TEXT NOT NULL, inspector TEXT NOT NULL);
CREATE TABLE inspection_lines (inspection_no TEXT NOT NULL, po_line_no INTEGER NOT NULL, qty_inspected REAL NOT NULL, qty_accepted REAL NOT NULL, qty_rejected REAL NOT NULL, uom TEXT NOT NULL, reject_reason TEXT, PRIMARY KEY (inspection_no, po_line_no));
CREATE INDEX idx_insp_po ON inspections(po_ref);`,
  finance: `
CREATE TABLE finance_staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, role TEXT NOT NULL, approval_limit_inr INTEGER NOT NULL);
CREATE TABLE invoices (invoice_no TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, po_ref TEXT, invoice_date TEXT NOT NULL, received_on TEXT NOT NULL, currency TEXT NOT NULL, subtotal_paise INTEGER NOT NULL, tax_paise INTEGER NOT NULL, total_paise INTEGER NOT NULL, status TEXT NOT NULL, source_file TEXT, remit_account_no TEXT, remit_ifsc TEXT, resolved_on TEXT, gstin_on_invoice TEXT);
CREATE TABLE invoice_lines (invoice_no TEXT NOT NULL, line_no INTEGER NOT NULL, material_code TEXT, description TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL, unit_price_paise INTEGER NOT NULL, tax_rate_pct REAL NOT NULL, amount_paise INTEGER NOT NULL, PRIMARY KEY (invoice_no, line_no));
CREATE TABLE approvals (invoice_no TEXT NOT NULL, approver_id TEXT NOT NULL, level TEXT NOT NULL, approved_on TEXT NOT NULL);
CREATE TABLE payments (invoice_no TEXT PRIMARY KEY, paid_on TEXT NOT NULL, amount_paise INTEGER NOT NULL, utr TEXT NOT NULL);
CREATE INDEX idx_inv_supplier ON invoices(supplier_id);
CREATE INDEX idx_inv_po ON invoices(po_ref);`,
  logistics: `
CREATE TABLE shipments (shipment_no TEXT PRIMARY KEY, po_no TEXT NOT NULL, dispatched_on TEXT NOT NULL, delivered_on TEXT, status TEXT NOT NULL);
CREATE TABLE gate_entries (entry_no TEXT PRIMARY KEY, po_no TEXT NOT NULL, grn_ref TEXT, vehicle_no TEXT NOT NULL, entered_on TEXT NOT NULL);
CREATE TABLE weighbridge_records (record_no TEXT PRIMARY KEY, entry_no TEXT NOT NULL, po_no TEXT NOT NULL, weighed_on TEXT NOT NULL, gross_t REAL NOT NULL, tare_t REAL NOT NULL, net_t REAL NOT NULL);
CREATE INDEX idx_gate_po ON gate_entries(po_no);
CREATE INDEX idx_wb_po ON weighbridge_records(po_no);`,
  supplier: `
CREATE TABLE suppliers (supplier_code TEXT PRIMARY KEY, legal_name TEXT NOT NULL, gstin TEXT NOT NULL, state_code TEXT NOT NULL, active INTEGER NOT NULL, payment_terms_days INTEGER NOT NULL, onboarded_on TEXT NOT NULL);
CREATE TABLE addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_code TEXT NOT NULL, kind TEXT NOT NULL, line TEXT NOT NULL, city TEXT NOT NULL, pincode TEXT NOT NULL, valid_from TEXT, valid_to TEXT);
CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_code TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, supplier_code TEXT NOT NULL, bank_name TEXT NOT NULL, account_no TEXT NOT NULL, ifsc TEXT NOT NULL, status TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, verified_on TEXT, verified_by TEXT, note TEXT);
CREATE INDEX idx_bank_acct ON bank_accounts(account_no);`,
};
