import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { DEMO_TODAY } from "../lib/constants";
import type { Finding } from "../lib/types";
import { loadDataset, loadInvoices, loadMatchData, openFoundationDb } from "./db";
import { buildDataset, type Dataset } from "./generate";
import { getResult, matchOne, reshape, runMatch, runMatchAll, type ThreeWayResult } from "./threeWay";
import { getInvoice, listInvoices, statusCounts } from "./service";

let ds: Dataset;
let db: Database.Database;
let results: Map<string, ThreeWayResult>;
const STATUS = { pass: "approve", review: "flag", block: "block" } as const;

beforeAll(() => {
  ds = buildDataset();
  db = openFoundationDb(":memory:");
  loadDataset(db, ds);
  results = new Map(runMatchAll(db, DEMO_TODAY).map((r) => [r.invoiceId, r]));
});

const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;

describe("schema and volumes", () => {
  it("has the required relational tables", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["vendors", "vendor_bank_accounts", "addresses", "employees", "purchase_orders", "po_line_items", "po_change_history", "goods_receipts", "gr_line_items", "invoices", "invoice_line_items", "contracts", "contract_prices", "contract_amendments", "materials", "inventory_transactions"]) expect(names).toContain(t);
  });
  it("seeds about 30 vendors, 500 POs and 600 invoices", () => {
    expect(count("vendors")).toBe(30);
    expect(count("purchase_orders")).toBeGreaterThanOrEqual(480);
    expect(count("purchase_orders")).toBeLessThanOrEqual(560);
    expect(count("invoices")).toBeGreaterThanOrEqual(580);
    expect(count("invoices")).toBeLessThanOrEqual(650);
    expect(count("po_change_history")).toBeGreaterThan(5);
    expect(count("inventory_transactions")).toBeGreaterThan(500);
  });
  it("has no foreign key violations", () => {
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("is deterministic: two builds are identical", () => {
    expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(ds));
  });
  it("keeps amounts in INR and invoice arithmetic exact", () => {
    for (const i of ds.invoices) {
      expect(i.currency).toBe("INR");
      expect(Math.round((i.subtotal + i.tax) * 100)).toBe(Math.round(i.total * 100));
    }
  });
});

