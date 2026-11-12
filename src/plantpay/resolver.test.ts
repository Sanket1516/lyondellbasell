import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDataset, type Dataset } from "../foundation/generate";
import type { CanonicalBundle } from "./canonical";
import type { PlantPayEngine, PlantPayResult, PpDiscrepancy } from "./engine";
import { resolve, ruleOf } from "./resolver";
import { seedPlantPay } from "./runtime";
import { simulate } from "./simulate";
import { Connectors } from "./connectors";
import { PlantPayEngine as Engine } from "./engine";
import { openIntegrationDb } from "./integration";

let dir: string;
let eng: PlantPayEngine;
let ds: Dataset;
const TODAY = "2026-11-12";
const docFor = (re: RegExp) => ds.demoDocs.find((d) => re.test(d.purpose))!;
const report = (id: string) => { const c = eng.compute(id); return resolve(c.bundle!, c.result); };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-res-"));
  ds = buildDataset();
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: TODAY });
}, 180000);
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

describe("the planted ₹412 / ₹398 / ₹412 case (INV-7781 line 1)", () => {
  const r1 = () => report("INV-7781").resolutions.find((r) => r.check === "price" && r.lineNo === 1)!;
  it("identifies the root cause as a contract amendment not reflected in the PO, supported by evidence", () => {
    const r = r1();
    expect(r.rule).toBe("amendment_not_in_po");
    expect(r.rootCause).toBe("Contract amendment not reflected in the PO");
    expect(r.evidenceStatus).toBe("supported_by_evidence");
  });
  it("states the problem with the three prices", () => {
    expect(r1().problem).toBe("Line 1 (AX-40, Process additive AX-40): invoice price ₹412.00 per kg is 3.5% above the PO price ₹398.00.");
  });
  it("lists the evidence from the sources: amendment, PO line and history, receipts, invoice", () => {
    const text = r1().evidence.map((e) => `${e.source}: ${e.text}`).join("\n");
    expect(text).toContain("procurement: Contract C-22 amendment effective 01-Oct-2026: AX-40 price changed from ₹398.00 to ₹412.00 (signed 17-Sep-2026)");
    expect(text).toContain("PO 4500001234 line 1 (issued 18-Sep-2026): AX-40, 1,000 kg at ₹398.00");
    expect(text).toMatch(/No price change is recorded on PO 4500001234 line 1 since it was issued, so it still pre-dates the amendment of 01-Oct-2026/);
    expect(text).toMatch(/warehouse: Goods were received from 02-Nov-2026, on or after the amendment date 01-Oct-2026/);
    expect(text).toMatch(/finance: Invoice INV-7781 line 1: AX-40, 1,000 kg at ₹412.00, equal to the amended contract price/);
    expect(new Set(r1().evidence.map((e) => e.source))).toEqual(new Set(["procurement", "warehouse", "finance"]));
  });
  it("names the responsible department and role, and the recommended correction", () => {
    const r = r1();
    expect(r.responsible).toMatchObject({ department: "Procurement", role: "Buyer" });
    expect(r.responsible.person).toBeTruthy();
    expect(r.correction).toBe("Buyer amends PO 4500001234 line 1 unit price from ₹398.00 to ₹412.00.");
  });
  it("produces the exact counterfactual sentence", () => {
    expect(r1().counterfactual).toBe("This invoice line would pass the price check if PO 4500001234 line 1 price were updated to ₹412.00, per amendment of contract C-22 effective 01-Oct-2026, assuming all other checks pass.");
  });
  it("treats 5 MT vs 5000 kg (line 2) as normalisation, not a mismatch", () => {
    const rep = report("INV-7781");
    expect(rep.resolutions.some((r) => r.lineNo === 2)).toBe(false);
    const n = rep.normalisations.find((x) => x.lineNo === 2)!;
    expect(n.text).toMatch(/billed as 5 MT/);
    expect(n.text).toMatch(/That is 5,000 kg at ₹86.00 per kg/);
    expect(n.text).toMatch(/normalised, not treated as a mismatch/);
    expect(n.evidence[0].text).toBe("Unit table: 1 MT = 1,000 kg for C-12");
  });
  it("also explains line 3: under-posted receipt, with the delivery note as evidence", () => {
    const r = report("INV-7781").resolutions.find((x) => x.lineNo === 3 && x.check === "quantity")!;
    expect(r.rule).toBe("goods_receipt_under_posted");
    expect(r.responsible.department).toBe("Warehouse");
    expect(r.evidence.map((e) => e.text).join(" ")).toMatch(/Delivery note DN-5521/);
    expect(r.counterfactual).toMatch(/increased by 8 nos to 40 nos, per the delivery note \(40 nos delivered\), assuming all other checks pass\./);
  });
});

