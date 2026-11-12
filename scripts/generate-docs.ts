// Generates the six demo invoices into data/demo-docs/ (PDFs with a real text layer, plus one scanned-looking JPG),
// the expected extraction values for each, and the stored OCR fallback for the JPG.
// Run: npm run docs:generate
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { PLANT } from "../src/lib/constants";
import { parseInvoice } from "../src/lib/extract/parse";
import { readPdfItems } from "../src/lib/extract/pdf";
import { assertTotals, computeTotals, inr, r2 } from "./lib/money";
import { DEMO_INVOICES, vendorById, type DemoInvoice, type TemplateId, type VendorInfo } from "./lib/spec";

type Doc = InstanceType<typeof PDFDocument>;
type Align = "left" | "right" | "center";

const OUT = path.join(process.cwd(), "data", "demo-docs");
const W = 595.28;
const HSN: Record<string, string> = { "AX-40": "3824", "C-12": "3815", "DR-200": "3923" };

// ---------------------------------------------------------------- tiny drawing helpers
const FONT = { sans: ["Helvetica", "Helvetica-Bold"], serif: ["Times-Roman", "Times-Bold"] } as const;

function put(d: Doc, s: string, x: number, y: number, o: { w?: number; align?: Align; font?: string; size?: number; color?: string } = {}) {
  d.font(o.font ?? "Helvetica").fontSize(o.size ?? 9).fillColor(o.color ?? "#1a1a1a");
  d.text(s, x, y, { width: o.w ?? 400, align: o.align ?? "left", lineBreak: false });
}

interface Col { label: string; x: number; w: number; align: Align; cell: (l: DemoInvoice["lines"][number], i: number) => string }

function drawTable(
  d: Doc, cols: Col[], lines: DemoInvoice["lines"], y0: number,
  o: { fonts: readonly [string, string]; size: number; headFill?: string; headColor?: string; grid?: boolean; rule?: string; rowH?: number },
): number {
  const rowH = o.rowH ?? 22;
  const x0 = cols[0].x - 4;
  const x1 = cols[cols.length - 1].x + cols[cols.length - 1].w + 4;
  if (o.headFill) d.rect(x0, y0 - 5, x1 - x0, rowH, ).fill(o.headFill);
  for (const c of cols) put(d, c.label, c.x, y0, { w: c.w, align: c.align, font: o.fonts[1], size: o.size, color: o.headColor ?? "#1a1a1a" });
  let y = y0 + rowH;
  if (o.grid) {
    d.lineWidth(0.6).strokeColor("#444").rect(x0, y0 - 5, x1 - x0, rowH * (lines.length + 1)).stroke();
    for (const c of cols.slice(1)) d.moveTo(c.x - 4, y0 - 5).lineTo(c.x - 4, y0 - 5 + rowH * (lines.length + 1)).stroke();
    for (let i = 1; i <= lines.length; i++) d.moveTo(x0, y0 - 5 + rowH * i).lineTo(x1, y0 - 5 + rowH * i).stroke();
  } else {
    d.lineWidth(0.6).strokeColor(o.rule ?? "#999").moveTo(x0, y0 + rowH - 6).lineTo(x1, y0 + rowH - 6).stroke();
  }
  lines.forEach((l, i) => {
    for (const c of cols) put(d, c.cell(l, i), c.x, y, { w: c.w, align: c.align, font: o.fonts[0], size: o.size });
    if (!o.grid) d.lineWidth(0.3).strokeColor("#ccc").moveTo(x0, y + rowH - 6).lineTo(x1, y + rowH - 6).stroke();
    y += rowH;
  });
  return y - 6 + (o.grid ? 0 : 6);
}

interface TotalRow { label: string; amount: number; bold?: boolean }

function totalsRows(inv: DemoInvoice, v: VendorInfo, labels: { sub: string; total: string; cgst?: string; sgst?: string; igst?: string }, t: ReturnType<typeof computeTotals>): TotalRow[] {
  const rate = inv.taxRatePct;
  const rows: TotalRow[] = [{ label: labels.sub, amount: t.subtotal }];
  if (v.stateCode === PLANT.gstin.slice(0, 2)) {
    const half = r2(t.tax / 2);
    if (r2(half * 2) !== t.tax) throw new Error(`${inv.invoiceNo}: tax cannot be split evenly`);
    rows.push({ label: (labels.cgst ?? "CGST @ {r}%").replace("{r}", String(rate / 2)), amount: half });
    rows.push({ label: (labels.sgst ?? "SGST @ {r}%").replace("{r}", String(rate / 2)), amount: half });
  } else {
    rows.push({ label: (labels.igst ?? "IGST @ {r}%").replace("{r}", String(rate)), amount: t.tax });
  }
  rows.push({ label: labels.total, amount: t.total, bold: true });
  return rows;
}

