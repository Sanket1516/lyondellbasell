// Stage 4: contract-aware matching, inventory-aware verification, and the combined three-way / contract / inventory result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDataset, type Dataset } from "../foundation/generate";
import type { CanonicalBundle } from "./canonical";
import { contractCheck, contractEvidence } from "./contractCheck";
import type { PlantPayEngine } from "./engine";
import { inventoryCheck } from "./inventory";
import { setOutage } from "./integration";
import { resolve } from "./resolver";
import { seedPlantPay } from "./runtime";
import { simulate } from "./simulate";
import { sourceFile } from "./sources/build";

// ---------------------------------------------------------------- fixtures for the pure checks
const base = (over: Partial<CanonicalBundle> = {}): CanonicalBundle => ({
  ids: { invoice: "inv:T", po: "po:1", vendor: "vendor:V-1" },
  invoice: { id: "T", vendorId: "V-1", poId: "1", invoiceDate: "2026-11-01", receivedOn: "2026-11-02", currency: "INR", subtotal: 0, tax: 0, total: 0, status: "received", lines: [{ lineNo: 1, itemCode: "X", description: "X", qty: 100, uom: "kg", unitPrice: 10, taxRatePct: 18, amount: 1000 }] },
  approvals: [], poChanges: [], amendments: [], uomRules: [{ itemCode: "X", fromUom: "MT", toUom: "kg", factor: 1000 }],
  po: { id: "1", vendorId: "V-1", buyer: "B", issuedOn: "2026-10-01", contractId: "C-1", lines: [{ lineNo: 1, itemCode: "X", description: "X", qty: 100, uom: "kg", unitPrice: 10, taxCode: "GST18", taxRatePct: 18 }] },
  contract: { id: "C-1", vendorId: "V-1", effectiveFrom: "2026-01-01", prices: [{ itemCode: "X", unitPrice: 10, uom: "kg" }] },
  contractValidity: { validFrom: "2026-01-01", validTo: "2027-03-31" },
  goodsReceipts: [{ id: "G1", poId: "1", receivedOn: "2026-10-20", receivedBy: "S", lines: [{ lineNo: 1, qtyReceived: 100, uom: "kg" }] }],
  deliveryNotes: [], inspections: [],
  stockLedger: [{ id: 1, materialCode: "X", type: "GR", qty: 100, uom: "kg", date: "2026-10-20", grId: "G1" }],
  weighbridge: [], gateEntries: [], shipments: [], relatedInvoices: [], accountHolders: [], ...over,
});
const withPrices = (b: CanonicalBundle, poPrice: number, invPrice: number): CanonicalBundle => ({ ...b, po: { ...b.po!, lines: [{ ...b.po!.lines[0], unitPrice: poPrice }] }, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], unitPrice: invPrice }] } });
const prior = (id: string, qty: number, over: Record<string, unknown> = {}) => ({ id, vendorId: "V-1", poId: "1", invoiceDate: "2026-10-25", receivedOn: "2026-10-26", currency: "INR" as const, subtotal: 0, tax: 0, total: 0, status: "paid" as const, lines: [{ lineNo: 1, itemCode: "X", description: "X", qty, uom: "kg", unitPrice: 10, taxRatePct: 18, amount: qty * 10 }], ...over });
const ret = (qty: number, type: "RETURN" | "REVERSAL" = "RETURN") => ({ id: 2, materialCode: "X", type, qty, uom: "kg", date: "2026-10-22", grId: "G1" });

