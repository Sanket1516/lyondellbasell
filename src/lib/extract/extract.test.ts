import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExtractError, extractDocument } from "./index";
import { allFields } from "./parse";
import type { ExtractedInvoice } from "./types";

const DOCS = path.join(process.cwd(), "data", "demo-docs");
const vendors = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "seed", "vendors.json"), "utf8"));

interface Expected {
  file: string; vendorName: string; vendorGstin: string; invoiceNumber: string; invoiceDate: string; poNumber: string;
  lines: { itemCode?: string; description: string; qty: number; unit: string; unitPrice: number; amount: number }[];
  subtotal: number; taxRatePct: number; taxAmount: number; total: number;
}

const expectedFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith(".expected.json"));
const load = (e: Expected) => extractDocument(fs.readFileSync(path.join(DOCS, e.file)), e.file, vendors);

/** Compare every expected field and return [correct, total]. */
function score(x: ExtractedInvoice, e: Expected): [number, number, string[]] {
  const miss: string[] = [];
  let ok = 0, n = 0;
  const eq = (name: string, got: unknown, want: unknown) => { n++; if (got === want) ok++; else miss.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  eq("vendorName", x.vendorName.value, e.vendorName);
  eq("vendorGstin", x.vendorGstin.value, e.vendorGstin);
  eq("invoiceNumber", x.invoiceNumber.value, e.invoiceNumber);
  eq("invoiceDate", x.invoiceDate.value, e.invoiceDate);
  eq("poNumber", x.poNumber.value, e.poNumber);
  eq("subtotal", x.subtotal.value, e.subtotal);
  eq("taxRatePct", x.taxRatePct.value, e.taxRatePct);
  eq("taxAmount", x.taxAmount.value, e.taxAmount);
  eq("total", x.total.value, e.total);
  eq("lineCount", x.lines.length, e.lines.length);
  e.lines.forEach((el, i) => {
    const l = x.lines[i];
    if (el.itemCode !== undefined) eq(`line${i + 1}.itemCode`, l?.itemCode.value, el.itemCode);
    eq(`line${i + 1}.description`, l?.description.value, el.description);
    eq(`line${i + 1}.qty`, l?.qty.value, el.qty);
    eq(`line${i + 1}.unit`, l?.unit.value, el.unit);
    eq(`line${i + 1}.unitPrice`, l?.unitPrice.value, el.unitPrice);
    eq(`line${i + 1}.amount`, l?.amount.value, el.amount);
  });
  return [ok, n, miss];
}

describe("extraction of the six demo documents", () => {
  it("has expected values for all six", () => expect(expectedFiles).toHaveLength(6));

  for (const f of expectedFiles) {
    const e: Expected = JSON.parse(fs.readFileSync(path.join(DOCS, f), "utf8"));
    it(`${e.file}: at least 95% of fields correct, within the time budget`, async () => {
      const t0 = Date.now();
      const x = await load(e);
      const ms = Date.now() - t0;
      const [ok, n, miss] = score(x, e);
      if (miss.length) console.log(e.file, `${ok}/${n}`, miss, x.notes);
      expect(ok / n).toBeGreaterThanOrEqual(0.95);
      expect(ms).toBeLessThan(e.file.endsWith(".jpg") ? 15000 : 5000);
      if (!x.fixture) for (const c of x.checks) expect(c.ok, `${e.file}: ${c.label} (${c.detail})`).toBe(true);
    }, 30000);
  }
});

describe("INV-7781 (golden)", () => {
  it("extracts exactly the planned table", async () => {
    const x = await extractDocument(fs.readFileSync(path.join(DOCS, "INV-7781.pdf")), "INV-7781.pdf", vendors);
    expect(x.vendorName.value).toBe("Vihar Chem Supplies");
    expect(x.invoiceNumber.value).toBe("INV-7781");
    expect(x.invoiceDate.value).toBe("2026-11-10");
    expect(x.poNumber.value).toBe("4500001234");
    expect(x.lines.map((l) => [l.itemCode.value, l.description.value, l.qty.value, l.unit.value, l.unitPrice.value, l.amount.value])).toEqual([
      ["AX-40", "Process additive AX-40", 1000, "kg", 412, 412000],
      ["C-12", "Catalyst carrier C-12", 5, "MT", 86000, 430000],
      ["DR-200", "HDPE drum 200 L", 40, "nos", 1450, 58000],
    ]);
    expect([x.subtotal.value, x.taxRatePct.value, x.taxAmount.value, x.total.value]).toEqual([900000, 18, 162000, 1062000]);
  });

  it("gives every PDF field a bounding box and high confidence", async () => {
    const x = await extractDocument(fs.readFileSync(path.join(DOCS, "INV-7781.pdf")), "INV-7781.pdf", vendors);
    for (const f of allFields(x)) {
      if (f.value === null) continue;
      expect(f.bbox, JSON.stringify(f)).toBeDefined();
      expect(f.confidence).toBe("high");
      expect(f.bbox!.x).toBeGreaterThanOrEqual(0);
      expect(f.bbox!.x + f.bbox!.w).toBeLessThanOrEqual(1.01);
    }
  });
});

describe("bad input", () => {
  it("rejects an empty file clearly", async () => {
    await expect(extractDocument(Buffer.alloc(0), "empty.pdf", vendors)).rejects.toThrow(ExtractError);
  });
  it("rejects a text file clearly", async () => {
    await expect(extractDocument(Buffer.from("hello, this is not an invoice"), "notes.txt", vendors)).rejects.toThrow(/not supported/);
  });
  it("reports a corrupt PDF without crashing", async () => {
    await expect(extractDocument(Buffer.from("%PDF-1.4\nthis is garbage"), "bad.pdf", vendors)).rejects.toThrow(/could not be read/);
  });
  it("reports a corrupt image without crashing", async () => {
    await expect(extractDocument(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("garbage")]), "bad.jpg", vendors)).rejects.toThrow(ExtractError);
  });
});
