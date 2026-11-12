// Stage 1 foundation schema: a normalised relational model of the procure-to-pay data.
// Separate database file from the app's document store (data/plantx.db); see NOTES.md.
// Money is whole/decimal rupees (INR). Dates are ISO yyyy-mm-dd text.
export const FOUNDATION_SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, gstin TEXT NOT NULL, state_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, payment_terms_days INTEGER NOT NULL DEFAULT 45, onboarded_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id TEXT NOT NULL REFERENCES vendors(id),
  kind TEXT NOT NULL CHECK (kind IN ('registered','dispatch')), line TEXT NOT NULL, city TEXT NOT NULL, pincode TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
  id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id), bank_name TEXT NOT NULL,
  account_no TEXT NOT NULL, ifsc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified','pending_verification','closed')),
  valid_from TEXT NOT NULL, valid_to TEXT, verified_on TEXT, verified_by TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer','stores','ap_clerk','approver_l1','approver_l2')),
  approval_limit_inr INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS materials (
  code TEXT PRIMARY KEY, description TEXT NOT NULL, base_uom TEXT NOT NULL, standard_price REAL NOT NULL, hsn TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS material_uoms (
  material_code TEXT NOT NULL REFERENCES materials(code), from_uom TEXT NOT NULL, to_uom TEXT NOT NULL, factor REAL NOT NULL,
  PRIMARY KEY (material_code, from_uom, to_uom)
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id), valid_from TEXT NOT NULL, valid_to TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contract_prices (
  contract_id TEXT NOT NULL REFERENCES contracts(id), material_code TEXT NOT NULL REFERENCES materials(code),
  uom TEXT NOT NULL, unit_price REAL NOT NULL, effective_from TEXT NOT NULL,
  PRIMARY KEY (contract_id, material_code, effective_from)
);
CREATE TABLE IF NOT EXISTS contract_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id TEXT NOT NULL REFERENCES contracts(id),
  material_code TEXT NOT NULL REFERENCES materials(code), old_price REAL NOT NULL, new_price REAL NOT NULL,
  effective_from TEXT NOT NULL, signed_on TEXT NOT NULL, note TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id), contract_id TEXT REFERENCES contracts(id),
  buyer_id TEXT NOT NULL REFERENCES employees(id), issued_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS po_line_items (
  po_id TEXT NOT NULL REFERENCES purchase_orders(id), line_no INTEGER NOT NULL, material_code TEXT NOT NULL REFERENCES materials(code),
  description TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL, unit_price REAL NOT NULL, tax_code TEXT NOT NULL, tax_rate_pct REAL NOT NULL,
  PRIMARY KEY (po_id, line_no)
);
CREATE TABLE IF NOT EXISTS po_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, po_id TEXT NOT NULL REFERENCES purchase_orders(id), line_no INTEGER NOT NULL,
  field TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, changed_on TEXT NOT NULL, changed_by TEXT NOT NULL REFERENCES employees(id), reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id), received_on TEXT NOT NULL, received_by TEXT NOT NULL REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS gr_line_items (
  gr_id TEXT NOT NULL REFERENCES goods_receipts(id), po_line_no INTEGER NOT NULL, qty_received REAL NOT NULL, uom TEXT NOT NULL,
  PRIMARY KEY (gr_id, po_line_no)
);
CREATE TABLE IF NOT EXISTS delivery_notes (
  id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id), delivered_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_note_lines (
  dn_id TEXT NOT NULL REFERENCES delivery_notes(id), material_code TEXT NOT NULL, qty REAL NOT NULL, uom TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, material_code TEXT NOT NULL REFERENCES materials(code),
  txn_type TEXT NOT NULL CHECK (txn_type IN ('GR','ISSUE','ADJUST','RETURN','REVERSAL')), qty REAL NOT NULL, uom TEXT NOT NULL, txn_date TEXT NOT NULL,
  ref_type TEXT, ref_id TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id), po_id TEXT,
  invoice_date TEXT NOT NULL, received_on TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
  subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, status TEXT NOT NULL,
  source_file TEXT, remit_account_no TEXT, remit_ifsc TEXT, resolved_on TEXT
);
CREATE TABLE IF NOT EXISTS invoice_line_items (
  invoice_id TEXT NOT NULL REFERENCES invoices(id), line_no INTEGER NOT NULL, material_code TEXT, description TEXT NOT NULL,
  qty REAL NOT NULL, uom TEXT NOT NULL, unit_price REAL NOT NULL, tax_rate_pct REAL NOT NULL, amount REAL NOT NULL,
  PRIMARY KEY (invoice_id, line_no)
);

/** Ground truth for the deliberately planted exceptions; tests compare the matcher against it. */
CREATE TABLE IF NOT EXISTS planted_cases (
  invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), case_type TEXT NOT NULL, expected_status TEXT NOT NULL,
  expected_check TEXT, stage TEXT NOT NULL DEFAULT 'stage1', note TEXT, plantpay_status TEXT
);
CREATE TABLE IF NOT EXISTS demo_documents (
  file TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), layout TEXT NOT NULL, amount_format TEXT NOT NULL,
  purpose TEXT NOT NULL, expected_status TEXT NOT NULL, plantpay_status TEXT
);
CREATE TABLE IF NOT EXISTS match_results (
  invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), matched_at TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_gr_po ON goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_inv_vendor ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_inv_po ON invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_bank_acct ON vendor_bank_accounts(account_no);
CREATE INDEX IF NOT EXISTS idx_invtx_material ON inventory_transactions(material_code);
`;