describe("each root-cause rule on the demo documents", () => {
  it("goods not yet delivered (in transit per Logistics): billed before delivery, supplier follow-up", () => {
    const r = report("INV-7784").resolutions[0];
    expect(r.rule).toBe("billed_before_delivery");
    expect(r.evidenceStatus).toBe("supported_by_evidence");
    expect(r.evidence.some((e) => e.source === "logistics" && /in transit/.test(e.text))).toBe(true);
    expect(r.counterfactual).toMatch(/would pass the quantity check if the goods were delivered and a goods receipt of 150 nos on PO line 1 and 40 nos on PO line 2 were posted against PO 4500001242, assuming all other checks pass\./);
    expect(r.corrections[0]).toMatchObject({ kind: "post_goods_receipt" });
  });
  it("tax rate mismatch (INV-7785): supplier reissues at the PO rate", () => {
    const r = report("INV-7785").resolutions.find((x) => x.rule === "tax_rate_mismatch")!;
    expect(r.counterfactual).toMatch(/would pass the tax check if the tax rate on the invoice were 18% \(tax code GST18 on PO 4500001244\), assuming all other checks pass\./);
    expect(r.responsible.department).toBe("Finance");
  });
  it("off-contract price (INV-7786): matches neither PO nor contract", () => {
    const r = report("INV-7786").resolutions.find((x) => x.rule === "off_contract_price")!;
    expect(r.rootCause).toMatch(/matches neither the PO nor the contract/);
    expect(r.counterfactual).toMatch(/supplier's billed price were corrected to ₹18,200.00 per trips, per contract C-33/);
    expect(r.evidenceStatus).toBe("supported_by_evidence");
  });
  it("re-issued duplicate (INV-6120R): prompt to compare, not an accusation", () => {
    const r = report("INV-6120R").resolutions.find((x) => x.rule === "duplicate_invoice")!;
    expect(r.counterfactual).toMatch(/not a finding of wrongdoing/);
    expect(r.evidence.some((e) => /Earlier invoice INV-6120/.test(e.text))).toBe(true);
  });
  it("quality rejection: counterfactual uses the accepted quantity and cites the inspection", () => {
    const r = report(docFor(/^Quality:/).invoiceId).resolutions[0];
    expect(r.rule).toBe("rejected_goods_billed");
    expect(r.responsible.department).toBe("Quality");
    expect(r.counterfactual).toMatch(/billed quantity were reduced to \d+ rolls \(the \d+ rolls accepted at inspection\), per inspection QI-/);
  });
  it("weighbridge mismatch: both ways out are stated", () => {
    const r = report(docFor(/^Logistics:/).invoiceId).resolutions[0];
    expect(r.rule).toBe("weighbridge_mismatch");
    expect(r.responsible.department).toBe("Logistics");
    expect(r.counterfactual).toMatch(/after a re-weigh/);
    expect(r.counterfactual).toMatch(/If the weighbridge figure is right/);
  });
  it("stale PO on a bulk invoice resolves the same way as the golden case", () => {
    const p = ds.planted.find((x) => x.caseType === "stale_po_price" && !x.invoiceId.startsWith("INV-"))!;
    const r = report(p.invoiceId).resolutions.find((x) => x.rule === "amendment_not_in_po")!;
    expect(r.evidenceStatus).toBe("supported_by_evidence");
    expect(r.counterfactual).toMatch(/^This invoice line would pass the price check if PO \d+ line 1 price were updated to ₹[\d,.]+, per amendment of contract C-1\d\d effective \d\d-\w{3}-2026, assuming all other checks pass\.$/);
  });
  it("unconvertible unit: cannot be simulated because the factor is unknown", () => {
    const p = ds.planted.find((x) => x.caseType === "unit_mismatch_unconvertible")!;
    const r = report(p.invoiceId).resolutions.find((x) => x.rule === "unit_not_convertible")!;
    expect(r.notSimulatableReason).toMatch(/conversion factor/);
    expect(r.corrections).toEqual([]);
    expect(simulate(eng, p.invoiceId, { resolutionId: r.id }).notSimulatable).toMatch(/conversion factor/);
  });
  it("bank-detail change: requires independent verification, supplier master data owns it", () => {
    const r = report(docFor(/Bank-detail change/).invoiceId).resolutions.find((x) => x.rule === "bank_details_changed")!;
    expect(r.responsible.department).toBe("Supplier master data");
    expect(r.correction).toMatch(/calling a contact already on file/);
    expect(r.counterfactual).toMatch(/verified independently by call-back/);
  });
  it("threshold splitting and shared account: human review, not simulated, never accusing", () => {
    const s = report(ds.demoDocs.find((d) => /Threshold splitting, part 1/.test(d.purpose))!.invoiceId).resolutions.find((x) => x.rule === "threshold_splitting")!;
    expect(s.notSimulatableReason).toMatch(/human review/);
    expect(s.rootCause).toMatch(/can be a normal staged delivery/);
    const sh = report(docFor(/unrelated vendor/).invoiceId).resolutions.find((x) => x.rule === "shared_bank_account")!;
    expect(sh.rootCause).toMatch(/can be legitimate/);
  });
});

describe("rules on synthetic bundles", () => {
  const bundle = (over: Partial<CanonicalBundle> = {}): CanonicalBundle => ({
    ids: { invoice: "inv:T", po: "po:1", vendor: "vendor:V-1" },
    invoice: { id: "T", vendorId: "V-1", poId: "1", invoiceDate: "2026-11-01", receivedOn: "2026-11-02", currency: "INR", subtotal: 0, tax: 0, total: 0, status: "received", lines: [{ lineNo: 1, itemCode: "Y-9", description: "Hex bolt set M16", qty: 10, uom: "sets", unitPrice: 100, taxRatePct: 18, amount: 1000 }] },
    approvals: [], poChanges: [], amendments: [], uomRules: [],
    po: { id: "1", vendorId: "V-1", buyer: "Anand", issuedOn: "2026-10-01", lines: [{ lineNo: 1, itemCode: "X-1", description: "Hex bolt set M16", qty: 10, uom: "sets", unitPrice: 100, taxCode: "GST18", taxRatePct: 18 }] },
    goodsReceipts: [], deliveryNotes: [], inspections: [], stockLedger: [], weighbridge: [], gateEntries: [], shipments: [], relatedInvoices: [], accountHolders: [], ...over,
  });
  const res = (ds_: Partial<PpDiscrepancy>[]): PlantPayResult => ({
    invoiceId: "T", status: "review", summary: "", evaluatedAt: "", checks: [], warnings: [], sources: [], unavailable: [], notEvaluated: [], routing: [], prediction: { available: false, reason: "" }, tolerances: { pricePct: 2, qtyPct: 5, weighbridgePct: 1 },
    discrepancies: ds_.map((d) => ({ check: "purchase_order", severity: "flag", message: "m", rootCause: "Item not on the PO", rootCauseStatus: "unverified_prediction", evidence: [], suggestedFix: "Fix", owner: "Buyer", department: "Procurement", sources: ["procurement"], ...d }) as PpDiscrepancy),
  });
  it("wrong material mapping: identical description is supported by evidence", () => {
    const r = resolve(bundle(), res([{ lineNo: 1 }])).resolutions[0];
    expect(r.rule).toBe("wrong_material_mapping");
    expect(r.evidenceStatus).toBe("supported_by_evidence");
    expect(r.counterfactual).toBe("This invoice line would pass the purchase-order check if its item code Y-9 were mapped to X-1, per PO 1 line 1, assuming all other checks pass.");
    expect(r.corrections[0]).toMatchObject({ kind: "supplier_corrects_invoice", set: { materialCode: "X-1" } });
  });
  it("wrong material mapping: a merely similar description is an unverified prediction", () => {
    const b = bundle(); b.invoice.lines[0].description = "Hex bolt set M16 high tensile zinc";
    const r = resolve(b, res([{ lineNo: 1 }])).resolutions[0];
    expect(r.rule).toBe("wrong_material_mapping");
    expect(r.evidenceStatus).toBe("unverified_prediction");
    expect(r.evidence.map((e) => e.text).join(" ")).toMatch(/a guess, not a record/);
    expect(r.counterfactual).toMatch(/to be confirmed by the Buyer/);
  });
  it("an unrelated item is simply 'not on the PO'", () => {
    const b = bundle(); b.invoice.lines[0].description = "Ocean freight surcharge";
    const r = resolve(b, res([{ lineNo: 1 }])).resolutions[0];
    expect(r.rule).toBe("item_not_on_po");
    expect(r.notSimulatableReason).toMatch(/Buyer decision/);
  });
  it("price with no contract on file is labelled an unverified prediction", () => {
    const b = bundle(); b.invoice.lines[0].itemCode = "X-1"; b.invoice.lines[0].unitPrice = 120;
    const r = resolve(b, res([{ check: "price", lineNo: 1, rootCause: "Price differs from PO, no contract price on file", deltaPct: 20 }])).resolutions[0];
    expect(r.rule).toBe("price_no_contract");
    expect(r.evidenceStatus).toBe("unverified_prediction");
    expect(r.counterfactual).toMatch(/unverified prediction because no contract record supports it/);
  });
  it("receipt not posted with an arrival record is 'goods arrived, receipt not posted' (Warehouse)", () => {
    const b = bundle(); b.invoice.lines[0].itemCode = "X-1";
    b.gateEntries = [{ id: "GE-1", poId: "1", vehicleNo: "MH43AB1234", enteredOn: "2026-10-20" }];
    const r = resolve(b, res([{ check: "quantity", lineNo: 1, rootCause: "Goods receipt not posted" }])).resolutions[0];
    expect(r.rule).toBe("goods_receipt_not_posted");
    expect(r.evidenceStatus).toBe("supported_by_evidence");
    expect(r.responsible.department).toBe("Warehouse");
  });
  it("receipt not posted with no arrival record at all is an unverified prediction", () => {
    const b = bundle(); b.invoice.lines[0].itemCode = "X-1";
    const r = resolve(b, res([{ check: "quantity", lineNo: 1, rootCause: "Goods receipt not posted" }])).resolutions[0];
    expect(r.evidenceStatus).toBe("unverified_prediction");
    expect(r.rootCause).toMatch(/no arrival record found/);
  });
  it("billed for undelivered quantity: supplier reduces to the received quantity (unit converted)", () => {
    const b = bundle(); b.invoice.lines[0] = { ...b.invoice.lines[0], itemCode: "X-1", qty: 10 };
    b.goodsReceipts = [{ id: "G1", poId: "1", receivedOn: "2026-10-20", receivedBy: "S", lines: [{ lineNo: 1, qtyReceived: 6, uom: "sets" }] }];
    const r = resolve(b, res([{ check: "quantity", lineNo: 1, rootCause: "Billed for undelivered quantity" }])).resolutions[0];
    expect(r.rule).toBe("billed_undelivered_quantity");
    expect(r.counterfactual).toMatch(/reduced to 6 sets \(6 sets, the quantity received\)/);
  });
  it("ruleOf maps every engine classification, with a safe fallback", () => {
    const m = (check: string, rootCause: string) => ruleOf({ check, rootCause });
    expect(m("price", "PO not updated after contract change")).toBe("amendment_not_in_po");
    expect(m("price", "Price differs from both PO and contract")).toBe("off_contract_price");
    expect(m("quantity", "Billed before delivery or receipt")).toBe("billed_before_delivery");
    expect(m("quality", "Inspection not completed")).toBe("inspection_pending");
    expect(m("arithmetic", "x")).toBe("arithmetic_error");
    expect(m("vendor", "Supplier inactive")).toBe("unclassified");
  });
});

describe("every exception on every invoice is explained", () => {
  it("each resolution has a problem, label, owner, correction and a counterfactual that says what is assumed", () => {
    const failing = ds.invoices.filter((i) => ["review", "block"].includes(eng.stored(i.id)!.status));
    expect(failing.length).toBeGreaterThan(80);
    let n = 0;
    for (const i of failing) {
      const rep = report(i.id);
      expect(rep.resolutions.length, i.id).toBeGreaterThan(0);
      for (const r of rep.resolutions) {
        n++;
        expect(r.problem.length, `${i.id} ${r.id}`).toBeGreaterThan(10);
        expect(["supported_by_evidence", "unverified_prediction"]).toContain(r.evidenceStatus);
        if (r.evidenceStatus === "supported_by_evidence") expect(r.evidence.length, `${i.id} ${r.id}`).toBeGreaterThan(0);
        expect(r.responsible.department).toBeTruthy();
        expect(r.responsible.role).toBeTruthy();
        expect(r.correction.length).toBeGreaterThan(10);
        expect(r.counterfactual, `${i.id} ${r.id}`).toMatch(/would (pass|clear)/);
        expect(r.counterfactual, `${i.id} ${r.id}`).toMatch(/assuming all other checks pass\./);
        expect(r.counterfactual + r.rootCause + r.problem).not.toMatch(/fraud|stolen|criminal|culprit|undefined|\[object/i);
      }
    }
    expect(n).toBeGreaterThan(100);
  });
  it("a passing invoice has no exceptions; a unit-converted pass lists normalisation only", () => {
    const rep = report("INV-7782");
    expect(rep.resolutions).toEqual([]);
    const u = report(docFor(/Unit mismatch/).invoiceId);
    expect(u.resolutions).toEqual([]);
    expect(u.normalisations.length).toBe(1);
    expect(u.normalisations[0].text).toMatch(/5 MT/);
  });
});

describe("re-running matching after a simulated human correction", () => {
  it("INV-7781: fixing the price alone clears the price exception, status stays Review (other issues remain)", () => {
    const id = report("INV-7781").resolutions.find((r) => r.rule === "amendment_not_in_po")!.id;
    const s = simulate(eng, "INV-7781", { resolutionId: id });
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].description).toBe("Procurement amends PO 4500001234 line 1 price from ₹398.00 to ₹412.00");
    expect(s.clearedResolutionIds).toContain(id);
    expect(s.before.status).toBe("review");
    expect(s.after.status).toBe("review");
    expect(s.statusChanged).toBe(false);
    expect(s.after.issues.join(" ")).not.toMatch(/Price ₹412/);
    expect(s.after.issues.join(" ")).toMatch(/Invoice quantity 40 nos/);
    expect(s.headline).toMatch(/Status stays Review: 1 exception cleared, 1 issue remains/);
  });
  it("INV-7781: applying every recommended correction in turn takes it from Review to Pass", () => {
    const s = simulate(eng, "INV-7781", "all");
    expect(s.before.status).toBe("review");
    expect(s.after.status).toBe("pass");
    expect(s.statusChanged).toBe(true);
    expect(s.steps.map((x) => x.correction.kind)).toEqual(["amend_po_price", "post_goods_receipt", "record_inspection"]);
    expect(s.headline).toBe("Status changes from Review to Pass.");
  });
  it("the simulation never touches the live data", () => {
    expect(eng.compute("INV-7781").result.status).toBe("review");
    expect(eng.stored("INV-7781")!.status).toBe("review");
    const po = new Database(path.join(dir, "procurement.db"), { readonly: true }).prepare("SELECT unit_price FROM po_lines WHERE po_number = '4500001234' AND line_no = 1").get() as { unit_price: number };
    expect(po.unit_price).toBe(398);
    const grn = new Database(path.join(dir, "warehouse.db"), { readonly: true }).prepare("SELECT COUNT(*) n FROM goods_receipts WHERE po_ref = 'PO-4500001234'").get() as { n: number };
    expect(grn.n).toBe(2);
  });
  it("INV-7784 (billed before delivery): goods arrive and are accepted, status Block to Pass", () => {
    const s = simulate(eng, "INV-7784", "all");
    expect(s.before.status).toBe("block");
    expect(s.after.status).toBe("pass");
    expect(s.steps.map((x) => x.correction.kind)).toEqual(["post_goods_receipt", "record_inspection"]);
  });
  it("INV-7785 (tax), INV-7786 (off-contract), INV-6120R (duplicate), quality, weighbridge and bank-change documents all reach Pass", () => {
    for (const id of ["INV-7785", "INV-7786", "INV-6120R", docFor(/^Quality:/).invoiceId, docFor(/^Logistics:/).invoiceId, docFor(/Bank-detail change/).invoiceId, docFor(/Price about 7%/).invoiceId, docFor(/Quantity billed above/).invoiceId]) {
      const s = simulate(eng, id, "all");
      expect(s.before.status, id).not.toBe("pass");
      expect(s.after.status, `${id}: ${s.after.issues.join(" | ")}`).toBe("pass");
    }
  });
  it("splitting documents cannot be simulated away: a person decides, status stays Review", () => {
    const id = ds.demoDocs.find((d) => /Threshold splitting, part 1/.test(d.purpose))!.invoiceId;
    const s = simulate(eng, id, "all");
    expect(s.steps).toEqual([]);
    expect(s.after.status).toBe("review");
  });
  it("an exception that has gone away is reported plainly", () => {
    expect(simulate(eng, "INV-7782", { resolutionId: "price:1:amendment_not_in_po" }).notSimulatable).toMatch(/no longer present/);
  });
  it("the duplicate decision needs a reason and is recorded in the sandbox only", () => {
    const s = simulate(eng, "INV-6120R", "all");
    expect(s.steps[0].description).toMatch(/AP clerk records that this is a different bill from INV-6120 \(reason: /);
    expect((eng.integration.prepare("SELECT COUNT(*) n FROM duplicate_decisions").get() as { n: number }).n).toBe(0);
  });
  it("works when the live integration database is a WAL-mode file (as in the running app)", () => {
    const file = path.join(dir, "live-integration.db");
    const integ = openIntegrationDb(file);
    expect((integ.pragma("journal_mode", { simple: true }) as string).toLowerCase()).toBe("wal");
    const live = new Engine(integ, new Connectors(integ, dir), { today: TODAY });
    const s = simulate(live, "INV-7785", "all");
    expect(s.before.status).toBe("review");
    expect(s.after.status).toBe("pass");
    live.connectors.close();
    integ.close();
  });
});
