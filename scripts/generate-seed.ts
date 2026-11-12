// Generates the fictional Plant X dataset into data/seed/*.json. Deterministic: fixed PRNG seed and a fixed "today".
// Run: npm run seed:generate   (then npm run seed / npm run reset to load it into data/state.json)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEMO_TODAY } from "../src/lib/constants";
import type { Finding, GoodsReceipt, Invoice, InvoiceLine, PurchaseOrder, DeliveryNote } from "../src/lib/types";
import { assertTotals, computeTotals, inr, r2 } from "./lib/money";
import {
  AMENDMENTS, BUYERS, CATALOG, DEMO_INVOICES, GIRNAR_CONTRACT_FRT, RECEIVERS, UOM_RULES, VENDORS,
  buildContracts, buildDemoSupport, catalogItem, vendorById,
} from "./lib/spec";

// ---------------------------------------------------------------- deterministic helpers
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261112);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const day = (iso: string, delta: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const ago = (n: number) => day(DEMO_TODAY, -n);

// ---------------------------------------------------------------- historical case specs
type Scn = "clean_paid" | "clean_approved" | "clean_pending" | "po_stale" | "missing_receipt" | "qty_under" | "tax" | "uom" | "off_contract" | "duplicate";
interface Spec { scn: Scn; vendorId: string; daysAgo: number; resolved?: boolean }

const S = (scn: Scn, vendorId: string, daysAgo: number, resolved = false): Spec => ({ scn, vendorId, daysAgo, resolved });
const SPECS: Spec[] = [
  // clean, paid long ago
  ...[[ "V-1001", 58], ["V-1002", 54], ["V-1003", 50], ["V-1005", 47], ["V-1006", 44], ["V-1004", 41], ["V-1001", 38], ["V-1002", 35], ["V-1005", 33], ["V-1006", 30], ["V-1003", 27]]
    .map(([v, d]) => S("clean_paid", v as string, d as number)),
  // clean, approved
  ...[["V-1002", 24], ["V-1001", 21], ["V-1005", 18], ["V-1003", 14], ["V-1006", 11], ["V-1004", 9]].map(([v, d]) => S("clean_approved", v as string, d as number)),
  // clean, waiting for an approver
  S("clean_pending", "V-1001", 2), S("clean_pending", "V-1002", 1), S("clean_pending", "V-1005", 0),
  // PO not updated after contract change: 7 open cases, 4 suppliers, ageing buckets 0-2, 3-7, 8-14, 15+
  S("po_stale", "V-1004", 1), S("po_stale", "V-1001", 5), S("po_stale", "V-1002", 6),
  S("po_stale", "V-1003", 10), S("po_stale", "V-1001", 13), S("po_stale", "V-1002", 19), S("po_stale", "V-1003", 23),
  // missing receipt
  S("missing_receipt", "V-1003", 1), S("missing_receipt", "V-1006", 6), S("missing_receipt", "V-1005", 16),
  // quantity above cumulative receipts
  S("qty_under", "V-1001", 4), S("qty_under", "V-1002", 12), S("qty_under", "V-1004", 26, true),
  // tax rate
  S("tax", "V-1005", 3), S("tax", "V-1006", 22, true),
  // unit of measure only (auto-cleared)
  S("uom", "V-1001", 20), S("uom", "V-1002", 15), S("uom", "V-1001", 8),
  // price differs from PO and contract
  S("off_contract", "V-1006", 7), S("off_contract", "V-1005", 19),
  // duplicate of a paid invoice
  S("duplicate", "V-1005", 5),
];

// ---------------------------------------------------------------- build
const purchaseOrders: PurchaseOrder[] = [];
const goodsReceipts: GoodsReceipt[] = [];
const deliveryNotes: DeliveryNote[] = [];
const invoices: Invoice[] = [];
const findings: Finding[] = [];

const demo = buildDemoSupport();
purchaseOrders.push(...demo.purchaseOrders);
goodsReceipts.push(...demo.goodsReceipts);
deliveryNotes.push(...demo.deliveryNotes);

const contracts = buildContracts();
const contractPrice = (vendorId: string, code: string) =>
  contracts.find((c) => c.vendorId === vendorId)!.prices.find((p) => p.itemCode === code)!.unitPrice;

interface Built { inv: Invoice; po: PurchaseOrder }
let caseNo = 0;
const drafts: { spec: Spec; build: Built; fin: Omit<Finding, "id" | "invoiceId">[] }[] = [];

function lineFrom(lineNo: number, code: string, vendorId: string, qty: number, price: number, uom: string, taxRatePct: number): InvoiceLine {
  const it = catalogItem(vendorId, code);
  return { lineNo, itemCode: code, description: it.description, qty, uom, unitPrice: price, taxRatePct, amount: r2(qty * price) };
}

function build(spec: Spec): Built & { fin: Omit<Finding, "id" | "invoiceId">[] } {
  caseNo++;
  const v = vendorById(spec.vendorId);
  const items = CATALOG[v.id];
  const amended = AMENDMENTS[v.id]?.itemCode;
  const receivedOn = ago(spec.daysAgo);
  const invoiceDate = day(receivedOn, -between(1, 2));
  const fin: Omit<Finding, "id" | "invoiceId">[] = [];

  // choose lines
  let chosen = items.filter((i) => i.code !== amended);
  if (spec.scn === "po_stale") chosen = [catalogItem(v.id, amended!), ...items.filter((i) => i.code !== amended).slice(0, 1)];
  else if (spec.scn === "uom") chosen = [v.id === "V-1001" ? catalogItem(v.id, "C-12") : catalogItem(v.id, "BAG-25")];
  else if (spec.scn === "off_contract") chosen = [catalogItem(v.id, v.id === "V-1006" ? "FRT-20" : "KF-500")];
  else if (spec.scn === "tax") chosen = items.filter((i) => i.code !== amended).slice(0, 2);
  else {
    const n = between(1, 2);
    chosen = [...chosen].sort(() => rand() - 0.5).slice(0, n);
  }
  chosen = chosen.slice(0, 2);

  // dates
  const staleAm = AMENDMENTS[v.id];
  const poIssued = spec.scn === "po_stale" ? day(staleAm.effectiveFrom, -between(7, 15)) : day(invoiceDate, -between(14, 28));
  const grDate = day(invoiceDate, -between(1, 4));
  assert.ok(poIssued < grDate && grDate <= invoiceDate, `case ${caseNo}: date order`);

  const poId = String(4500000800 + caseNo);
  const poLines = chosen.map((it, i) => ({
    lineNo: i + 1, itemCode: it.code, description: it.description, qty: pick(it.qty), uom: it.uom, unitPrice: it.price, taxCode: "GST18", taxRatePct: 18,
  }));
  const po: PurchaseOrder = { id: poId, vendorId: v.id, buyer: pick(BUYERS), issuedOn: poIssued, contractId: contracts.find((c) => c.vendorId === v.id)!.id, lines: poLines };

  let taxRate = 18;
  const invLines: InvoiceLine[] = poLines.map((pl) => lineFrom(pl.lineNo, pl.itemCode, v.id, pl.qty, pl.unitPrice, pl.uom, 18));
  let grQty = poLines.map((pl) => pl.qty);
  let hasGr = true;

  const buyer = po.buyer;
  const first = invLines[0];
  const firstPo = poLines[0];

  switch (spec.scn) {
    case "po_stale": {
      const cp = contractPrice(v.id, firstPo.itemCode);
      first.unitPrice = cp; first.amount = r2(first.qty * cp);
      const pct = r2(((cp - firstPo.unitPrice) / firstPo.unitPrice) * 100);
      fin.push({
        lineNo: 1, kind: "price", verdict: "flag",
        message: `Price is ${pct}% above PO. Contract ${po.contractId} sets ₹${inr(cp, 0)}.`,
        rootCause: "PO not updated after contract change", owner: "Buyer",
        smallestFix: `Update PO ${poId} line 1 to ₹${inr(cp, 0)}; the invoice then passes.`,
      });
      break;
    }
    case "missing_receipt":
      hasGr = false;
      fin.push({
        kind: "missing_receipt", verdict: "block",
        message: `No goods receipt is posted against PO ${poId}.`,
        rootCause: "Goods receipt not posted", owner: "Warehouse",
        smallestFix: `Post the goods receipt for PO ${poId}, or confirm the goods have not arrived.`,
      });
      break;
    case "qty_under": {
      const posted = Math.floor((firstPo.qty * 0.8) / 5) * 5;
      grQty[0] = posted;
      fin.push({
        lineNo: 1, kind: "quantity", verdict: "flag",
        message: `Invoice quantity ${first.qty} ${first.uom} exceeds receipts of ${posted} ${first.uom}.`,
        rootCause: "Goods receipt under-posted", owner: "Warehouse",
        smallestFix: `Post the remaining ${first.qty - posted} ${first.uom} receipt if the delivery note confirms it.`,
      });
      break;
    }
    case "tax":
      taxRate = 12;
      invLines.forEach((l) => (l.taxRatePct = 12));
      fin.push({
        kind: "tax", verdict: "flag",
        message: "Invoice bills GST 12%; PO tax code is GST 18%.",
        rootCause: "Invoice tax rate differs from PO tax code", owner: "Supplier",
        smallestFix: "Supplier to reissue the invoice at 18%, or Buyer to confirm the PO tax code.",
      });
      break;
    case "uom": {
      const rule = UOM_RULES.find((r) => r.itemCode === first.itemCode)!;
      const invQty = firstPo.qty / rule.factor;
      assert.ok(Number.isInteger(invQty), `case ${caseNo}: uom qty`);
      first.qty = invQty; first.uom = rule.fromUom; first.unitPrice = firstPo.unitPrice * rule.factor; first.amount = r2(first.qty * first.unitPrice);
      fin.push({
        lineNo: 1, kind: "uom", verdict: "approve",
        message: `Billed in ${rule.fromUom}; PO is in ${rule.toUom}. 1 ${rule.fromUom} = ${inr(rule.factor, 0)} ${rule.toUom}.`,
        rootCause: "Unit of measure only", owner: "System",
        smallestFix: "None. Converted automatically.",
      });
      break;
    }
    case "off_contract": {
      const cp = contractPrice(v.id, firstPo.itemCode);
      const billed = Math.round((firstPo.unitPrice * 1.07) / 10) * 10;
      assert.ok(billed !== firstPo.unitPrice && billed !== cp, `case ${caseNo}: off-contract price`);
      first.unitPrice = billed; first.amount = r2(first.qty * billed);
      fin.push({
        lineNo: 1, kind: "price", verdict: "flag",
        message: `Price ₹${inr(billed, 0)} differs from PO ₹${inr(firstPo.unitPrice, 0)} and contract ₹${inr(cp, 0)}.`,
        rootCause: "Price differs from both PO and contract", owner: "Supplier",
        smallestFix: `Supplier to correct the price to contract ₹${inr(cp, 0)}.`,
      });
      break;
    }
    default:
      break;
  }

  const totals = computeTotals(invLines, taxRate);
  assertTotals(`case ${caseNo}`, invLines, taxRate, totals);

  // receipts
  if (hasGr) {
    goodsReceipts.push({
      id: String(5000008000 + caseNo), poId, receivedOn: grDate, receivedBy: pick(RECEIVERS),
      lines: poLines.map((pl, i) => ({ lineNo: pl.lineNo, qtyReceived: grQty[i], uom: pl.uom })),
    });
    if (caseNo % 3 === 0) {
      deliveryNotes.push({
        id: `DN-4${String(100 + caseNo)}`, poId, vendorId: v.id, deliveredOn: grDate,
        lines: poLines.map((pl) => ({ itemCode: pl.itemCode, qty: pl.qty, uom: pl.uom })),
      });
    }
  }

  // status
  const inv: Invoice = {
    id: "", vendorId: v.id, poId, invoiceDate, receivedOn, currency: "INR", lines: invLines,
    subtotal: totals.subtotal, tax: totals.tax, total: totals.total, status: "received",
  };
  switch (spec.scn) {
    case "clean_paid": inv.status = "paid"; inv.verdict = "approve"; inv.resolvedOn = day(receivedOn, between(12, 16)); break;
    case "clean_approved": inv.status = "approved"; inv.verdict = "approve"; inv.resolvedOn = day(receivedOn, between(2, 4)); break;
    case "clean_pending": inv.status = "pending_approval"; inv.verdict = "approve"; break;
    case "uom": inv.status = "approved"; inv.verdict = "approve"; inv.resolvedOn = day(receivedOn, 2); break;
    case "missing_receipt": case "duplicate": inv.status = "blocked"; inv.verdict = "block"; break;
    default:
      inv.verdict = "flag";
      if (spec.resolved) { inv.status = "approved"; inv.resolvedOn = day(receivedOn, between(3, 6)); } else inv.status = "pending_owner";
  }
  void buyer;
  return { inv, po, fin };
}

for (const spec of SPECS) {
  if (spec.scn === "duplicate") continue; // built after the originals exist
  const b = build(spec);
  purchaseOrders.push(b.po);
  drafts.push({ spec, build: { inv: b.inv, po: b.po }, fin: b.fin });
}

// duplicate: a second copy of an earlier paid invoice from the same vendor, re-dated
{
  const spec = SPECS.find((s) => s.scn === "duplicate")!;
  const original = drafts.find((d) => d.spec.scn === "clean_paid" && d.spec.vendorId === spec.vendorId)!;
  const receivedOn = ago(spec.daysAgo);
  const dup: Invoice = {
    ...structuredClone(original.build.inv), id: "", invoiceDate: day(receivedOn, -1), receivedOn,
    status: "blocked", verdict: "block", resolvedOn: undefined,
  };
  delete dup.resolvedOn;
  drafts.push({
    spec, build: { inv: dup, po: original.build.po },
    fin: [{
      kind: "duplicate", verdict: "block", message: "Same vendor, PO, lines and amount as an invoice that is already paid.",
      rootCause: "Possible duplicate of a paid invoice", owner: "AP Clerk",
      smallestFix: "Confirm with the supplier. Release the block only if this is a new supply.",
    }],
  });
}

// The fixed duplicate-demo anchor: INV-6120 (Deccan Valve & Fittings), paid. INV-6120R is uploaded live.
const d6120 = DEMO_INVOICES.find((d) => d.invoiceNo === "INV-6120R")!;
{
  const poLines = demo.purchaseOrders.find((p) => p.id === d6120.poId)!.lines;
  const lines: InvoiceLine[] = d6120.lines.map((l, i) => ({
    lineNo: i + 1, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, taxRatePct: 18, amount: r2(l.qty * l.unitPrice),
  }));
  assert.equal(lines.length, poLines.length);
  const t = computeTotals(lines, 18);
  assertTotals("INV-6120", lines, 18, t);
  drafts.push({
    spec: S("clean_paid", "V-1004", 28),
    build: {
      po: demo.purchaseOrders.find((p) => p.id === d6120.poId)!,
      inv: {
        id: "INV-6120", vendorId: "V-1004", poId: d6120.poId, invoiceDate: "2026-10-14", receivedOn: "2026-10-15", currency: "INR",
        lines, subtotal: t.subtotal, tax: t.tax, total: t.total, status: "paid", verdict: "approve", resolvedOn: "2026-10-29",
      },
    },
    fin: [],
  });
}

// Number the history in date order, skipping 6120 (reserved).
drafts.sort((a, b) => (a.build.inv.receivedOn < b.build.inv.receivedOn ? -1 : a.build.inv.receivedOn > b.build.inv.receivedOn ? 1 : 0));
let seq = 6100;
for (const d of drafts) {
  if (d.build.inv.id === "INV-6120") continue;
  seq++;
  if (seq === 6120) seq++;
  d.build.inv.id = `INV-${seq}`;
}
for (const d of drafts) {
  invoices.push(d.build.inv);
  const orig = drafts.find((o) => o.spec.scn === "clean_paid" && o.spec.vendorId === d.spec.vendorId && o !== d && d.spec.scn === "duplicate");
  d.fin.forEach((f, i) => {
    let message = f.message;
    if (f.kind === "duplicate" && orig) message = `Possible duplicate of paid ${orig.build.inv.id}. Same vendor, PO, lines and amount.`;
    findings.push({ ...f, message, id: `F-${d.build.inv.id}-${i + 1}`, invoiceId: d.build.inv.id });
  });
}

// ---------------------------------------------------------------- sanity: demo invoices tie out
const golden = DEMO_INVOICES[0];
const gt = computeTotals(golden.lines, golden.taxRatePct);
assert.deepEqual(gt, { subtotal: 900000, tax: 162000, total: 1062000 }, "INV-7781 must total exactly Rs 10,62,000");
for (const d of DEMO_INVOICES) {
  const t = computeTotals(d.lines, d.taxRatePct);
  assertTotals(d.invoiceNo, d.lines.map((l) => ({ ...l, amount: r2(l.qty * l.unitPrice) })), d.taxRatePct, t);
}
const konkan = computeTotals(DEMO_INVOICES[1].lines, 18);
assert.ok(konkan.total <= 100000, "INV-7782 must stay under Rs 1,00,000");

// referential integrity
const poIds = new Set(purchaseOrders.map((p) => p.id));
assert.equal(poIds.size, purchaseOrders.length, "duplicate PO ids");
assert.equal(new Set(invoices.map((i) => i.id)).size, invoices.length, "duplicate invoice ids");
for (const g of goodsReceipts) assert.ok(poIds.has(g.poId), `GR ${g.id} -> unknown PO`);
for (const i of invoices) assert.ok(i.poId && poIds.has(i.poId), `invoice ${i.id} -> unknown PO`);
for (const d of DEMO_INVOICES) assert.ok(poIds.has(d.poId), `${d.invoiceNo} -> unknown PO`);
for (const p of purchaseOrders) assert.ok(vendorById(p.vendorId), "unknown vendor");

// required coverage for T5 charts
const stale = findings.filter((f) => f.rootCause === "PO not updated after contract change");
assert.ok(stale.length >= 7, "need >= 7 'PO not updated' cases");
assert.ok(new Set(stale.map((f) => invoices.find((i) => i.id === f.invoiceId)!.vendorId)).size >= 4, "need several suppliers");
const ageOf = (id: string) => (Date.parse(DEMO_TODAY) - Date.parse(invoices.find((i) => i.id === id)!.receivedOn)) / 86400000;
const bucket = (a: number) => (a <= 2 ? "0-2" : a <= 7 ? "3-7" : a <= 14 ? "8-14" : "15+");
const buckets = new Set(stale.map((f) => bucket(ageOf(f.invoiceId))));
assert.equal(buckets.size, 4, "stale cases must span all four age buckets");
assert.ok(invoices.some((i) => i.id === "INV-6120" && i.status === "paid" && i.vendorId === "V-1004"), "INV-6120 paid for Deccan");
assert.ok(invoices.length >= 38 && invoices.length <= 46, `expected ~40 invoices, got ${invoices.length}`);
for (const i of invoices) assert.ok(ageOf(i.id) >= 0 && ageOf(i.id) <= 60, `${i.id} outside the 60 day window`);
for (const st of ["approved", "paid", "pending_owner", "blocked"] as const) assert.ok(invoices.some((i) => i.status === st), `no ${st} invoices`);

// ---------------------------------------------------------------- write
const byId = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
const out: Record<string, unknown> = {
  vendors: VENDORS.map(({ id, name, gstin, active }) => ({ id, name, gstin, active })),
  purchaseOrders: byId(purchaseOrders),
  goodsReceipts: byId(goodsReceipts),
  contracts: byId(contracts),
  deliveryNotes: byId(deliveryNotes),
  uomRules: UOM_RULES,
  invoices: byId(invoices),
  findings: byId(findings),
  tasks: [],
  auditEvents: [],
};
const dir = path.join(process.cwd(), "data", "seed");
fs.mkdirSync(dir, { recursive: true });
for (const [k, v] of Object.entries(out)) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v, null, 2) + "\n");
void GIRNAR_CONTRACT_FRT;
console.log(`Seed written to data/seed: ${invoices.length} invoices, ${findings.length} findings, ${purchaseOrders.length} POs, ${goodsReceipts.length} goods receipts.`);