function drawTotals(d: Doc, rows: TotalRow[], y: number, o: { xLabel: number; xRight: number; fonts: readonly [string, string]; size: number }) {
  rows.forEach((r, i) => {
    const yy = y + i * 17;
    if (r.bold) d.lineWidth(0.6).strokeColor("#666").moveTo(o.xLabel - 4, yy - 4).lineTo(o.xRight, yy - 4).stroke();
    put(d, r.label, o.xLabel, yy, { w: 120, font: o.fonts[r.bold ? 1 : 0], size: o.size + (r.bold ? 1 : 0) });
    put(d, inr(r.amount), o.xRight - 90, yy, { w: 90, align: "right", font: o.fonts[r.bold ? 1 : 0], size: o.size + (r.bold ? 1 : 0) });
  });
}

function buyerBlock(d: Doc, x: number, y: number, fonts: readonly [string, string], size: number, title = "Bill To") {
  put(d, title, x, y, { font: fonts[1], size });
  put(d, PLANT.name, x, y + 13, { font: fonts[0], size });
  put(d, PLANT.address, x, y + 25, { font: fonts[0], size: size - 1, color: "#444" });
  put(d, `GSTIN: ${PLANT.gstin}`, x, y + 37, { font: fonts[0], size: size - 1, color: "#444" });
}

function footer(d: Doc, fonts: readonly [string, string], y = 790) {
  put(d, "Payment terms: 45 days from date of receipt of invoice. Subject to Navi Mumbai jurisdiction.", 40, y - 16, { font: fonts[0], size: 7.5, color: "#666", w: 500 });
  put(d, "Fictional demo document. Every name, number and ID on this page is invented.", 40, y, { font: fonts[0], size: 7, color: "#888", w: 500 });
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dmy = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d, dd: String(d).padStart(2, "0"), mm: String(m).padStart(2, "0") }; };

const qtyS = (n: number) => inr(n, 0);
const price = (n: number) => inr(n, 2);

// ---------------------------------------------------------------- the six layouts
type Layout = (d: Doc, inv: DemoInvoice, v: VendorInfo, t: ReturnType<typeof computeTotals>) => void;

