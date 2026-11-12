// Renders the new demo-set invoices (data/demo-set/*.pdf + .expected.json) and writes data/demo-set/manifest.json, which lists all
// demo documents: the six curated ones in data/demo-docs plus the new ones. Deterministic: same input, same files.
// Layouts differ in structure (fonts, header placement, table style, wording); amount and date formats differ per document.
// Run: npm run demo-set:generate
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { PLANT } from "../src/lib/constants";
import { buildDataset, type AmountFormat, type DateFormat, type Layout } from "../src/foundation/generate";

const OUT = path.join(process.cwd(), "data", "demo-set");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function group(n: number, indian: boolean, dp = 2): string {
  const [int, frac] = Math.abs(n).toFixed(dp).split(".");
  const g = indian && int.length > 3 ? `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${int.slice(-3)}` : int.replace(/\B(?=(\d{3})+(?!\d))/g, indian ? "" : ",");
  return frac ? `${g}.${frac}` : g;
}
export function money(n: number, f: AmountFormat): string {
  switch (f) {
    case "rs_lakh": return `Rs. ${group(n, true)}`;
    case "inr_western": return `INR ${group(n, false)}`;
    case "plain": return n.toFixed(2);
    case "rs_dash": return `Rs ${group(n, true, 0)}/-`;
  }
}
export function dateText(iso: string, f: DateFormat): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (f === "d_mon_y") return `${String(d).padStart(2, "0")} ${MON[m - 1]} ${y}`;
  if (f === "ymd_slash") return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}

const STYLE: Record<Layout, { fonts: [string, string]; title: string; accent: string; grid: boolean; headerCentered: boolean; size: number }> = {
  classic: { fonts: ["Times-Roman", "Times-Bold"], title: "TAX INVOICE", accent: "#222222", grid: true, headerCentered: false, size: 10 },
  modern: { fonts: ["Helvetica", "Helvetica-Bold"], title: "Invoice", accent: "#1f4e79", grid: false, headerCentered: false, size: 9 },
  compact: { fonts: ["Courier", "Courier-Bold"], title: "TAX INVOICE / BILL", accent: "#333333", grid: true, headerCentered: false, size: 8.5 },
  ledger: { fonts: ["Helvetica", "Helvetica-Bold"], title: "Invoice", accent: "#6b3f1d", grid: false, headerCentered: true, size: 9.5 },
  letterhead: { fonts: ["Times-Roman", "Times-Bold"], title: "Commercial Invoice", accent: "#2e5e3e", grid: false, headerCentered: true, size: 10 },
};