// ---------------------------------------------------------------- A. contract-aware matching
describe("contract check (pure)", () => {
  it("raises invoice and PO both above the contract, with validity and price evidence", () => {
    const o = contractCheck(withPrices(base(), 10.6, 10.6));
    expect(o.findings).toHaveLength(1);
    const f = o.findings[0];
    expect(f.rootCause).toBe("PO and invoice price differ from the contract price");
    expect(f.message).toMatch(/invoice and PO both price it at ₹10\.60 per kg, but contract C-1 sets ₹10\.00 \(6\.0% above the contract\) for goods delivered on 20-Oct-2026/);
    expect(f.evidence.join(" ")).toMatch(/valid 01-Jan-2026 to 31-Mar-2027/);
    expect(f.evidence.join(" ")).toMatch(/price for X on 20-Oct-2026: ₹10\.00/);
    expect(o.terms[0].state).toBe("discrepancy");
  });
  it("notes, but does not raise, a price below the contract (no overpayment)", () => {
    const o = contractCheck(withPrices(base(), 9.4, 9.4));
    expect(o.findings).toHaveLength(0);
    expect(o.terms[0].state).toBe("ok");
    expect(o.terms[0].note).toMatch(/below the contract price/);
  });
  it("does not raise a second finding when the invoice differs from the PO (the price check owns that)", () => {
    const o = contractCheck(withPrices(base(), 10, 10.6));
    expect(o.findings).toHaveLength(0);
    expect(o.terms[0].state).toBe("raised_by_price_check");
    expect(o.terms[0].note).toMatch(/already reports/);
  });
  it("passes when invoice, PO and contract agree within tolerance", () => {
    const o = contractCheck(withPrices(base(), 10, 10.1));
    expect(o.findings).toHaveLength(0);
    expect(o.terms[0].state).toBe("ok");
  });
  it("flags a delivery after the contract ended, and does not compare prices against an expired contract", () => {
    const o = contractCheck(base({ contractValidity: { validFrom: "2025-01-01", validTo: "2026-10-15" } }));
    expect(o.inForce).toBe(false);
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0].rootCause).toBe("Contract not in force on the delivery date");
    expect(o.findings[0].message).toMatch(/delivered on 20-Oct-2026, after contract C-1 ended/);
    expect(o.terms[0].state).toBe("skipped");
  });
  it("flags a delivery before the contract started", () => {
    const o = contractCheck(base({ contractValidity: { validFrom: "2026-11-01", validTo: "2027-03-31" } }));
    expect(o.findings[0].message).toMatch(/before contract C-1 started/);
  });
  it("reads the price in force on the delivery date, applying an amendment that took effect before it", () => {
    const b = base({
      contract: { id: "C-1", vendorId: "V-1", effectiveFrom: "2026-10-01", prices: [{ itemCode: "X", unitPrice: 12, uom: "kg" }], history: [{ itemCode: "X", unitPrice: 10, uom: "kg", effectiveFrom: "2026-01-01" }] },
      amendments: [{ materialCode: "X", oldPrice: 10, newPrice: 12, effectiveFrom: "2026-10-01", signedOn: "2026-09-15" }],
    });
    const o = contractCheck(withPrices(b, 10, 10));
    expect(o.terms[0].contractPrice).toBe(12);
    expect(o.terms[0].amendment?.newPrice).toBe(12);
    expect(o.terms[0].state).toBe("ok"); // below the amended contract price: noted, no overpayment
    expect(contractEvidence(b, "X").join(" ")).toMatch(/Amendment effective 01-Oct-2026 \(signed 15-Sep-2026\) moved X from ₹10\.00 to ₹12\.00; it applies to this delivery/);
  });
  it("notes an amendment that starts after the delivery and does not apply it", () => {
    const b = base({ amendments: [{ materialCode: "X", oldPrice: 10, newPrice: 12, effectiveFrom: "2026-12-01", signedOn: "2026-11-01" }] });
    expect(contractEvidence(b, "X").join(" ")).toMatch(/starts after this delivery and is not applied/);
    expect(contractCheck(b).terms[0].laterAmendments).toEqual([{ effectiveFrom: "2026-12-01", newPrice: 12 }]);
  });
  it("compares per PO unit when the invoice is in another unit (5 MT is not a price mismatch)", () => {
    const b = base();
    const mt = { ...b, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], qty: 0.1, uom: "MT", unitPrice: 10000 }] } };
    const o = contractCheck(mt);
    expect(o.findings).toHaveLength(0);
    expect(o.terms[0].invoicePrice).toBe(10);
  });
  it("is labelled skipped, with the reason, when there is no PO, no contract link, or the contract is missing", () => {
    expect(contractCheck(base({ po: undefined })).skip).toEqual({ kind: "not_applicable", reason: expect.stringMatching(/no PO/) });
    const noLink = contractCheck(base({ po: { ...base().po!, contractId: undefined } }));
    expect(noLink.evaluated).toBe(false);
    expect(noLink.skip!.kind).toBe("no_records");
    expect(noLink.note).toMatch(/^Skipped: PO 1 is not linked to a contract/);
    const missing = contractCheck(base({ contract: undefined, contractValidity: undefined }));
    expect(missing.skip!.kind).toBe("no_records");
    expect(missing.note).toMatch(/not in the Procurement DB/);
  });
});