describe("planted exceptions are detected", () => {
  it("matches every invoice's labelled outcome (planted cases and unplanted clean invoices)", () => {
    const planted = new Map(ds.planted.map((p) => [p.invoiceId, p]));
    const wrong: string[] = [];
    for (const inv of ds.invoices) {
      const r = results.get(inv.id)!;
      const p = planted.get(inv.id);
      const expected = p ? p.expectedStatus : "approve";
      if (STATUS[r.status] !== expected) wrong.push(`${inv.id}: expected ${expected}, got ${r.status}`);
      const failed = r.checks.filter((c) => !c.passed).map((c) => c.check);
      if (!p && failed.length) wrong.push(`${inv.id}: unplanted but failed ${failed}`);
      if (p?.expectedCheck && p.expectedStatus !== "approve" && !failed.includes(p.expectedCheck as never)) wrong.push(`${inv.id}: ${p.caseType} did not fail ${p.expectedCheck}`);
    }
    expect(wrong).toEqual([]);
  });
  it.each(["price_mismatch", "quantity_mismatch", "missing_gr", "duplicate", "unit_mismatch", "stale_po_price"])("has at least 5 planted %s cases", (t) => {
    expect(ds.planted.filter((p) => p.caseType === t).length).toBeGreaterThanOrEqual(5);
  });
  it("carries the later-stage cases (splitting, bank change, shared account, amendment)", () => {
    const types = new Set(ds.planted.map((p) => p.caseType));
    for (const t of ["threshold_split", "bank_change", "shared_bank_account", "contract_amendment"]) expect(types.has(t)).toBe(true);
    expect(ds.planted.filter((p) => p.caseType === "threshold_split")).toHaveLength(3);
  });
  it("explains a stale PO price with the newer contract, citing evidence", () => {
    const p = ds.planted.find((x) => x.caseType === "stale_po_price" && x.stage === "stage1")!;
    const d = results.get(p.invoiceId)!.discrepancies.find((x) => x.check === "price")!;
    expect(d.rootCause).toBe("PO not updated after contract change");
    expect(d.rootCauseStatus).toBe("supported_by_evidence");
    expect(d.evidence.join(" ")).toMatch(/Contract C-/);
  });
  it("passes 5 MT billed against 5000 kg after unit normalisation, and says so", () => {
    const doc = ds.demoDocs.find((d) => d.purpose.startsWith("Unit mismatch"))!;
    const inv = ds.invoices.find((i) => i.id === doc.invoiceId)!;
    expect(inv.lines[0].uom).toBe("MT");
    const r = results.get(inv.id)!;
    expect(r.status).toBe("pass");
    expect(r.checks.find((c) => c.check === "unit_of_measure")).toMatchObject({ passed: true });
    expect(r.checks.find((c) => c.check === "unit_of_measure")!.detail).toMatch(/MT/);
  });
  it("blocks a missing goods receipt and flags the quantity check", () => {
    const p = ds.planted.find((x) => x.caseType === "missing_gr")!;
    const r = results.get(p.invoiceId)!;
    expect(r.status).toBe("block");
    expect(r.checks.find((c) => c.check === "quantity")!.passed).toBe(false);
  });
  it("catches a re-keyed copy of a paid invoice, but not the original or two halves of a staged delivery", () => {
    const dup = ds.planted.find((x) => x.caseType === "duplicate" && x.note?.startsWith("Re-submission of paid"))!;
    const origId = dup.note!.replace("Re-submission of paid ", "").replace(".", "");
    expect(results.get(dup.invoiceId)!.status).toBe("block");
    expect(results.get(origId)!.status).toBe("pass");
    const halves = ds.invoices.filter((i) => i.poId && ds.invoices.filter((o) => o.poId === i.poId).length === 2 && !ds.planted.some((p) => p.invoiceId === i.id));
    expect(halves.length).toBeGreaterThan(40);
    for (const h of halves) expect(results.get(h.id)!.checks.find((c) => c.check === "duplicate")!.passed).toBe(true);
  });
});

describe("tolerances", () => {
  const clean = () => {
    const inv = loadInvoices(db).find((i) => results.get(i.id)!.status === "pass" && i.lines.length === 1 && i.lines[0].uom !== "MT" && i.lines[0].uom !== "drum" && i.status !== "received")!;
    return structuredClone(inv);
  };
  const bump = (factor: number) => {
    const inv = clean();
    const l = inv.lines[0];
    l.unitPrice = Math.round(l.unitPrice * factor * 100) / 100;
    l.amount = Math.round(l.qty * l.unitPrice * 100) / 100;
    inv.subtotal = l.amount; inv.tax = Math.round(l.amount * l.taxRatePct) / 100; inv.total = Math.round((inv.subtotal + inv.tax) * 100) / 100;
    const base = loadMatchData(db);
    return matchOne({ ...base, invoices: base.invoices.filter((o) => o.id !== inv.id) }, inv, DEMO_TODAY);
  };
  it("accepts a price 1% above the PO and flags 4% above", () => {
    expect(bump(1.01).checks.find((c) => c.check === "price")!.passed).toBe(true);
    const over = bump(1.04);
    expect(over.status).toBe("review");
    expect(over.checks.find((c) => c.check === "price")!.passed).toBe(false);
  });
});

describe("result shape and honesty about causes", () => {
  it("returns status, every check and discrepancies in a stable shape", () => {
    const r = results.get(ds.planted.find((p) => p.caseType === "price_mismatch")!.invoiceId)!;
    expect(r.checks.map((c) => c.check)).toEqual(["vendor", "purchase_order", "duplicate", "price", "quantity", "unit_of_measure", "tax", "arithmetic"]);
    expect(r.discrepancies[0]).toMatchObject({ check: "price", severity: "flag" });
    expect(r.tolerances).toEqual({ pricePct: 2, qtyPct: 5 });
  });
  it("labels a root cause with no supporting evidence as an unverified prediction", () => {
    const f: Finding = { id: "F", invoiceId: "X", kind: "price", verdict: "flag", message: "m", rootCause: "Some guess", owner: "Buyer", smallestFix: "Fix it" };
    const r = reshape(ds.invoices[0], [f], "flag", "s", DEMO_TODAY);
    expect(r.discrepancies[0].rootCauseStatus).toBe("unverified_prediction");
  });
  it("does not accuse: warnings only, no verdict wording about fraud", () => {
    const text = JSON.stringify([...results.values()]).toLowerCase();
    expect(text).not.toMatch(/fraud|fraudulent|stolen|criminal/);
  });
});

