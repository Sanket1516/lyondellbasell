import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_TODAY } from "../lib/constants";
import type { Invoice, InvoiceLine } from "../lib/types";
import { ENGINE_CONFIG } from "./config";
import { matchInvoice, normaliseInvoiceNo, type MatchData } from "./match";

const root = process.cwd();
const seed = <T,>(n: string) => JSON.parse(fs.readFileSync(path.join(root, "data", "seed", `${n}.json`), "utf8")) as T;

function loadData(): MatchData {
  return {
    vendors: seed("vendors"), purchaseOrders: seed("purchaseOrders"), goodsReceipts: seed("goodsReceipts"), contracts: seed("contracts"),
    deliveryNotes: seed("deliveryNotes"), uomRules: seed("uomRules"), invoices: seed("invoices"),
  };
}
const data = loadData();

/** The invoice as the supplier would submit it from a demo document. */
function demoInvoice(file: string, d: MatchData = data): Invoice {
  const e = JSON.parse(fs.readFileSync(path.join(root, "data", "demo-docs", `${file}.expected.json`), "utf8"));
  const vendor = d.vendors.find((v) => v.gstin === e.vendorGstin);
  const lines: InvoiceLine[] = e.lines.map((l: { itemCode: string; description: string; qty: number; unit: string; unitPrice: number; amount: number }, i: number) => ({
    lineNo: i + 1, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.unit, unitPrice: l.unitPrice, taxRatePct: e.taxRatePct, amount: l.amount,
  }));
  return {
    id: e.invoiceNumber, vendorId: vendor?.id ?? "UNKNOWN", poId: e.poNumber, invoiceDate: e.invoiceDate, receivedOn: DEMO_TODAY, currency: "INR",
    lines, subtotal: e.subtotal, tax: e.taxAmount, total: e.total, status: "received",
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Change one line's price or quantity and keep the invoice arithmetic consistent. */
function edit(inv: Invoice, lineIdx: number, over: Partial<Pick<InvoiceLine, "qty" | "unitPrice" | "uom">>): Invoice {
  const lines = inv.lines.map((l, i) => (i === lineIdx ? { ...l, ...over, amount: r2((over.qty ?? l.qty) * (over.unitPrice ?? l.unitPrice)) } : l));
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const tax = r2(lines.reduce((a, l) => a + (l.amount * l.taxRatePct) / 100, 0));
  return { ...inv, lines, subtotal, tax, total: r2(subtotal + tax) };
}
const run = (inv: Invoice, d = data, cfg = ENGINE_CONFIG, today = DEMO_TODAY) => matchInvoice(inv, d, today, cfg);
const kinds = (r: ReturnType<typeof run>) => r.findings.map((f) => `${f.lineNo ?? "-"}:${f.kind}:${f.verdict}`);

describe("golden invoice INV-7781", () => {
  const r = run(demoInvoice("INV-7781"));

  it("gives exactly the three planned findings and a Flag verdict", () => {
    expect(r.verdict).toBe("flag");
    expect(kinds(r)).toEqual(["1:price:flag", "2:uom:approve", "3:quantity:flag"]);
    expect(r.lineVerdicts).toEqual([{ lineNo: 1, verdict: "flag" }, { lineNo: 2, verdict: "approve" }, { lineNo: 3, verdict: "flag" }]);
  });

  it("line 1: PO not updated after contract change, owner Buyer, fix names the contract price", () => {
    const f = r.findings[0];
    expect(f.rootCause).toBe("PO not updated after contract change");
    expect(f.owner).toBe("Buyer");
    expect(f.message).toBe("Price ₹412.00 is 3.5% above PO ₹398.00. Contract C-22 (01-Oct-2026) sets ₹412.00, so the PO looks outdated.");
    expect(f.smallestFix).toBe("Passes if the PO price is amended to ₹412.00 per C-22.");
    expect(f.deltaPct).toBeCloseTo(3.52, 2);
    expect(f.evidence?.map((e) => e.kind)).toEqual(["po", "contract", "contract"]) // PO row, current contract price, and the earlier price the PO was raised on;
  });

  it("line 2: unit of measure only (5 MT = 5,000 kg), cleared automatically", () => {
    const f = r.findings[1];
    expect(f.rootCause).toBe("Unit of measure only");
    expect(f.verdict).toBe("approve");
    expect(f.evidence?.some((e) => e.kind === "uom_rule")).toBe(true);
  });

  it("line 3: goods receipt under-posted, owner Warehouse, cumulative receipts and delivery note as evidence", () => {
    const f = r.findings[2];
    expect(f.rootCause).toBe("Goods receipt under-posted");
    expect(f.owner).toBe("Warehouse");
    expect(f.expected).toBe("32 nos received");
    expect(f.message).toContain("DN-5521");
    expect(f.smallestFix).toContain("missing 8 nos");
    expect(f.evidence?.map((e) => e.kind)).toEqual(["po", "goods_receipt", "delivery_note"]);
  });

  it("uses cumulative receipts: line 1 arrives as 600 + 400 and passes the quantity check", () => {
    expect(r.findings.some((f) => f.lineNo === 1 && f.kind === "quantity")).toBe(false);
  });
});

describe("the six demo documents", () => {
  const expectations: [string, string, string[]][] = [
    ["INV-7781", "flag", ["1:price:flag", "2:uom:approve", "3:quantity:flag"]],
    ["INV-7782", "approve", []],
    ["INV-6120R", "block", ["-:duplicate:block"]],
    ["INV-7784", "block", ["1:missing_receipt:block", "2:missing_receipt:block"]],
    ["INV-7785", "flag", ["-:tax:flag"]],
    ["INV-7786", "flag", ["1:price:flag"]],
  ];
  for (const [file, verdict, found] of expectations) {
    it(`${file} is ${verdict}`, () => {
      const r = run(demoInvoice(file));
      expect(r.verdict).toBe(verdict);
      expect(kinds(r)).toEqual(found);
    });
  }

  it("INV-6120R names the paid original and the fields that matched", () => {
    const f = run(demoInvoice("INV-6120R")).findings[0];
    expect(f.matchedInvoiceId).toBe("INV-6120");
    expect(f.message).toContain("Possible duplicate of INV-6120 (paid 29-Oct-2026)");
    expect(f.message).toContain("same PO 4500001240");
    expect(f.owner).toBe("AP Clerk");
  });

  it("INV-7784 is a missing receipt owned by Warehouse (no delivery note, delivery overdue)", () => {
    const f = run(demoInvoice("INV-7784")).findings[0];
    expect(f).toMatchObject({ rootCause: "Goods receipt not posted", owner: "Warehouse" });
  });

  it("INV-7786 is billed off-contract and the supplier owns the fix", () => {
    const f = run(demoInvoice("INV-7786")).findings[0];
    expect(f).toMatchObject({ rootCause: "Price differs from both PO and contract", owner: "Supplier" });
    expect(f.smallestFix).toContain("₹18,200.00");
  });

  it("INV-7785 reports the 12% vs 18% tax mismatch once, for the invoice", () => {
    const f = run(demoInvoice("INV-7785")).findings[0];
    expect(f.message).toContain("Tax rate differs from PO (12% on the invoice, 18% on the PO, GST18) on lines 1, 2");
    expect(f.owner).toBe("Supplier");
  });
});

describe("verdict summary", () => {
  it("reads as one plain sentence per root cause, keeping acronyms intact", () => {
    expect(run(demoInvoice("INV-7781")).summary).toBe(
      "Flag: 2 issues. PO not updated after contract change (line 1); Goods receipt under-posted (line 3). Owners: Buyer, Warehouse.",
    );
    expect(run(demoInvoice("INV-7784")).summary).toBe("Block: 2 issues. Goods receipt not posted (lines 1, 2). Owner: Warehouse.");
    expect(run(demoInvoice("INV-7782")).summary).toMatch(/^Approve: /);
  });
});

describe("tolerance boundaries", () => {
  const base = demoInvoice("INV-7782"); // CTN-5P: PO 62, 500 received
  it("price: exactly +2% and -2% pass, just beyond flags", () => {
    expect(run(edit(base, 0, { unitPrice: 63.24 })).verdict).toBe("approve");
    expect(run(edit(base, 0, { unitPrice: 60.76 })).verdict).toBe("approve");
    const up = run(edit(base, 0, { unitPrice: 63.25 }));
    expect(up.verdict).toBe("flag");
    expect(up.findings[0].message).toMatch(/2\.0\d%/); // never reads as "2.0%" while outside a 2% tolerance
    expect(run(edit(base, 0, { unitPrice: 60.75 })).verdict).toBe("flag");
  });
  it("quantity: exactly +5% of receipts passes, one more unit flags", () => {
    expect(run(edit(base, 0, { qty: 525 })).verdict).toBe("approve");
    const over = run(edit(base, 0, { qty: 526 }));
    expect(over.verdict).toBe("flag");
    expect(over.findings[0]).toMatchObject({ kind: "quantity", rootCause: "Billed for undelivered quantity", owner: "Supplier" });
  });
  it("changing a tolerance in the config changes the result", () => {
    const inv = demoInvoice("INV-7781");
    expect(run(inv).findings.some((f) => f.kind === "price")).toBe(true);
    const loose = run(inv, data, { ...ENGINE_CONFIG, pricePct: 5 });
    expect(loose.findings.some((f) => f.kind === "price")).toBe(false);
    const tightQty = run(edit(base, 0, { qty: 510 }), data, { ...ENGINE_CONFIG, qtyPct: 1 });
    expect(tightQty.verdict).toBe("flag");
    expect(run(edit(base, 0, { qty: 510 })).verdict).toBe("approve");
  });
});

describe("rules", () => {
  it("unknown vendor blocks", () => {
    const r = run({ ...demoInvoice("INV-7782"), vendorId: "UNKNOWN", printedVendor: { name: "Nowhere Traders", gstin: "27ZZZZZ9999Z1Z9" } });
    expect(r.verdict).toBe("block");
    expect(r.findings[0]).toMatchObject({ kind: "unknown_vendor", rootCause: "Supplier not in vendor master" });
    expect(r.findings[0].message).toContain("Nowhere Traders");
  });
  it("a PO that does not exist blocks", () => {
    const r = run({ ...demoInvoice("INV-7782"), poId: "4599999999" });
    expect(r.verdict).toBe("block");
    expect(r.findings[0]).toMatchObject({ kind: "missing_po", message: "PO 4599999999 does not exist." });
  });
  it("a PO raised on another supplier blocks", () => {
    const r = run({ ...demoInvoice("INV-7782"), poId: "4500001234" });
    expect(r.verdict).toBe("block");
    expect(r.findings[0].rootCause).toBe("PO belongs to a different supplier");
  });
  it("receipt missing and delivery not yet due: billed before delivery, owner Supplier", () => {
    const r = run(demoInvoice("INV-7784"), data, ENGINE_CONFIG, "2026-10-31");
    expect(r.findings[0]).toMatchObject({ rootCause: "Billed before delivery or receipt", owner: "Supplier", verdict: "block" });
  });
  it("invoice quantity above the delivery note is billed for undelivered quantity (Supplier)", () => {
    const r = run(edit(demoInvoice("INV-7781"), 2, { qty: 50 }));
    expect(r.findings.find((f) => f.kind === "quantity")).toMatchObject({ rootCause: "Billed for undelivered quantity", owner: "Supplier" });
  });
  it("a price that matches the PO's own contract needs no finding even if the contract moved on", () => {
    expect(run(demoInvoice("INV-7782")).findings).toEqual([]);
  });
  it("an item that is not on the PO is flagged for the Buyer", () => {
    const inv = demoInvoice("INV-7782");
    const r = run({ ...inv, lines: inv.lines.map((l, i) => (i === 0 ? { ...l, itemCode: "ZZ-9", description: "Mystery item" } : l)) });
    expect(r.findings[0]).toMatchObject({ kind: "not_on_po", owner: "Buyer" });
  });
  it("an unconvertible unit is flagged", () => {
    const r = run(edit(demoInvoice("INV-7782"), 0, { uom: "box" }));
    expect(r.findings[0]).toMatchObject({ kind: "uom", verdict: "flag", rootCause: "Unit of measure cannot be converted" });
  });
  it("arithmetic errors are flagged for the supplier", () => {
    const inv = demoInvoice("INV-7782");
    const r = run({ ...inv, total: inv.total + 500 });
    expect(r.verdict).toBe("flag");
    expect(r.findings[0]).toMatchObject({ kind: "arithmetic", rootCause: "Invoice arithmetic does not add up" });
    const bad = run({ ...inv, lines: inv.lines.map((l, i) => (i === 0 ? { ...l, amount: l.amount + 10 } : l)) });
    expect(bad.findings.some((f) => f.kind === "arithmetic" && f.lineNo === 1)).toBe(true);
  });
  it("a price below the PO is described as below", () => {
    const r = run(edit(demoInvoice("INV-7782"), 0, { unitPrice: 55 }));
    expect(r.findings[0].message).toMatch(/below PO/);
    expect(r.findings[0].rootCause).toBe("Price differs from both PO and contract");
  });
});

describe("duplicate fingerprint", () => {
  it("normalises invoice numbers", () => {
    expect(normaliseInvoiceNo("INV-6120R")).toBe("6120");
    expect(normaliseInvoiceNo("inv 06120-A")).toBe("6120");
    expect(normaliseInvoiceNo("6120")).toBe("6120");
    expect(normaliseInvoiceNo("INV-6121")).toBe("6121");
  });
  const dup = demoInvoice("INV-6120R");
  it("needs a similar amount: a different total is not a duplicate", () => {
    const r = run(edit(dup, 0, { qty: 12 }));
    expect(r.findings.some((f) => f.kind === "duplicate")).toBe(false);
  });
  it("needs the date window: 40 days apart is not a duplicate", () => {
    expect(run({ ...dup, invoiceDate: "2026-11-30" }).findings.some((f) => f.kind === "duplicate")).toBe(false);
  });
  it("tolerates a ₹1 difference in the total", () => {
    expect(run({ ...dup, total: dup.total + 1 }).findings.some((f) => f.kind === "duplicate")).toBe(true);
  });
  it("a clerk's 'not a duplicate' decision removes the block; 'duplicate' keeps it", () => {
    const no = run({ ...dup, duplicateDecision: { decision: "not_duplicate", matchedInvoiceId: "INV-6120", by: "x", reason: "A genuine second delivery", at: "" } });
    expect(no.verdict).toBe("approve");
    const yes = run({ ...dup, duplicateDecision: { decision: "duplicate", matchedInvoiceId: "INV-6120", by: "x", reason: "Same document", at: "" } });
    expect(yes.verdict).toBe("block");
    expect(yes.findings[0].message).toContain("Confirmed duplicate");
  });
  it("a different supplier's matching number is not a duplicate", () => {
    const other = { ...data, invoices: data.invoices.map((i) => (i.id === "INV-6120" ? { ...i, vendorId: "V-1001" } : i)) };
    expect(run(dup, other).findings.some((f) => f.kind === "duplicate")).toBe(false);
  });
});

describe("output quality and isolation", () => {
  const all = ["INV-7781", "INV-7782", "INV-6120R", "INV-7784", "INV-7785", "INV-7786"].flatMap((f) => run(demoInvoice(f)).findings);
  it("every finding has a reason, owner and fix, and none accuses anyone", () => {
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const f of all) {
      expect(f.message.length).toBeGreaterThan(15);
      expect(f.rootCause.length).toBeGreaterThan(3);
      expect(f.owner.length).toBeGreaterThan(2);
      expect(f.smallestFix.length).toBeGreaterThan(10);
      expect(`${f.message} ${f.rootCause} ${f.smallestFix}`).not.toMatch(/fraud|fake|forg|cheat|steal|suspicious/i);
    }
  });
  it("fixes read as counterfactuals or plain actions", () => {
    for (const f of all.filter((x) => x.verdict !== "approve" && x.kind !== "duplicate")) expect(f.smallestFix).toMatch(/^Passes (if|once)/);
  });
  it("is deterministic and runs in under 50 ms per invoice", () => {
    const inv = demoInvoice("INV-7781");
    expect(JSON.stringify(run(inv))).toBe(JSON.stringify(run(inv)));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) run(inv);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
  it("the engine imports nothing from UI, IO or framework modules", () => {
    const dir = path.join(root, "src", "engine");
    for (const f of fs.readdirSync(dir).filter((n) => /\.ts$/.test(n) && !n.endsWith(".test.ts"))) {
      const imports = [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) expect(["./config", "./match", "../lib/format", "../lib/types", "../lib/constants"]).toContain(i);
    }
  });
  it("runs on every seeded invoice without error", () => {
    for (const inv of data.invoices) expect(() => run(inv)).not.toThrow();
  });
});