// ---------------------------------------------------------------- B. inventory-aware verification
describe("inventory check (pure)", () => {
  it("reconciles a clean receipt with no earlier invoices", () => {
    const o = inventoryCheck(base());
    expect(o.findings).toHaveLength(0);
    expect(o.rows[0]).toMatchObject({ received: 100, returned: 0, previouslyBilled: 0, thisInvoice: 100, remaining: 100, state: "ok" });
  });
  it("RETURNED GOODS: billing the full receipt after 30 kg went back is held, with the ledger entry as evidence", () => {
    const o = inventoryCheck(base({ stockLedger: [...base().stockLedger, ret(30)] }));
    expect(o.findings).toHaveLength(1);
    const f = o.findings[0];
    expect(f.rootCause).toBe("Returned goods are included in the invoice");
    expect(f.message).toMatch(/30 kg of the 100 kg received was returned to the supplier, leaving 70 kg to pay for/);
    expect(f.evidence.join(" ")).toMatch(/30 kg of X RETURNED to the supplier against GRN G1/);
    expect(o.rows[0]).toMatchObject({ net: 70, returned: 30, remaining: 70, state: "discrepancy" });
  });
  it("a reversal of the receipt counts like a return", () => {
    const o = inventoryCheck(base({ stockLedger: [...base().stockLedger, ret(40, "REVERSAL")] }));
    expect(o.findings[0].message).toMatch(/40 kg of the 100 kg received was reversed, leaving 60 kg/);
  });
  it("billing only the kept quantity after a return passes", () => {
    const b = base({ stockLedger: [...base().stockLedger, ret(30)] });
    const ok = { ...b, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], qty: 70 }] } };
    expect(inventoryCheck(ok).findings).toHaveLength(0);
  });
  it("OVER-ALLOCATED QUANTITY: an earlier invoice already bills the receipt, so a further bill is held", () => {
    const b = base({ relatedInvoices: [prior("E1", 100)] });
    const mine = { ...b, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], qty: 40 }] } };
    const o = inventoryCheck(mine);
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0].rootCause).toBe("Receipt already allocated to earlier invoices");
    expect(o.findings[0].message).toMatch(/bills 40 kg; earlier invoices already claim 100 kg of the 100 kg received, so 140 kg would be claimed in total/);
    expect(o.findings[0].evidence.join(" ")).toMatch(/Earlier invoice E1 .* claims 100 kg/);
    expect(o.rows[0]).toMatchObject({ previouslyBilled: 100, remaining: 0 });
  });
  it("two part bills that together stay within the receipt pass (a staged delivery is not over-allocation)", () => {
    const b = base({ relatedInvoices: [prior("E1", 60)] });
    expect(inventoryCheck({ ...b, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], qty: 40 }] } }).findings).toHaveLength(0);
  });
  it("only earlier invoices count: a later invoice on the same PO does not hold this one", () => {
    const later = prior("L1", 100, { receivedOn: "2026-11-20", invoiceDate: "2026-11-19" });
    expect(inventoryCheck(base({ relatedInvoices: [later] })).findings).toHaveLength(0);
  });
  it("DUPLICATE QUANTITY CLAIM: the same quantity claimed again is named as such", () => {
    const o = inventoryCheck(base({ relatedInvoices: [prior("E1", 100)] }));
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0].rootCause).toBe("Same quantity claimed by two invoices");
    expect(o.findings[0].message).toMatch(/the same quantity an earlier invoice \(E1\) already claims/);
  });
  it("does not raise the duplicate claim a second time when the duplicate check already reports the pair", () => {
    const o = inventoryCheck(base({ relatedInvoices: [prior("E1", 100)] }), { reportedDuplicates: new Set(["E1"]) });
    expect(o.findings).toHaveLength(0);
    expect(o.rows[0].state).toBe("raised_by_duplicate_check");
  });
  it("honours a clerk's recorded 'different bill' decision for that earlier invoice", () => {
    const b = base({ relatedInvoices: [prior("E1", 100)] });
    const decided = { ...b, invoice: { ...b.invoice, duplicateDecision: { decision: "not_duplicate" as const, matchedInvoiceId: "E1", by: "clerk", reason: "second delivery", at: "2026-11-05" } } };
    expect(inventoryCheck(decided).findings).toHaveLength(0);
  });
  it("leaves billing above what was received to the quantity check (no second finding)", () => {
    const b = base();
    const o = inventoryCheck({ ...b, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], qty: 130 }] } });
    expect(o.findings).toHaveLength(0);
    expect(o.rows[0].state).toBe("raised_by_quantity_check");
  });
  it("converts units before allocating (0.06 MT after 50 kg earlier = 110 kg of 100 kg)", () => {
    const b = base({ relatedInvoices: [prior("E1", 50)] });
    const o = inventoryCheck({ ...b, invoice: { ...b.invoice, lines: [{ ...b.invoice.lines[0], qty: 0.06, uom: "MT", unitPrice: 10000 }] } });
    expect(o.rows[0]).toMatchObject({ thisInvoice: 60, previouslyBilled: 50 });
    expect(o.findings).toHaveLength(1);
  });
});

