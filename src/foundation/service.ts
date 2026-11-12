// Read-side service for the foundation API and page. One shared connection; seeds itself on first use if the file is empty,
// so a fresh checkout shows data instead of an empty screen.
import type Database from "better-sqlite3";
import { DEMO_TODAY } from "../lib/constants";
import { loadDataset, openFoundationDb } from "./db";
import { buildDataset } from "./generate";
import { getResult, runMatch, runMatchAll, type ThreeWayResult } from "./threeWay";

const g = globalThis as unknown as { __foundationDb?: Database.Database };

export function foundationDb(): Database.Database {
  if (!g.__foundationDb) {
    const db = openFoundationDb();
    const n = (db.prepare("SELECT COUNT(*) n FROM vendors").get() as { n: number }).n;
    if (n === 0) { loadDataset(db, buildDataset()); runMatchAll(db, DEMO_TODAY); }
    g.__foundationDb = db;
  }
  return g.__foundationDb;
}

export interface InvoiceRow {
  id: string; vendorId: string; vendorName: string; poId: string | null; invoiceDate: string; receivedOn: string; total: number; currency: string;
  invoiceStatus: string; matchStatus: "pass" | "review" | "block" | null; summary: string | null; demoFile: string | null;
}

export function listInvoices(db: Database.Database, f: { status?: string; vendor?: string; q?: string; demoOnly?: boolean; limit?: number; offset?: number }): { total: number; rows: InvoiceRow[] } {
  const where: string[] = []; const args: unknown[] = [];
  if (f.status) { where.push("m.status = ?"); args.push(f.status); }
  if (f.vendor) { where.push("i.vendor_id = ?"); args.push(f.vendor); }
  if (f.q) { where.push("(i.id LIKE ? OR v.name LIKE ? OR i.po_id LIKE ?)"); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.demoOnly) where.push("d.file IS NOT NULL");
  const from = "FROM invoices i JOIN vendors v ON v.id = i.vendor_id LEFT JOIN match_results m ON m.invoice_id = i.id LEFT JOIN demo_documents d ON d.invoice_id = i.id" + (where.length ? ` WHERE ${where.join(" AND ")}` : "");
  const total = (db.prepare(`SELECT COUNT(*) n ${from}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`SELECT i.id, i.vendor_id, v.name AS vendor_name, i.po_id, i.invoice_date, i.received_on, i.total, i.currency, i.status, m.status AS match_status, m.summary, d.file AS demo_file ${from} ORDER BY i.received_on DESC, i.id LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Math.max(f.limit ?? 100, 1), 1000), Math.max(f.offset ?? 0, 0)) as Record<string, unknown>[];
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id as string, vendorId: r.vendor_id as string, vendorName: r.vendor_name as string, poId: (r.po_id as string | null) ?? null, invoiceDate: r.invoice_date as string,
      receivedOn: r.received_on as string, total: r.total as number, currency: r.currency as string, invoiceStatus: r.status as string,
      matchStatus: (r.match_status as InvoiceRow["matchStatus"]) ?? null, summary: (r.summary as string | null) ?? null, demoFile: (r.demo_file as string | null) ?? null,
    })),
  };
}

export function statusCounts(db: Database.Database): { pass: number; review: number; block: number; unmatched: number } {
  const rows = db.prepare("SELECT m.status s, COUNT(*) n FROM invoices i LEFT JOIN match_results m ON m.invoice_id = i.id GROUP BY m.status").all() as { s: string | null; n: number }[];
  const o = { pass: 0, review: 0, block: 0, unmatched: 0 };
  for (const r of rows) if (r.s === "pass" || r.s === "review" || r.s === "block") o[r.s] = r.n; else o.unmatched += r.n;
  return o;
}

export function getInvoice(db: Database.Database, id: string) {
  const inv = db.prepare("SELECT i.*, v.name AS vendor_name, v.gstin FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = ?").get(id) as Record<string, unknown> | undefined;
  if (!inv) return undefined;
  const lines = db.prepare("SELECT line_no, material_code, description, qty, uom, unit_price, tax_rate_pct, amount FROM invoice_line_items WHERE invoice_id = ? ORDER BY line_no").all(id);
  const demo = db.prepare("SELECT file, purpose, layout, amount_format FROM demo_documents WHERE invoice_id = ?").get(id);
  return { invoice: inv, lines, demoDocument: demo ?? null, result: getResult(db, id) ?? null };
}

export { getResult, runMatch };
export type { ThreeWayResult };