async function main() {
  const ds = buildDataset();
  fs.mkdirSync(OUT, { recursive: true });
  const vendor = (id: string) => ds.vendors.find((v) => v.id === id)!;
  const rendered = ds.demoDocs.filter((d) => d.rendered);

  for (const doc of rendered) {
    const inv = ds.invoices.find((i) => i.id === doc.invoiceId)!;
    const v = vendor(inv.vendorId);
    const addr = ds.addresses.find((a) => a.vendorId === v.id && a.kind === "registered")!;
    const st = STYLE[doc.layout as Layout];
    const amt = doc.amountFormat as AmountFormat;
    const df = doc.dateFormat;
    const remit = ds.remit[inv.id];
    const bank = ds.banks.find((b) => b.accountNo === remit?.accountNo && b.vendorId === v.id) ?? ds.banks.find((b) => b.accountNo === remit?.accountNo);

    const pdf = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Invoice ${inv.id}`, Author: v.name, CreationDate: new Date("2026-11-10T00:00:00Z") } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => pdf.on("end", () => r(Buffer.concat(chunks))));
    const W = 595.28;
    const put = (s: string, x: number, y: number, o: { w?: number; align?: "left" | "right" | "center"; bold?: boolean; size?: number; color?: string } = {}) => {
      pdf.font(st.fonts[o.bold ? 1 : 0]).fontSize(o.size ?? st.size).fillColor(o.color ?? "#111").text(s, x, y, { width: o.w ?? 300, align: o.align ?? "left", lineBreak: false });
    };

    // header: vendor block, centred or left; "modern" gets a coloured band
    let y = 40;
    if (doc.layout === "modern") { pdf.rect(0, 0, W, 78).fill(st.accent); put(v.name, 40, 22, { w: 360, bold: true, size: 16, color: "#fff" }); put(st.title, 400, 26, { w: 155, align: "right", size: 14, color: "#fff" }); y = 92; }
    else if (st.headerCentered) { put(v.name.toUpperCase(), 40, y, { w: W - 80, align: "center", bold: true, size: 15, color: st.accent }); put(st.title, 40, y + 22, { w: W - 80, align: "center", size: 11 }); y += 50; }
    else { put(v.name, 40, y, { w: 360, bold: true, size: 14 }); put(st.title, 400, y, { w: 155, align: "right", bold: true, size: 12 }); y += 24; }
    put(`${addr.line}, ${addr.city} ${addr.pincode}`, 40, y, { w: W - 80, align: st.headerCentered ? "center" : "left" });
    put(`GSTIN: ${v.gstin}`, 40, y + 13, { w: W - 80, align: st.headerCentered ? "center" : "left" });
    y += 44;

    // meta
    const meta: [string, string][] = [["Invoice No", inv.id], ["Invoice Date", dateText(inv.invoiceDate, df)], ["PO No", inv.poId ?? ""], ["Place of supply", "Maharashtra (27)"]];
    meta.forEach(([k, val], i) => { put(`${k}:`, 40, y + i * 14, { w: 100, bold: true }); put(val, 140, y + i * 14, { w: 200 }); });
    put("Bill To:", 360, y, { w: 195, bold: true }); put(PLANT.name, 360, y + 14, { w: 195 }); put(PLANT.address, 360, y + 28, { w: 195 }); put(`GSTIN: ${PLANT.gstin}`, 360, y + 56, { w: 195 });
    y += 82;

    // table
    const cols = [{ l: "#", x: 44, w: 18, a: "left" as const }, { l: "Description", x: 66, w: 190, a: "left" as const }, { l: "Qty", x: 258, w: 50, a: "right" as const }, { l: "Unit", x: 312, w: 38, a: "left" as const }, { l: "Rate", x: 352, w: 85, a: "right" as const }, { l: "Amount", x: 440, w: 112, a: "right" as const }];
    const rowH = 24;
    if (st.grid) pdf.lineWidth(0.6).strokeColor("#444").rect(40, y - 5, W - 80, rowH * (inv.lines.length + 1)).stroke();
    else if (doc.layout === "modern") pdf.rect(40, y - 5, W - 80, rowH).fill("#e8eef5");
    for (const c of cols) put(c.l, c.x, y, { w: c.w, align: c.a, bold: true });
    if (!st.grid) pdf.lineWidth(0.6).strokeColor("#888").moveTo(40, y + rowH - 6).lineTo(W - 40, y + rowH - 6).stroke();
    inv.lines.forEach((l, i) => {
      const yy = y + rowH * (i + 1);
      if (st.grid) pdf.lineWidth(0.4).strokeColor("#444").moveTo(40, yy - 5).lineTo(W - 40, yy - 5).stroke();
      const cells = [String(l.lineNo), l.description, String(l.qty), l.uom, money(l.unitPrice, amt), money(l.amount, amt)];
      cols.forEach((c, k) => put(cells[k], c.x, yy, { w: c.w, align: c.a }));
    });
    y += rowH * (inv.lines.length + 1) + 12;

    // totals
    const half = v.stateCode === PLANT.gstin.slice(0, 2);
    const rate = inv.lines[0].taxRatePct;
    const rows: [string, number, boolean][] = [["Sub total", inv.subtotal, false]];
    if (half) { rows.push([`CGST @ ${rate / 2}%`, inv.tax / 2, false], [`SGST @ ${rate / 2}%`, inv.tax / 2, false]); } else rows.push([`IGST @ ${rate}%`, inv.tax, false]);
    rows.push(["Invoice Total", inv.total, true]);
    rows.forEach(([k, val, b], i) => { put(k, 330, y + i * 16, { w: 110, bold: b }); put(money(val, amt), 440, y + i * 16, { w: 112, align: "right", bold: b }); });
    y += rows.length * 16 + 22;

    // remittance
    put("Remit payment to:", 40, y, { bold: true, w: 200 });
    if (remit) {
      put(`Bank: ${bank?.bankName ?? "—"}`, 40, y + 14, { w: 300 }); put(`A/c No: ${remit.accountNo}`, 40, y + 28, { w: 300 }); put(`IFSC: ${remit.ifsc}`, 40, y + 42, { w: 300 });
    }
    put(`Payment terms: ${v.paymentTermsDays} days from invoice date. All disputes subject to ${addr.city} jurisdiction.`, 40, y + 66, { w: W - 80, size: 8, color: "#555" });
    put("This is a computer generated invoice. Fictional supplier and data, created for the LYB hackathon demo.", 40, 770, { w: W - 80, size: 7, color: "#777" });
    pdf.end();
    const buf = await done;

    const name = path.basename(doc.file);
    fs.writeFileSync(path.join(OUT, name), buf);
    fs.writeFileSync(path.join(OUT, name.replace(/\.pdf$/, ".expected.json")), JSON.stringify({
      file: name, purpose: doc.purpose, expectedVerdict: doc.expectedStatus, layout: doc.layout, amountFormat: doc.amountFormat, dateFormat: doc.dateFormat,
      vendorName: v.name, vendorGstin: v.gstin, invoiceNumber: inv.id, invoiceDate: inv.invoiceDate, poNumber: inv.poId,
      lines: inv.lines.map((l) => ({ itemCode: l.itemCode, description: l.description, qty: l.qty, unit: l.uom, unitPrice: l.unitPrice, amount: l.amount })),
      subtotal: inv.subtotal, taxRatePct: inv.lines[0].taxRatePct, taxAmount: inv.tax, total: inv.total, remittanceAccount: remit?.accountNo, remittanceIfsc: remit?.ifsc,
    }, null, 2) + "\n");
  }

  const planted = new Map(ds.planted.map((p) => [p.invoiceId, p]));
  const manifest = ds.demoDocs.map((d) => ({
    file: d.file, invoiceId: d.invoiceId, vendorId: ds.invoices.find((i) => i.id === d.invoiceId)!.vendorId, layout: d.layout, amountFormat: d.amountFormat,
    purpose: d.purpose, expectedStatus: d.expectedStatus, caseType: planted.get(d.invoiceId)?.caseType ?? "exception (see expected.json)", stage: planted.get(d.invoiceId)?.stage ?? "stage1",
  }));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Demo set: ${rendered.length} documents rendered to data/demo-set, manifest lists ${manifest.length} (incl. ${manifest.length - rendered.length} curated in data/demo-docs).`);
}
void main();