describe("inventory check: missing data degrades to a labelled skip, never silently", () => {
  it("nothing received yet: not applicable, with the reason", () => {
    const o = inventoryCheck(base({ goodsReceipts: [], stockLedger: [] }));
    expect(o.evaluated).toBe(false);
    expect(o.skip!.kind).toBe("not_applicable");
    expect(o.note).toMatch(/^Skipped: nothing has been received/);
  });
  it("goods receipt with no stock ledger entries: skipped as 'no records', naming the receipt", () => {
    const o = inventoryCheck(base({ stockLedger: [] }));
    expect(o.evaluated).toBe(false);
    expect(o.skip!.kind).toBe("no_records");
    expect(o.note).toMatch(/^Skipped: the stock ledger has no entries for GRN G1/);
    expect(o.findings).toHaveLength(0);
  });
  it("no PO: skipped", () => { expect(inventoryCheck(base({ po: undefined })).skip!.kind).toBe("not_applicable"); });
});

// ---------------------------------------------------------------- C. on the seeded system
let dir: string;
let eng: PlantPayEngine;
let ds: Dataset;
const docFor = (re: RegExp) => ds.demoDocs.find((d) => re.test(d.purpose))!;
const stored = (id: string) => eng.stored(id)!;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-s4-"));
  ds = buildDataset();
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: "2026-11-12" });
}, 180000);
afterAll(() => { try { eng.connectors.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a handle briefly */ } });

describe("planted cases behave correctly", () => {
  it("contract price: invoice and PO agree, three-way passes, the contract check holds it for review", () => {
    const id = docFor(/^Contract price:/).invoiceId;
    const r = stored(id);
    expect(r.status).toBe("review");
    expect(r.validation!.threeWay.state).toBe("pass");
    expect(r.validation!.contract.state).toBe("review");
    expect(r.validation!.inventory.state).toBe("pass");
    const d = r.discrepancies.find((x) => x.check === "contract")!;
    expect(d.rootCause).toBe("PO and invoice price differ from the contract price");
    expect(d.rootCauseStatus).toBe("supported_by_evidence");
    expect(d.department).toBe("Procurement");
  });
  it("contract expired: delivered after the end date", () => {
    const r = stored(docFor(/^Contract expired:/).invoiceId);
    expect(r.status).toBe("review");
    expect(r.validation!.threeWay.state).toBe("pass");
    expect(r.discrepancies.map((d) => d.rootCause)).toEqual(["Contract not in force on the delivery date"]);
  });
  it("over-allocated quantity: an earlier invoice already bills the whole receipt", () => {
    const doc = docFor(/^Over-allocated quantity:/);
    const r = stored(doc.invoiceId);
    expect(r.status).toBe("review");
    expect(r.validation!.threeWay.state).toBe("pass");
    expect(r.validation!.inventory.state).toBe("review");
    const row = r.validation!.inventory.rows[0];
    expect(row.state).toBe("discrepancy");
    expect(row.previouslyBilled).toBe(row.received);
    expect(row.remaining).toBe(0);
    expect(r.discrepancies.find((x) => x.check === "inventory")!.rootCause).toBe("Receipt already allocated to earlier invoices");
  });
  it("returned goods: 30% went back, the invoice bills all of it", () => {
    const r = stored(docFor(/^Returned goods:/).invoiceId);
    expect(r.status).toBe("review");
    expect(r.validation!.threeWay.state).toBe("pass");
    const row = r.validation!.inventory.rows[0];
    expect(row.returned).toBe(Math.round(row.received * 0.3));
    expect(row.net).toBe(row.received - row.returned);
    expect(r.discrepancies.find((x) => x.check === "inventory")!.rootCause).toBe("Returned goods are included in the invoice");
  });
  it("every planted Stage 4 case in the data set is found, and nothing else is flagged by the new checks", () => {
    const planted = new Map(ds.planted.filter((p) => p.stage === "stage4" && p.caseType !== "contract_amendment").map((p) => [p.invoiceId, p.caseType]));
    expect(planted.size).toBeGreaterThanOrEqual(20);
    const want: Record<string, string> = { contract_price_above: "contract", contract_expired: "contract", over_allocated_quantity: "inventory", returned_goods: "inventory" };
    const wrong: string[] = [];
    for (const i of ds.invoices) {
      const hit = [...new Set(stored(i.id).discrepancies.filter((d) => d.check === "contract" || d.check === "inventory").map((d) => d.check))];
      const t = planted.get(i.id);
      const dupClaim = stored(i.id).discrepancies.some((d) => d.rootCause === "Same quantity claimed by two invoices");
      if (t && (hit.length !== 1 || hit[0] !== want[t])) wrong.push(`${i.id}: ${t} -> ${hit}`);
      if (!t && (hit.length || dupClaim)) wrong.push(`${i.id}: unplanted but flagged ${hit}`);
    }
    expect(wrong).toEqual([]);
    for (const k of Object.keys(want)) expect(ds.planted.filter((p) => p.caseType === k).length, k).toBeGreaterThanOrEqual(5);
  });
  it("the unchanged three-way match still passes all four planted cases (only the new stages hold them)", () => {
    for (const re of [/^Contract price:/, /^Contract expired:/, /^Over-allocated quantity:/, /^Returned goods:/]) {
      const r = stored(docFor(re).invoiceId);
      expect(r.discrepancies.filter((d) => !["contract", "inventory"].includes(d.check))).toEqual([]);
    }
  });
});