describe("demo document set", () => {
  it("has at least 15 documents with a mix of layouts and number formats", () => {
    expect(ds.demoDocs.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ds.demoDocs.map((d) => d.layout)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(ds.demoDocs.map((d) => d.amountFormat)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(ds.demoDocs.map((d) => ds.invoices.find((i) => i.id === d.invoiceId)!.vendorId)).size).toBeGreaterThanOrEqual(12);
  });
  it("covers clean passes and every exception type", () => {
    const types = new Set(ds.demoDocs.map((d) => ds.planted.find((p) => p.invoiceId === d.invoiceId)?.caseType));
    for (const t of ["clean", "price_mismatch", "quantity_mismatch", "missing_gr", "duplicate", "unit_mismatch", "stale_po_price", "threshold_split", "bank_change", "shared_bank_account", "contract_amendment"]) expect(types.has(t)).toBe(true);
  });
  it("matches its declared expected result and its file exists on disk", () => {
    const dataDir = path.join(process.cwd(), "data");
    for (const d of ds.demoDocs) {
      expect(STATUS[results.get(d.invoiceId)!.status], d.invoiceId).toBe(d.expectedStatus);
      expect(fs.existsSync(path.join(dataDir, d.file)), d.file).toBe(true);
      if (d.rendered) {
        const exp = JSON.parse(fs.readFileSync(path.join(dataDir, d.file.replace(/\.pdf$/, ".expected.json")), "utf8"));
        expect(exp.total).toBe(ds.invoices.find((i) => i.id === d.invoiceId)!.total);
      }
    }
  });
  it("models a bank-detail change and a shared account without accusing anyone", () => {
    const pending = db.prepare("SELECT * FROM vendor_bank_accounts WHERE status = 'pending_verification'").all() as { vendor_id: string; account_no: string }[];
    expect(pending).toHaveLength(1);
    const closed = db.prepare("SELECT 1 FROM vendor_bank_accounts WHERE vendor_id = ? AND status = 'closed'").get(pending[0].vendor_id);
    expect(closed).toBeTruthy();
    const shared = db.prepare("SELECT account_no, COUNT(DISTINCT vendor_id) n FROM vendor_bank_accounts GROUP BY account_no HAVING n > 1").all();
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });
});

describe("service layer used by the API and page", () => {
  it("lists with filters and counts add up", () => {
    const c = statusCounts(db);
    expect(c.pass + c.review + c.block + c.unmatched).toBe(count("invoices"));
    expect(c.unmatched).toBe(0);
    const blocked = listInvoices(db, { status: "block", limit: 1000 });
    expect(blocked.total).toBe(c.block);
    expect(blocked.rows.every((r) => r.matchStatus === "block")).toBe(true);
    expect(listInvoices(db, { demoOnly: true }).total).toBe(ds.demoDocs.length);
    expect(listInvoices(db, { q: "zzz-no-such" }).rows).toEqual([]);
  });
  it("gets one invoice, runs a match and reads the stored result", () => {
    const id = ds.demoDocs[0].invoiceId;
    expect(getInvoice(db, id)!.lines.length).toBeGreaterThan(0);
    db.prepare("DELETE FROM match_results WHERE invoice_id = ?").run(id);
    expect(getResult(db, id)).toBeUndefined();
    const r = runMatch(db, id, DEMO_TODAY)!;
    expect(getResult(db, id)).toEqual(r);
    expect(getInvoice(db, "nope")).toBeUndefined();
    expect(runMatch(db, "nope", DEMO_TODAY)).toBeUndefined();
  });
});
