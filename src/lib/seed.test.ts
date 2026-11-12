import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_TODAY } from "./constants";
import type { Finding, Invoice, PurchaseOrder } from "./types";

const dir = path.join(process.cwd(), "data", "seed");
const read = <T,>(n: string) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), "utf8")) as T;
const invoices = read<Invoice[]>("invoices");
const findings = read<Finding[]>("findings");
const pos = read<PurchaseOrder[]>("purchaseOrders");
const r2 = (n: number) => Math.round(n * 100) / 100;

describe("seed dataset", () => {
  it("has about 40 invoices in the last 60 days with every status the charts need", () => {
    expect(invoices.length).toBeGreaterThanOrEqual(38);
    expect(invoices.length).toBeLessThanOrEqual(46);
    const age = (i: Invoice) => (Date.parse(DEMO_TODAY) - Date.parse(i.receivedOn)) / 86400000;
    for (const i of invoices) { expect(age(i)).toBeGreaterThanOrEqual(0); expect(age(i)).toBeLessThanOrEqual(60); }
    for (const st of ["approved", "paid", "pending_owner", "blocked"]) expect(invoices.some((i) => i.status === st)).toBe(true);
  });

  it("totals tie out on every invoice (lines x price + GST = total)", () => {
    for (const i of invoices) {
      const sub = r2(i.lines.reduce((s, l) => s + l.amount, 0));
      for (const l of i.lines) expect(l.amount).toBe(r2(l.qty * l.unitPrice));
      expect(i.subtotal).toBe(sub);
      expect(i.tax).toBe(r2((sub * i.lines[0].taxRatePct) / 100));
      expect(i.total).toBe(r2(i.subtotal + i.tax));
    }
  });

  it("has >= 7 'PO not updated after contract change' cases across suppliers and all four age buckets", () => {
    const stale = findings.filter((f) => f.rootCause === "PO not updated after contract change");
    expect(stale.length).toBeGreaterThanOrEqual(7);
    const inv = (f: Finding) => invoices.find((i) => i.id === f.invoiceId)!;
    expect(new Set(stale.map((f) => inv(f).vendorId)).size).toBeGreaterThanOrEqual(4);
    const age = (f: Finding) => (Date.parse(DEMO_TODAY) - Date.parse(inv(f).receivedOn)) / 86400000;
    const bucket = (a: number) => (a <= 2 ? "0-2" : a <= 7 ? "3-7" : a <= 14 ? "8-14" : "15+");
    expect(new Set(stale.map((f) => bucket(age(f)))).size).toBe(4);
  });

  it("includes paid INV-6120 for Deccan Valve & Fittings, and the golden PO", () => {
    expect(invoices.find((i) => i.id === "INV-6120")).toMatchObject({ vendorId: "V-1004", status: "paid" });
    const po = pos.find((p) => p.id === "4500001234")!;
    expect(po.lines.map((l) => [l.qty, l.unitPrice])).toEqual([[1000, 398], [5000, 86], [40, 1450]]);
  });

  it("has a clean, matched invoice above Rs 15,00,000 so the top approval band can be demonstrated", () => {
    const big = invoices.find((i) => i.id === "INV-6150")!;
    expect(big).toMatchObject({ vendorId: "V-1006", status: "pending_approval", verdict: "approve", total: 1964700 });
    expect(big.total).toBeGreaterThan(1500000);
    const po = pos.find((p) => p.id === big.poId)!;
    expect(po.lines[0]).toMatchObject({ qty: 90, unitPrice: 18500 });
    expect(findings.filter((f) => f.invoiceId === "INV-6150")).toHaveLength(0);
  });

  it("keeps every reference valid", () => {
    const ids = new Set(pos.map((p) => p.id));
    for (const g of read<{ poId: string }[]>("goodsReceipts")) expect(ids.has(g.poId)).toBe(true);
    for (const i of invoices) expect(ids.has(i.poId!)).toBe(true);
  });
});