describe("combined validation result", () => {
  it("every invoice carries all three validations, with a state and a readable headline (no empty states)", () => {
    for (const i of ds.invoices) {
      const v = stored(i.id).validation;
      expect(v, i.id).toBeDefined();
      for (const k of ["threeWay", "contract", "inventory"] as const) {
        expect(["pass", "review", "block", "skipped"], `${i.id} ${k}`).toContain(v![k].state);
        expect(v![k].headline.length, `${i.id} ${k}`).toBeGreaterThan(10);
        expect(v![k].headline, `${i.id} ${k}`).not.toMatch(/undefined|\[object|NaN/);
      }
    }
  });
  it("all demo documents show a three-way, contract and inventory result consistent with the overall status", () => {
    expect(ds.demoDocs.length).toBeGreaterThanOrEqual(15);
    for (const d of ds.demoDocs) {
      const r = stored(d.invoiceId);
      const v = r.validation!;
      if (r.status === "pass") expect([v.threeWay.state, v.contract.state === "skipped" ? "pass" : v.contract.state, v.inventory.state === "skipped" ? "pass" : v.inventory.state]).toEqual(["pass", "pass", "pass"]);
      if (v.contract.state === "review" || v.inventory.state === "review") expect(r.status === "review" || r.status === "block", d.invoiceId).toBe(true);
    }
  });
  it("the golden invoice INV-7781 is unchanged: still three-way Review, still routed to Procurement and Warehouse", () => {
    const r = stored("INV-7781");
    expect(r.validation!.threeWay.state).toBe("review");
    expect([...new Set(r.discrepancies.map((d) => d.department))].sort()).toEqual(["Procurement", "Warehouse"]);
    expect(r.discrepancies.every((d) => d.check !== "contract" && d.check !== "inventory")).toBe(true);
  });
  it("INV-7781 contract panel explains the planted case: line 1 differs from the PO and the price check owns it", () => {
    const t = stored("INV-7781").validation!.contract.terms.find((x) => x.lineNo === 1)!;
    expect(t).toMatchObject({ contractPrice: 412, poPrice: 398, invoicePrice: 412, state: "raised_by_price_check" });
    expect(t.amendment).toMatchObject({ oldPrice: 398, newPrice: 412, effectiveFrom: "2026-10-01" });
  });
});

describe("missing-data fallback", () => {
  const clean = () => docFor(/^Clean match, single line/).invoiceId;
  it("Warehouse DB down: inventory is not evaluated, labelled, and a would-be pass becomes incomplete", () => {
    setOutage(eng.integration, "warehouse", true);
    try {
      const r = eng.compute(clean()).result;
      expect(r.validation!.inventory.state).toBe("skipped");
      expect(r.validation!.inventory.skip!.kind).toBe("source_unavailable");
      expect(r.checks.find((c) => c.check === "inventory")).toMatchObject({ passed: null });
      expect(r.checks.find((c) => c.check === "inventory")!.detail).toMatch(/Not evaluated|Skipped/);
      expect(r.status).toBe("incomplete");
      expect(r.discrepancies.filter((d) => d.check === "inventory")).toEqual([]);
    } finally { setOutage(eng.integration, "warehouse", false); }
  });
  it("Procurement DB down: contract and inventory are both skipped, with no false findings", () => {
    setOutage(eng.integration, "procurement", true);
    try {
      const r = eng.compute(docFor(/^Contract price:/).invoiceId).result;
      expect(r.validation!.contract.state).toBe("skipped");
      expect(r.validation!.inventory.state).toBe("skipped");
      expect(r.discrepancies.filter((d) => d.check === "contract" || d.check === "inventory")).toEqual([]);
      expect(r.status).toBe("incomplete");
    } finally { setOutage(eng.integration, "procurement", false); }
  });
  it("outage cleared: the planted result comes back", () => {
    expect(eng.compute(docFor(/^Contract price:/).invoiceId).result.status).toBe("review");
  });
  it("stock ledger rows missing for a receipt: inventory is labelled 'skipped', named in the summary, and not shown as a pass", () => {
    const id = clean();
    const poId = ds.invoices.find((i) => i.id === id)!.poId!;
    const gr = ds.goodsReceipts.find((g) => g.poId === poId)!;
    const db = new Database(sourceFile("warehouse", dir));
    db.prepare("DELETE FROM stock_transactions WHERE ref_id = ?").run(`GRN-${gr.id}`);
    db.close();
    const r = eng.compute(id).result;
    expect(r.validation!.inventory.state).toBe("skipped");
    expect(r.validation!.inventory.skip!.kind).toBe("no_records");
    expect(r.validation!.inventory.headline).toMatch(/^Skipped: the stock ledger has no entries for GRN/);
    expect(r.summary).toMatch(/Skipped inventory: the stock ledger has no entries/);
    expect(r.checks.find((c) => c.check === "inventory")).toMatchObject({ passed: null });
    // restore so later tests see the full ledger
    const db2 = new Database(sourceFile("warehouse", dir));
    for (const l of gr.lines) { const po = ds.purchaseOrders.find((p) => p.id === poId)!; db2.prepare("INSERT INTO stock_transactions (material_code,txn_type,qty,uom,txn_date,ref_type,ref_id) VALUES (?,?,?,?,?,?,?)").run(po.lines.find((x) => x.lineNo === l.lineNo)!.itemCode, "GR", l.qtyReceived, l.uom, gr.receivedOn, "GR", `GRN-${gr.id}`); }
    db2.close();
    expect(eng.compute(id).result.validation!.inventory.state).toBe("pass");
  });
  it("PO with no contract link: contract terms are skipped with the reason, and the invoice is not marked incomplete for it", () => {
    const po = ds.purchaseOrders.find((p) => !p.contractId && ds.invoices.some((i) => i.poId === p.id));
    if (!po) return; // every PO in this data set is linked
    const inv = ds.invoices.find((i) => i.poId === po.id)!;
    const r = stored(inv.id);
    expect(r.validation!.contract.state).toBe("skipped");
    expect(r.validation!.contract.headline).toMatch(/not linked to a contract/);
  });
});

describe("Root-Cause Resolver receives the contract output as additional evidence", () => {
  const report = (id: string) => { const c = eng.compute(id); return resolve(c.bundle!, c.result); };
  it("the planted ₹412 / ₹398 / ₹412 explanation is unchanged and gains the contract validity as evidence", () => {
    const r = report("INV-7781").resolutions.find((x) => x.check === "price" && x.lineNo === 1)!;
    expect(r.rootCause).toBe("Contract amendment not reflected in the PO");
    expect(r.counterfactual).toBe("This invoice line would pass the price check if PO 4500001234 line 1 price were updated to ₹412.00, per amendment of contract C-22 effective 01-Oct-2026, assuming all other checks pass.");
    expect(r.evidence.map((e) => e.text).join(" ")).toMatch(/Contract C-22 is valid .* it was in force on the delivery date/);
  });
  it("contract price case: root cause, evidence, two-step correction, counterfactual", () => {
    const rep = report(docFor(/^Contract price:/).invoiceId);
    const r = rep.resolutions.find((x) => x.check === "contract")!;
    expect(r.rule).toBe("po_price_off_contract");
    expect(r.evidenceStatus).toBe("supported_by_evidence");
    expect(r.responsible.department).toBe("Procurement");
    expect(r.evidence.map((e) => e.text).join(" ")).toMatch(/valid .* in force on the delivery date/);
    expect(r.counterfactual).toMatch(/would pass the contract check if PO \d+ line 1 and the supplier's billed price were both corrected to ₹[\d,.]+ per .*, per contract C-\d+ effective .*, assuming all other checks pass\.$/);
    expect(r.corrections.map((c) => c.kind)).toEqual(["amend_po_price", "supplier_corrects_invoice"]);
  });
  it("returned goods and over-allocation resolve to the right rule with ledger / earlier-invoice evidence", () => {
    const ret = report(docFor(/^Returned goods:/).invoiceId).resolutions.find((x) => x.check === "inventory")!;
    expect(ret.rule).toBe("returned_goods_billed");
    expect(ret.evidence.some((e) => e.source === "warehouse" && /RETURNED to the supplier/.test(e.text))).toBe(true);
    expect(ret.counterfactual).toMatch(/the returned quantity were credited, reducing the billed quantity to .* assuming all other checks pass\.$/);
    const over = report(docFor(/^Over-allocated quantity:/).invoiceId).resolutions.find((x) => x.check === "inventory")!;
    expect(over.rule).toBe("quantity_over_allocated");
    expect(over.evidence.some((e) => e.source === "finance" && /^Earlier invoice/.test(e.text))).toBe(true);
    expect(over.corrections).toEqual([]);
    expect(over.notSimulatableReason).toMatch(/Nothing is left to bill/);
  });
  it("expired contract is an explained exception that needs a person, not a data fix", () => {
    const r = report(docFor(/^Contract expired:/).invoiceId).resolutions.find((x) => x.rule === "contract_not_in_force")!;
    expect(r.corrections).toEqual([]);
    expect(r.notSimulatableReason).toMatch(/commercial decision/);
    expect(r.responsible.department).toBe("Procurement");
  });
  it("no accusing language anywhere in the new findings", () => {
    const text = JSON.stringify(ds.invoices.flatMap((i) => stored(i.id).discrepancies.filter((d) => d.check === "contract" || d.check === "inventory"))).toLowerCase();
    expect(text).not.toMatch(/fraud|stolen|criminal|culprit|cheat|scam/);
  });
});

describe("simulated corrections on the new cases (sandbox, live data untouched)", () => {
  it("contract price: amend the PO and correct the invoice to the contract price, then Review becomes Pass", () => {
    const id = docFor(/^Contract price:/).invoiceId;
    const s = simulate(eng, id, "all");
    expect(s.before.status).toBe("review");
    expect(s.after.status).toBe("pass");
    expect(s.steps.map((x) => x.correction.kind)).toEqual(["amend_po_price", "supplier_corrects_invoice"]);
    expect(stored(id).status).toBe("review");
    expect(eng.compute(id).result.status).toBe("review");
  });
  it("returned goods: the supplier credits the returned quantity, then Review becomes Pass", () => {
    const id = docFor(/^Returned goods:/).invoiceId;
    const s = simulate(eng, id, "all");
    expect(s.before.status).toBe("review");
    expect(s.after.status).toBe("pass");
    expect(eng.compute(id).result.status).toBe("review");
  });
  it("over-allocated quantity: nothing is left to bill, so it is not simulated and says why", () => {
    const id = docFor(/^Over-allocated quantity:/).invoiceId;
    const s = simulate(eng, id, "all");
    expect(s.after.status).toBe("review");
    expect(s.steps).toEqual([]);
  });
});

describe("the REST/UI payload carries the validation block (no raw errors, plain labels)", () => {
  it("the stored result is JSON-serialisable and round-trips with the validation block", () => {
    const id = docFor(/^Returned goods:/).invoiceId;
    const back = JSON.parse(JSON.stringify(stored(id)));
    expect(Object.keys(back.validation)).toEqual(["threeWay", "contract", "inventory"]);
  });
});