const LAYOUTS: Record<TemplateId, Layout> = {
  // Left letterhead, labelled meta block, 8-column table with item codes and HSN, CGST/SGST.
  vihar(d, inv, v, t) {
    const f = FONT.sans;
    put(d, v.name, 40, 40, { font: f[1], size: 20, color: "#1f4e3d", w: 330 });
    put(d, v.address, 40, 66, { size: 8.5, color: "#555", w: 330 });
    put(d, `GSTIN: ${v.gstin}`, 40, 80, { size: 8.5, color: "#555", w: 330 });
    put(d, "TAX INVOICE", 380, 44, { font: f[1], size: 14, w: 175, align: "right", color: "#1f4e3d" });
    d.lineWidth(1).strokeColor("#1f4e3d").moveTo(40, 100).lineTo(555, 100).stroke();
    const dt = dmy(inv.invoiceDate);
    [["Invoice No:", inv.invoiceNo], ["Invoice Date:", `${dt.dd}-${MON[dt.m - 1]}-${dt.y}`], ["PO Ref:", inv.poId]].forEach(([k, val], i) => {
      put(d, k, 380, 112 + i * 14, { font: f[1], size: 9, w: 70 });
      put(d, val, 462, 112 + i * 14, { size: 9, w: 93 });
    });
    buyerBlock(d, 40, 112, f, 9);
    const y = drawTable(d, [
      { label: "Sr", x: 40, w: 22, align: "left", cell: (_l, i) => String(i + 1) },
      { label: "Code", x: 66, w: 50, align: "left", cell: (l) => l.itemCode },
      { label: "Description", x: 120, w: 170, align: "left", cell: (l) => l.description },
      { label: "HSN", x: 294, w: 36, align: "left", cell: (l) => HSN[l.itemCode] ?? "3824" },
      { label: "Qty", x: 334, w: 40, align: "right", cell: (l) => qtyS(l.qty) },
      { label: "UoM", x: 388, w: 30, align: "left", cell: (l) => l.uom },
      { label: "Rate", x: 420, w: 62, align: "right", cell: (l) => price(l.unitPrice) },
      { label: "Amount", x: 486, w: 69, align: "right", cell: (l) => price(r2(l.qty * l.unitPrice)) },
    ], inv.lines, 190, { fonts: f, size: 9, headFill: "#e8efe9", rule: "#1f4e3d" });
    drawTotals(d, totalsRows(inv, v, { sub: "Sub Total", total: "Grand Total" }, t), y + 16, { xLabel: 370, xRight: 555, fonts: f, size: 9 });
    put(d, "For " + v.name, 380, y + 120, { font: f[1], size: 8.5, w: 175, align: "right" });
    put(d, "Authorised signatory", 380, y + 160, { size: 8, w: 175, align: "right", color: "#555" });
    footer(d, f);
  },

  // Coloured letterhead bar, meta labels stacked above their values, 5-column table, CGST/SGST.
  konkan(d, inv, v, t) {
    const f = FONT.sans;
    d.rect(0, 0, W, 72).fill("#7a3512");
    put(d, v.name.toUpperCase(), 0, 20, { font: f[1], size: 20, color: "#ffffff", w: W, align: "center" });
    put(d, v.address, 0, 48, { size: 8, color: "#f3e3d8", w: W, align: "center" });
    put(d, `GSTIN : ${v.gstin}`, 40, 84, { size: 8.5, color: "#555" });
    put(d, "INVOICE", 400, 84, { font: f[1], size: 11, w: 155, align: "right", color: "#7a3512" });
    const dt = dmy(inv.invoiceDate);
    [["Bill No.", inv.invoiceNo, 40], ["Bill Date", `${dt.dd}/${dt.mm}/${dt.y}`, 200], ["Order No.", inv.poId, 360]].forEach(([k, val, x]) => {
      put(d, k as string, x as number, 112, { size: 7.5, color: "#7a7a7a", w: 140 });
      put(d, val as string, x as number, 124, { font: f[1], size: 11, w: 150 });
    });
    buyerBlock(d, 40, 156, f, 9, "Billed To");
    const y = drawTable(d, [
      { label: "Description", x: 40, w: 250, align: "left", cell: (l) => l.description },
      { label: "Qty", x: 294, w: 44, align: "right", cell: (l) => qtyS(l.qty) },
      { label: "Unit", x: 350, w: 40, align: "left", cell: (l) => l.uom },
      { label: "Rate (Rs.)", x: 392, w: 70, align: "right", cell: (l) => price(l.unitPrice) },
      { label: "Amount (Rs.)", x: 466, w: 89, align: "right", cell: (l) => price(r2(l.qty * l.unitPrice)) },
    ], inv.lines, 225, { fonts: f, size: 9.5, headFill: "#f1e6de", rule: "#7a3512" });
    drawTotals(d, totalsRows(inv, v, { sub: "Taxable Value", total: "Total (Rs.)", cgst: "CGST {r}%", sgst: "SGST {r}%" }, t), y + 16, { xLabel: 370, xRight: 555, fonts: f, size: 9.5 });
    footer(d, f);
  },

  // Serif, right-aligned letterhead, meta as single "label : value" lines, full grid table, IGST.
  deccan(d, inv, v, t) {
    const f = FONT.serif;
    put(d, v.name, 40, 38, { font: f[1], size: 21, w: 515, align: "right" });
    put(d, v.address, 40, 64, { size: 9.5, w: 515, align: "right", font: f[0] });
    put(d, `GSTIN : ${v.gstin}`, 40, 77, { size: 9.5, w: 515, align: "right", font: f[0] });
    put(d, "INVOICE", 40, 44, { font: f[1], size: 17, w: 200 });
    d.lineWidth(1.5).strokeColor("#222").moveTo(40, 98).lineTo(555, 98).stroke();
    const dt = dmy(inv.invoiceDate);
    put(d, `Invoice # : ${inv.invoiceNo}`, 40, 112, { font: f[0], size: 10.5, w: 250 });
    put(d, `Dated : ${dt.dd}.${dt.mm}.${dt.y}`, 40, 127, { font: f[0], size: 10.5, w: 250 });
    put(d, `Purchase Order : ${inv.poId}`, 40, 142, { font: f[0], size: 10.5, w: 250 });
    buyerBlock(d, 340, 112, f, 9.5, "Consignee");
    const y = drawTable(d, [
      { label: "S.No", x: 44, w: 30, align: "left", cell: (_l, i) => String(i + 1) },
      { label: "Item Description", x: 82, w: 186, align: "left", cell: (l) => l.description },
      { label: "Qty", x: 272, w: 46, align: "right", cell: (l) => qtyS(l.qty) },
      { label: "Unit", x: 330, w: 32, align: "left", cell: (l) => l.uom },
      { label: "Rate", x: 366, w: 78, align: "right", cell: (l) => price(l.unitPrice) },
      { label: "Amount", x: 452, w: 99, align: "right", cell: (l) => price(r2(l.qty * l.unitPrice)) },
    ], inv.lines, 190, { fonts: f, size: 10, grid: true });
    drawTotals(d, totalsRows(inv, v, { sub: "Sub-Total", total: "Invoice Total" }, t), y + 18, { xLabel: 370, xRight: 555, fonts: f, size: 10 });
    put(d, "E. & O.E.", 40, y + 18, { font: f[0], size: 8.5, w: 100 });
    footer(d, f);
  },

  // Boxed letterhead, label/value pairs in a bordered grid, 7-column table with a per-line GST % column.
  sahyadri(d, inv, v, t) {
    const f = FONT.sans;
    d.lineWidth(0.8).strokeColor("#222").rect(40, 30, 515, 68).stroke();
    put(d, v.name, 50, 38, { font: f[1], size: 17, w: 330 });
    put(d, v.address, 50, 60, { size: 8.5, color: "#444", w: 330 });
    put(d, `GSTIN: ${v.gstin}`, 50, 74, { size: 8.5, color: "#444", w: 330 });
    put(d, "TAX INVOICE", 400, 40, { font: f[1], size: 12, w: 146, align: "right" });
    d.rect(40, 104, 515, 40).stroke();
    d.moveTo(300, 104).lineTo(300, 144).stroke();
    d.moveTo(40, 124).lineTo(555, 124).stroke();
    const dt = dmy(inv.invoiceDate);
    put(d, "Tax Invoice No.", 46, 110, { font: f[1], size: 8.5, w: 85 });
    put(d, inv.invoiceNo, 140, 110, { size: 9, w: 150 });
    put(d, "Invoice Dt.", 306, 110, { font: f[1], size: 8.5, w: 70 });
    put(d, `${dt.dd} ${FULL[dt.m - 1]} ${dt.y}`, 390, 110, { size: 9, w: 160 });
    put(d, "Buyer PO No.", 46, 130, { font: f[1], size: 8.5, w: 85 });
    put(d, inv.poId, 140, 130, { size: 9, w: 150 });
    buyerBlock(d, 46, 156, f, 9, "Buyer");
    const y = drawTable(d, [
      { label: "Item Description", x: 46, w: 196, align: "left", cell: (l) => l.description },
      { label: "HSN", x: 250, w: 40, align: "left", cell: () => "2804" },
      { label: "Qty", x: 296, w: 40, align: "right", cell: (l) => qtyS(l.qty) },
      { label: "UoM", x: 346, w: 30, align: "left", cell: (l) => l.uom },
      { label: "Unit Price", x: 380, w: 62, align: "right", cell: (l) => price(l.unitPrice) },
      { label: "GST %", x: 448, w: 34, align: "right", cell: () => `${inv.taxRatePct}%` },
      { label: "Amount", x: 486, w: 64, align: "right", cell: (l) => price(r2(l.qty * l.unitPrice)) },
    ], inv.lines, 225, { fonts: f, size: 8.5, grid: true });
    drawTotals(d, totalsRows(inv, v, { sub: "Taxable Amount", total: "Total Payable", cgst: "CGST @ {r} %", sgst: "SGST @ {r} %" }, t), y + 18, { xLabel: 370, xRight: 555, fonts: f, size: 9 });
    footer(d, f);
  },

  // Plain layout, labels without colons, IGST at 12%. Rendered to an image like a scan.
  malabar(d, inv, v, t) {
    const f = FONT.sans;
    put(d, v.name, 40, 42, { font: f[1], size: 18, color: "#12355b", w: 400 });
    put(d, v.address, 40, 66, { size: 8.5, color: "#444", w: 400 });
    put(d, `GSTIN: ${v.gstin}`, 40, 79, { size: 8.5, color: "#444", w: 400 });
    put(d, "INVOICE", 400, 44, { font: f[1], size: 15, w: 155, align: "right", color: "#12355b" });
    d.lineWidth(0.8).strokeColor("#12355b").moveTo(40, 98).lineTo(555, 98).stroke();
    const dt = dmy(inv.invoiceDate);
    [["Invoice No", inv.invoiceNo], ["Invoice Date", `${dt.dd}/${dt.mm}/${dt.y}`], ["PO No.", inv.poId]].forEach(([k, val], i) => {
      put(d, k, 40, 112 + i * 18, { font: f[1], size: 10, w: 80 });
      put(d, val, 130, 112 + i * 18, { size: 10, w: 140 });
    });
    buyerBlock(d, 340, 112, f, 9.5, "Bill To");
    const y = drawTable(d, [
      { label: "Sr", x: 40, w: 22, align: "left", cell: (_l, i) => String(i + 1) },
      { label: "Description", x: 70, w: 230, align: "left", cell: (l) => l.description },
      { label: "Qty", x: 304, w: 44, align: "right", cell: (l) => qtyS(l.qty) },
      { label: "Unit", x: 360, w: 40, align: "left", cell: (l) => l.uom },
      { label: "Rate", x: 404, w: 66, align: "right", cell: (l) => price(l.unitPrice) },
      { label: "Amount", x: 476, w: 79, align: "right", cell: (l) => price(r2(l.qty * l.unitPrice)) },
    ], inv.lines, 205, { fonts: f, size: 10, rule: "#12355b", rowH: 24 });
    drawTotals(d, totalsRows(inv, v, { sub: "Sub Total", total: "Net Payable", igst: "IGST {r}%" }, t), y + 16, { xLabel: 370, xRight: 555, fonts: f, size: 10 });
    footer(d, f);
  },

  // Serif, ruled lines only, abbreviated labels, "Particulars" table, IGST.
  girnar(d, inv, v, t) {
    const f = FONT.serif;
    put(d, v.name, 40, 36, { font: f[1], size: 20, w: 400 });
    put(d, v.address, 40, 62, { size: 9.5, font: f[0], w: 400 });
    put(d, `GSTIN : ${v.gstin}`, 40, 75, { size: 9.5, font: f[0], w: 400 });
    d.lineWidth(0.5).strokeColor("#222").moveTo(40, 94).lineTo(555, 94).stroke().moveTo(40, 97).lineTo(555, 97).stroke();
    put(d, "TAX INVOICE", 0, 106, { font: f[1], size: 13, w: W, align: "center" });
    const dt = dmy(inv.invoiceDate);
    put(d, "Inv. No.", 40, 132, { font: f[1], size: 10, w: 56 });
    put(d, inv.invoiceNo, 100, 132, { font: f[0], size: 10, w: 140 });
    put(d, "Inv. Date", 40, 147, { font: f[1], size: 10, w: 56 });
    put(d, `${dt.dd}/${dt.mm}/${dt.y}`, 100, 147, { font: f[0], size: 10, w: 140 });
    put(d, "PO No.", 330, 132, { font: f[1], size: 10, w: 44 });
    put(d, inv.poId, 380, 132, { font: f[0], size: 10, w: 170 });
    buyerBlock(d, 40, 172, f, 9.5, "To");
    const y = drawTable(d, [
      { label: "Particulars", x: 40, w: 250, align: "left", cell: (l) => l.description },
      { label: "Qty", x: 296, w: 40, align: "right", cell: (l) => qtyS(l.qty) },
      { label: "Unit", x: 348, w: 40, align: "left", cell: (l) => l.uom },
      { label: "Rate", x: 392, w: 68, align: "right", cell: (l) => price(l.unitPrice) },
      { label: "Amount (Rs.)", x: 466, w: 89, align: "right", cell: (l) => price(r2(l.qty * l.unitPrice)) },
    ], inv.lines, 242, { fonts: f, size: 10, rule: "#222" });
    drawTotals(d, totalsRows(inv, v, { sub: "Total before tax", total: "Total Amount" }, t), y + 16, { xLabel: 370, xRight: 555, fonts: f, size: 10 });
    footer(d, f);
  },
};

// ---------------------------------------------------------------- render
function renderPdf(inv: DemoInvoice): Promise<Buffer> {
  const v = vendorById(inv.vendorId);
  const t = computeTotals(inv.lines, inv.taxRatePct);
  assertTotals(inv.invoiceNo, inv.lines.map((l) => ({ ...l, amount: r2(l.qty * l.unitPrice) })), inv.taxRatePct, t);
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({
      size: "A4", margin: 0,
      info: { Title: `Invoice ${inv.invoiceNo}`, Author: v.name, Creator: v.name, CreationDate: new Date("2026-11-09T09:00:00Z"), ModDate: new Date("2026-11-09T09:00:00Z") },
    });
    const chunks: Buffer[] = [];
    d.on("data", (c: Buffer) => chunks.push(c));
    d.on("end", () => resolve(Buffer.concat(chunks)));
    d.on("error", reject);
    LAYOUTS[inv.template](d, inv, v, t);
    d.end();
  });
}

/** Rasterise page 1 to a PNG using pdf.js and a Node canvas, then degrade it a little like a phone scan. */
async function rasterise(pdf: Buffer, scale: number): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  const { pathToFileURL } = await import("node:url");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, "legacy", "build", "pdf.worker.mjs")).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf), verbosity: 0,
    standardFontDataUrl: pathToFileURL(path.join(root, "standard_fonts") + path.sep).href,
  });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvas: canvas as any, canvasContext: ctx as any, viewport: vp }).promise;
  await task.destroy();
  return canvas.toBuffer("image/png");
}

async function scanLook(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const w = meta.width!, h = meta.height!;
  // Seeded noise so regenerating the documents gives byte-identical files.
  let seed = 7785;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i += 3) { const n = Math.max(0, Math.min(255, Math.round(128 + (rnd() + rnd() + rnd() - 1.5) * 24))); raw[i] = raw[i + 1] = raw[i + 2] = n; }
  const noise = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return sharp(png)
    .composite([{ input: noise, blend: "soft-light" }])
    .greyscale()
    .linear(0.95, 8)
    .blur(0.3)
    .jpeg({ quality: 72, mozjpeg: false })
    .toBuffer();
}

function expected(inv: DemoInvoice) {
  const v = vendorById(inv.vendorId);
  const t = computeTotals(inv.lines, inv.taxRatePct);
  const withCode = inv.template === "vihar";
  return {
    file: inv.file,
    purpose: inv.purpose,
    expectedVerdict: inv.expectedVerdict,
    vendorName: v.name,
    vendorGstin: v.gstin,
    invoiceNumber: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    poNumber: inv.poId,
    lines: inv.lines.map((l) => ({
      ...(withCode ? { itemCode: l.itemCode } : {}),
      description: l.description, qty: l.qty, unit: l.uom, unitPrice: l.unitPrice, amount: r2(l.qty * l.unitPrice),
    })),
    subtotal: t.subtotal, taxRatePct: inv.taxRatePct, taxAmount: t.tax, total: t.total,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vendors = [...new Set(DEMO_INVOICES.map((i) => i.vendorId))].map((id) => vendorById(id));
  for (const inv of DEMO_INVOICES) {
    const pdf = await renderPdf(inv);
    const base = inv.file.replace(/\.(pdf|jpg)$/, "");
    if (inv.file.endsWith(".pdf")) {
      fs.writeFileSync(path.join(OUT, inv.file), pdf);
    } else {
      const png = await rasterise(pdf, 2);
      fs.writeFileSync(path.join(OUT, inv.file), await scanLook(png));
      // Stored fallback for the OCR step: the clean text layer of the same layout, capped at medium confidence.
      const { items, pages } = await readPdfItems(new Uint8Array(pdf));
      const fx = parseInvoice(items, pages, { kind: "image", fileName: inv.file }, { vendors, buyerGstin: PLANT.gstin, cap: "medium" });
      fx.notes = [];
      fs.writeFileSync(path.join(OUT, `${base}.extracted.json`), JSON.stringify(fx, null, 2) + "\n");
    }
    fs.writeFileSync(path.join(OUT, `${base}.expected.json`), JSON.stringify(expected(inv), null, 2) + "\n");
    console.log("wrote", inv.file);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
