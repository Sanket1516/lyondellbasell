// Stage 5: the four risk detectors. Pure cases (planted patterns and legitimate look-alikes), then the whole seeded dataset.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDataset, type Dataset } from "../../foundation/generate";
import type { Invoice, PurchaseOrder } from "../../lib/types";
import type { CanonicalBundle, CanonicalVendor } from "../canonical";
import type { PlantPayEngine } from "../engine";
import { tasksFor } from "../integration";
import { seedPlantPay } from "../runtime";
import { setOutage } from "../integration";
import { defaultRiskConfig } from "./config";
import { detectDuplicate, invoiceNumberSimilarity } from "./duplicate";
import { RelationshipGraph, type GraphInput } from "./graph";
import { assessRisk, toWarnings } from "./index";
import { detectSplitting } from "./splitting";
import { detectVendorFlags } from "./vendorFlags";

const cfg = defaultRiskConfig();
const line = (qty: number, code = "X", price = 100, desc = "Process additive") => ({ lineNo: 1, itemCode: code, description: desc, qty, uom: "kg", unitPrice: price, taxRatePct: 18, amount: qty * price });
const inv = (id: string, total: number, over: Partial<Invoice> = {}): Invoice => ({ id, vendorId: "V-1", poId: "100", invoiceDate: "2026-11-01", receivedOn: "2026-11-02", currency: "INR", subtotal: total / 1.18, tax: total - total / 1.18, total, status: "received", lines: [line(Math.round(total / 118))], ...over });
const po = (qty: number): PurchaseOrder => ({ id: "100", vendorId: "V-1", buyer: "B", issuedOn: "2026-10-01", lines: [{ lineNo: 1, itemCode: "X", description: "Process additive", qty, uom: "kg", unitPrice: 100, taxCode: "GST18", taxRatePct: 18 }] });

// ---------------------------------------------------------------- 1. duplicate fingerprint
describe("invoice number similarity", () => {
  it("treats INV-1001 and INV-1001A as the same number, but sequential numbers as different", () => {
    expect(invoiceNumberSimilarity("INV-1001", "INV-1001A")).toBeGreaterThanOrEqual(0.95);
    expect(invoiceNumberSimilarity("INV-1001", "INV-1001/R")).toBeGreaterThanOrEqual(0.95);
    expect(invoiceNumberSimilarity("INV-1001", "INV1001")).toBeGreaterThanOrEqual(0.95);
    expect(invoiceNumberSimilarity("INV-1001", "INV-1001")).toBe(1);
    expect(invoiceNumberSimilarity("INV-1001", "INV-1002")).toBe(0);
  });
});
describe("duplicate fingerprint", () => {
  const original = inv("INV-1001", 118000, { receivedOn: "2026-10-01", invoiceDate: "2026-10-01" });
  it("flags a re-issued copy with a changed number and date, with a score, reasons and the matching record", () => {
    const copy = inv("INV-1001A", 118000, { invoiceDate: "2026-10-04", receivedOn: "2026-10-05" });
    const o = detectDuplicate(copy, [original], cfg, po(1000));
    expect(o.flag).toBe(true);
    const s = o.signals[0];
    expect(s.score).toBeGreaterThanOrEqual(cfg.duplicateFlagScore);
    expect(s.reasons.join(" ")).toMatch(/same total/);
    expect(s.reasons.join(" ")).toMatch(/re-issue marker/);
    expect(s.supportingRecords[0].ref).toBe("invoice INV-1001");
    expect(s.recommendedAction).toMatch(/Compare/);
    expect(s.label).toBe("warning, not proof");
  });
  it("flags a copy with a completely different number when PO, amount and lines all agree", () => {
    const copy = inv("ZZ-9", 118000, { invoiceDate: "2026-10-20", receivedOn: "2026-10-21" });
    expect(detectDuplicate(copy, [original], cfg, po(1000)).flag).toBe(true);
  });
  it("does NOT flag staged billing: two equal halves on one PO that the PO quantity covers", () => {
    const half1 = inv("A-1", 59000, { receivedOn: "2026-10-01" });
    const half2 = inv("A-2", 59000, { invoiceDate: "2026-10-12", receivedOn: "2026-10-13" });
    const o = detectDuplicate(half2, [half1], cfg, po(1000)); // PO holds 1000, each bill is 500
    expect(o.flag).toBe(false);
    // the same two bills against a PO that only covers one of them look like a duplicate
    expect(detectDuplicate(half2, [half1], cfg, po(500)).flag).toBe(true);
  });
  it("does NOT flag a regular repeat order: same supplier, same amount and items, different PO and unrelated number", () => {
    const march = inv("INV-5001", 118000, { poId: "90", invoiceDate: "2026-09-01", receivedOn: "2026-09-02" });
    const apr = inv("INV-5107", 118000, { poId: "91", invoiceDate: "2026-10-01", receivedOn: "2026-10-02" });
    expect(detectDuplicate(apr, [march], cfg).flag).toBe(false);
  });
  it("does NOT flag sequential invoice numbers with different amounts", () => {
    expect(detectDuplicate(inv("INV-1002", 41300, { receivedOn: "2026-10-05" }), [original], cfg).flag).toBe(false);
  });
  it("only flags the later document of a pair", () => {
    const copy = inv("INV-1001A", 118000, { invoiceDate: "2026-10-04", receivedOn: "2026-10-05" });
    expect(detectDuplicate(original, [copy], cfg, po(1000)).flag).toBe(false);
  });
});

// ---------------------------------------------------------------- 2. threshold splitting
describe("threshold splitting", () => {
  const mk = (id: string, total: number, date: string, over: Partial<Invoice> = {}) => inv(id, total, { invoiceDate: date, receivedOn: date, lines: [line(Math.round(total / 118), "X", 100, "Process additive")], ...over });
  const a = mk("INV-3001", 95000, "2026-11-02", { lines: [line(805, "X")] });
  const b = mk("INV-3002", 96000, "2026-11-02", { lines: [line(813, "X")] });
  const c = mk("INV-3003", 98000, "2026-11-03", { lines: [line(830, "X")] });
  it("flags INV-3001/3002/3003 (₹95k, ₹96k, ₹98k) and shows the combined total", () => {
    for (const x of [a, b, c]) {
      const o = detectSplitting(x, [a, b, c].filter((y) => y !== x), cfg);
      expect(o.flag, x.id).toBe(true);
      expect(o.signals[0].reasons.join(" ")).toMatch(/2,89,000/); // combined ₹2,89,000
      expect(o.signals[0].supportingRecords).toHaveLength(3);
      expect(o.signals[0].label).toBe("warning, not proof");
    }
  });
  it("is configurable: against a ₹3 lakh threshold the same three invoices are not near it", () => {
    expect(detectSplitting(a, [b, c], { ...cfg, approvalThreshold: 300000 }).flag).toBe(false);
  });
  it("does NOT flag a staged delivery of comfortable sizes (three ₹40,000 bills on one PO)", () => {
    const s = [mk("S-1", 40000, "2026-11-02"), mk("S-2", 40000, "2026-11-02"), mk("S-3", 40000, "2026-11-03")];
    expect(detectSplitting(s[0], s.slice(1), cfg).flag).toBe(false);
  });
  it("does NOT flag near-threshold invoices from different suppliers", () => {
    expect(detectSplitting(a, [{ ...b, vendorId: "V-2" }, { ...c, vendorId: "V-3" }], cfg).flag).toBe(false);
  });
  it("does NOT flag near-threshold invoices a month apart", () => {
    expect(detectSplitting(a, [mk("L-1", 96000, "2026-10-01", { lines: [line(813)] })], cfg).flag).toBe(false);
  });
  it("does NOT flag one large invoice", () => {
    expect(detectSplitting(mk("BIG", 289000, "2026-11-02"), [], cfg).flag).toBe(false);
  });
  it("does NOT flag two similar bills on different POs (regular repeat orders); three such bills are a prompt", () => {
    const d1 = mk("D-1", 92000, "2026-11-02", { poId: "201" }), d2 = mk("D-2", 88000, "2026-11-04", { poId: "202" }), d3 = mk("D-3", 90000, "2026-11-05", { poId: "203" });
    expect(detectSplitting(d1, [d2], cfg).flag).toBe(false);
    expect(detectSplitting(d1, [d2, d3], cfg).flag).toBe(true);
  });
  it("leaves a re-issued copy to the duplicate detector, not splitting", () => {
    expect(detectSplitting(a, [{ ...a, id: "INV-3001A", invoiceDate: "2026-11-03", receivedOn: "2026-11-04" }], cfg).flag).toBe(false);
  });
});

// ---------------------------------------------------------------- 3. vendor master red flags
const vendor = (over: Partial<CanonicalVendor> = {}): CanonicalVendor => ({
  id: "V-1", name: "Test Chem Ltd", gstin: "27FICTA1234B1Z0", active: true, paymentTermsDays: 45, stateCode: "27", onboardedOn: "2025-04-01",
  addresses: [{ kind: "registered", line: "Plot 1", city: "Thane", pincode: "400604" }], contacts: [],
  bankAccounts: [{ id: "B1", bankName: "Fict Bank", accountNo: "111111", ifsc: "FICB0000001", status: "verified", validFrom: "2025-04-01", verifiedOn: "2025-04-05" }], ...over,
});
const bundle = (v: CanonicalVendor, over: Partial<CanonicalBundle> = {}): CanonicalBundle => ({
  ids: { invoice: "inv:T", vendor: "vendor:V-1" }, invoice: inv("T", 50000, { invoiceDate: "2026-11-01" }), remit: { accountNo: "111111", ifsc: "FICB0000001" }, approvals: [], vendor: v,
  poChanges: [], amendments: [], uomRules: [], goodsReceipts: [], deliveryNotes: [], inspections: [], stockLedger: [], weighbridge: [], gateEntries: [], shipments: [], relatedInvoices: [], accountHolders: [], ...over,
});
describe("vendor master red flags", () => {
  it("is quiet when bank, address and tax ID are all consistent", () => {
    const o = detectVendorFlags(bundle(vendor()), cfg);
    expect(o.flag).toBe(false);
    expect(o.signals).toHaveLength(0);
  });
  it("flags a bank change not yet verified and requires independent verification by call-back", () => {
    const v = vendor({ bankAccounts: [
      { id: "B1", bankName: "Fict Bank", accountNo: "111111", ifsc: "FICB0000001", status: "closed", validFrom: "2025-04-01", validTo: "2026-10-28" },
      { id: "B2", bankName: "Other Bank", accountNo: "222222", ifsc: "FICB0000002", status: "pending_verification", validFrom: "2026-10-28", note: "Change requested by e-mail" },
    ] });
    const o = detectVendorFlags(bundle(v, { remit: { accountNo: "222222", ifsc: "FICB0000002" } }), cfg);
    const s = o.signals.find((x) => x.kind === "bank_change")!;
    expect(s.flag).toBe(true);
    expect(s.requiresIndependentVerification).toBe(true);
    expect(s.recommendedAction).toMatch(/contact already on file/);
    expect(s.recommendedAction).toMatch(/not the number or e-mail on the invoice/);
    expect(s.label).toBe("warning, not proof");
    const w = toWarnings(assessRisk(bundle(v, { remit: { accountNo: "222222", ifsc: "FICB0000002" } }))).find((x) => x.kind === "bank_change")!;
    expect(w.severity).toBe("review");
    expect(w.taskTitle).toMatch(/Verify the bank-detail change independently/);
  });
  it("flags an account that is not on the supplier master at all", () => {
    expect(detectVendorFlags(bundle(vendor(), { remit: { accountNo: "999999", ifsc: "X" } }), cfg).signals.some((x) => x.kind === "bank_change" && x.flag)).toBe(true);
  });
  it("does NOT flag a recent bank change that was verified by call-back (noted only)", () => {
    const v = vendor({ bankAccounts: [
      { id: "B1", bankName: "Fict Bank", accountNo: "111111", ifsc: "FICB0000001", status: "closed", validFrom: "2025-04-01", validTo: "2026-10-10" },
      { id: "B2", bankName: "Other Bank", accountNo: "222222", ifsc: "FICB0000002", status: "verified", validFrom: "2026-10-11", verifiedOn: "2026-10-13" },
    ] });
    const o = detectVendorFlags(bundle(v, { remit: { accountNo: "222222", ifsc: "FICB0000002" } }), cfg);
    expect(o.flag).toBe(false);
    expect(o.signals[0]).toMatchObject({ kind: "bank_change_verified", flag: false });
  });
  it("flags a recent bank change with no recorded verification even if the status says verified", () => {
    const v = vendor({ bankAccounts: [
      { id: "B1", bankName: "Fict Bank", accountNo: "111111", ifsc: "FICB0000001", status: "closed", validFrom: "2025-04-01", validTo: "2026-10-10" },
      { id: "B2", bankName: "Other Bank", accountNo: "222222", ifsc: "FICB0000002", status: "verified", validFrom: "2026-10-11" },
    ] });
    expect(detectVendorFlags(bundle(v, { remit: { accountNo: "222222", ifsc: "FICB0000002" } }), cfg).flag).toBe(true);
  });
  it("flags a shared account across vendors, but not a confirmed group account", () => {
    const o = detectVendorFlags(bundle(vendor({ bankAccounts: [{ id: "B1", bankName: "Fict Bank", accountNo: "111111", ifsc: "F", status: "verified", validFrom: "2026-09-20", verifiedOn: "2026-09-21" }] }), { accountHolders: [{ vendorId: "V-2", name: "XYZ Traders", status: "verified" }] }), cfg);
    const s = o.signals.find((x) => x.kind === "shared_bank_account")!;
    expect(s.flag).toBe(true);
    expect(s.reasons.join(" ")).toMatch(/can be legitimate/);
    const legit = detectVendorFlags(bundle(vendor(), { accountHolders: [{ vendorId: "V-2", name: "Group Trading Co", status: "verified", note: "Group account shared with Test Chem. Confirmed legitimate at onboarding." }] }), cfg);
    expect(legit.flag).toBe(false);
    expect(legit.signals[0]).toMatchObject({ kind: "shared_bank_account", flag: false });
  });
  it("flags a recent address change, but not one from a year ago", () => {
    const moved = (from: string) => vendor({ addresses: [
      { kind: "registered", line: "Plot 1", city: "Thane", pincode: "400604", validTo: "2026-10-01" },
      { kind: "registered", line: "Unit 9", city: "Pune", pincode: "411019", validFrom: from },
    ] });
    expect(detectVendorFlags(bundle(moved("2026-10-02")), cfg).signals.some((x) => x.kind === "address_change" && x.flag)).toBe(true);
    expect(detectVendorFlags(bundle(moved("2025-06-01")), cfg).flag).toBe(false);
  });
  it("flags a GSTIN on the invoice that differs from the master", () => {
    const o = detectVendorFlags(bundle(vendor(), { invoiceGstin: "27FICTA9999B1Z0" }), cfg);
    const s = o.signals.find((x) => x.kind === "tax_id_conflict")!;
    expect(s.flag).toBe(true);
    expect(s.reasons[0]).toMatch(/27FICTA9999B1Z0/);
    expect(detectVendorFlags(bundle(vendor(), { invoiceGstin: "27FICTA1234B1Z0" }), cfg).flag).toBe(false);
  });
});

// ---------------------------------------------------------------- 4. relationship graph
const gInput = (over: Partial<GraphInput> = {}): GraphInput => ({
  vendors: [{ id: "V-1", name: "ABC Chemicals", gstin: "27FICTA0001A1Z0" }, { id: "V-2", name: "XYZ Traders", gstin: "27FICTB0002B1Z0" }, { id: "V-3", name: "Quiet Supplies", gstin: "27FICTC0003C1Z0" }, { id: "V-4", name: "Parent Co", gstin: "27FICTD0004D1Z0" }, { id: "V-5", name: "Parent Trading Arm", gstin: "27FICTE0005E1Z0" }],
  banks: [
    { vendorId: "V-1", accountNo: "5010", bankName: "Fict Bank", status: "verified" }, { vendorId: "V-2", accountNo: "5010", bankName: "Fict Bank", status: "verified" },
    { vendorId: "V-3", accountNo: "7777", bankName: "Fict Bank", status: "verified" },
    { vendorId: "V-4", accountNo: "9000", bankName: "Fict Bank", status: "verified" }, { vendorId: "V-5", accountNo: "9000", bankName: "Fict Bank", status: "verified", note: "Group account. Confirmed legitimate at onboarding." },
  ],
  addresses: [{ vendorId: "V-1", line: "Plot 1", city: "Thane", pincode: "400604", closed: false }, { vendorId: "V-2", line: "Plot 2", city: "Pune", pincode: "411019", closed: false }, { vendorId: "V-3", line: "Plot 3", city: "Nashik", pincode: "422010", closed: false }],
  invoices: [{ id: "I-1", vendorId: "V-1", poId: "100", total: 50000, date: "2026-11-01", approvals: [{ approverId: "E-9", level: "clerk", on: "2026-11-02" }] }],
  approvers: [{ id: "E-9", name: "Clerk One", limitInr: 100000 }], ...over,
});
describe("relationship graph", () => {
  it("links ABC Chemicals and XYZ Traders through a shared bank account and groups them in one cluster", () => {
    const g = new RelationshipGraph(gInput());
    const f = g.findings.find((x) => x.kind === "shared_bank_account" && x.vendorIds.includes("V-1"))!;
    expect(f.vendorIds.sort()).toEqual(["V-1", "V-2"]);
    expect(f.confirmedLegitimate).toBe(false);
    expect(g.neighbors("bank:5010").sort()).toEqual(["vendor:V-1", "vendor:V-2"]);
    expect(g.clusterOf("V-1")!.vendorIds).toEqual(["V-1", "V-2"]);
    const o = g.detectForInvoice({ id: "I-1", vendorId: "V-1" });
    expect(o.flag).toBe(true);
    expect(o.signals[0].reasons.join(" ")).toMatch(/ABC Chemicals \(V-1\) and XYZ Traders \(V-2\) share bank account 5010/);
    expect(o.signals[0].label).toBe("warning, not proof");
    expect(o.signals[0].severity).toBe("info");
  });
  it("does NOT flag a confirmed group account, and does not flag a vendor with no links", () => {
    const g = new RelationshipGraph(gInput());
    expect(g.detectForInvoice({ id: "x", vendorId: "V-4" }).flag).toBe(false);
    expect(g.clusterOf("V-4")!.allConfirmedLegitimate).toBe(true);
    const q = g.detectForInvoice({ id: "x", vendorId: "V-3" });
    expect(q.flag).toBe(false);
    expect(q.signals).toHaveLength(0);
  });
  it("surfaces repeated addresses", () => {
    const g = new RelationshipGraph(gInput({ addresses: [{ vendorId: "V-1", line: "Plot 1", city: "Thane", pincode: "400604", closed: false }, { vendorId: "V-3", line: "PLOT 1", city: "thane", pincode: "400604", closed: false }] }));
    expect(g.findings.some((f) => f.kind === "shared_address" && f.vendorIds.length === 2)).toBe(true);
  });
  it("ignores closed accounts and old addresses", () => {
    const g = new RelationshipGraph(gInput({ banks: [{ vendorId: "V-1", accountNo: "5010", bankName: "B", status: "verified" }, { vendorId: "V-2", accountNo: "5010", bankName: "B", status: "closed" }] }));
    expect(g.findings.filter((f) => f.kind === "shared_bank_account")).toHaveLength(0);
  });
  it("flags two vendor records carrying the same tax ID", () => {
    const g = new RelationshipGraph(gInput({ vendors: [{ id: "V-1", name: "A", gstin: "G1" }, { id: "V-2", name: "B", gstin: "G1" }] }));
    expect(g.findings.some((f) => f.kind === "shared_tax_id")).toBe(true);
  });
  it("surfaces an approver who repeatedly approves just-under-limit invoices from one vendor, and not ordinary approvals", () => {
    const mkInv = (n: number, total: number) => ({ id: `P-${n}`, vendorId: "V-1", poId: String(300 + n), total, date: "2026-11-01", approvals: [{ approverId: "E-9", level: "clerk", on: `2026-11-0${n}` }] });
    const risky = new RelationshipGraph(gInput({ invoices: [1, 2, 3, 4, 5].map((n) => mkInv(n, 95000 + n * 500)) }));
    expect(risky.findings.some((f) => f.kind === "approver_pattern")).toBe(true);
    const normal = new RelationshipGraph(gInput({ invoices: [1, 2, 3, 4, 5].map((n) => mkInv(n, 30000 + n * 500)) }));
    expect(normal.findings.some((f) => f.kind === "approver_pattern")).toBe(false);
  });
  it("builds nodes of every type for the interactive view", () => {
    const g = new RelationshipGraph(gInput());
    const v = g.toView({ focusVendors: ["V-1"], includeTransactions: true });
    expect(new Set(v.nodes.map((n) => n.type))).toEqual(new Set(["vendor", "bank", "address", "approver", "po", "invoice"]));
  });
});

// ---------------------------------------------------------------- the whole seeded dataset
let ds: Dataset, dir: string, eng: PlantPayEngine;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-risk-"));
  ds = buildDataset();
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: "2026-11-12" });
}, 180000);
afterAll(() => { eng.connectors.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const flags = (id: string, detector: "duplicate" | "splitting" | "vendor" | "graph", kind?: string) => (eng.stored(id)!.risk!.detectors[detector].signals.filter((s) => s.flag && (!kind || s.kind === kind)));
const reviewFlags = (id: string) => (eng.stored(id)!.risk!.flagged.filter((s) => s.severity === "review"));
const ids = (kind: string) => ds.riskPlants!.filter((p) => p.kind === kind).map((p) => p.invoiceId);

describe("planted cases on the dataset", () => {
  it("every invoice carries a risk assessment with the four detectors", () => {
    for (const i of ds.invoices) { const r = eng.stored(i.id)!.risk; expect(r, i.id).toBeDefined(); expect(Object.keys(r!.detectors).sort()).toEqual(["duplicate", "graph", "splitting", "vendor"]); }
  });
  it("flags every planted duplicate (and only those)", () => {
    const planted = ids("duplicate");
    expect(planted.length).toBeGreaterThanOrEqual(10);
    for (const id of planted) expect(flags(id, "duplicate").length, id).toBe(1);
    const extra = ds.invoices.filter((i) => !planted.includes(i.id) && flags(i.id, "duplicate").length > 0).map((i) => i.id);
    expect(extra).toEqual([]);
  });
  it("flags the three threshold-splitting invoices with the combined total, and nothing else", () => {
    const planted = ids("threshold_split");
    expect(planted).toHaveLength(3);
    for (const id of planted) { const s = flags(id, "splitting")[0]; expect(s, id).toBeDefined(); expect(s.supportingRecords).toHaveLength(3); expect(s.reasons.join(" ")).toMatch(/Combined total/); }
    const extra = ds.invoices.filter((i) => !planted.includes(i.id) && flags(i.id, "splitting").length > 0).map((i) => i.id);
    expect(extra).toEqual([]);
  });
  it("flags the bank change, creates an independent-verification task, and flags the shared account", () => {
    const [bank] = ids("bank_change");
    expect(flags(bank, "vendor", "bank_change")).toHaveLength(1);
    const t = tasksFor(eng.integration, bank).find((x) => x.checkId === "bank_change");
    expect(t, "task").toBeDefined();
    expect(t!.department).toBe("Supplier master data");
    expect(t!.title).toMatch(/Verify the bank-detail change independently/);
    const [shared] = ids("shared_bank_account");
    expect(flags(shared, "vendor", "shared_bank_account")).toHaveLength(1);
    expect(flags(shared, "graph", "shared_bank_account")).toHaveLength(1);
  });
  it("flags the address change and the tax ID conflict", () => {
    for (const id of ids("address_change")) expect(flags(id, "vendor", "address_change"), id).toHaveLength(1);
    for (const id of ids("tax_id_conflict")) expect(flags(id, "vendor", "tax_id_conflict"), id).toHaveLength(1);
  });
  it("links the shared-account vendors in a graph cluster (the ABC Chemicals / XYZ Traders pair)", () => {
    const g = (eng as unknown as { connectors: unknown }).connectors;
    expect(g).toBeDefined();
    const [shared] = ids("shared_bank_account");
    const s = flags(shared, "graph", "shared_bank_account")[0];
    expect(s.reasons[0]).toMatch(/Kolhapur Castings \(V-1015\) and Coimbatore Motors \(V-1023\) share bank account/);
  });
});

describe("false positives on the dataset", () => {
  it("raises no review-level risk signal on an invoice that is not planted for it", () => {
    const expected = new Map<string, Set<string>>();
    for (const p of ds.riskPlants!) if (p.expectFlag) (expected.get(p.invoiceId) ?? expected.set(p.invoiceId, new Set()).get(p.invoiceId)!).add(p.detector);
    const bad: string[] = [];
    for (const i of ds.invoices) for (const s of reviewFlags(i.id)) if (!expected.get(i.id)?.has(s.detector)) bad.push(`${i.id}:${s.detector}/${s.kind}`);
    expect(bad).toEqual([]);
  });
  it("does not flag the look-alikes: verified bank change, old address change, confirmed group account", () => {
    for (const p of ds.riskPlants!.filter((x) => !x.expectFlag)) {
      expect(flags(p.invoiceId, p.detector).filter((s) => s.severity === "review"), `${p.invoiceId} ${p.kind}`).toEqual([]);
    }
    const group = ds.invoices.filter((i) => i.vendorId === "V-1027" || i.vendorId === "V-1028");
    expect(group.length).toBeGreaterThan(0);
    for (const i of group) expect(flags(i.id, "graph").length + flags(i.id, "vendor", "shared_bank_account").length, i.id).toBe(0);
  });
  it("leaves the clean demo documents with no risk flags at all", () => {
    const riskIds = new Set(ds.riskPlants!.filter((p) => p.expectFlag).map((p) => p.invoiceId));
    const clean = ds.demoDocs.filter((d) => !riskIds.has(d.invoiceId) && !ds.planted.some((p) => p.invoiceId === d.invoiceId && p.caseType === "duplicate") && !["V-1015", "V-1023"].includes(ds.invoices.find((i) => i.id === d.invoiceId)!.vendorId));
    expect(clean.length).toBeGreaterThan(10);
    for (const d of clean) expect(eng.stored(d.invoiceId)!.risk!.flagged.filter((s) => s.severity === "review"), d.invoiceId).toEqual([]);
  });
});

describe("every demo document shows the right risk signals", () => {
  const detectorsOf = (id: string) => Object.entries(eng.stored(id)!.risk!.detectors).filter(([, d]) => d.signals.some((s) => s.flag && s.severity === "review")).map(([k]) => k).sort();
  it("25 demo documents: each flagged detector is the one its case calls for", () => {
    expect(ds.demoDocs.length).toBeGreaterThanOrEqual(15);
    const want: Record<string, string[]> = { duplicate: ["duplicate"], threshold_split: ["splitting"], bank_change: ["vendor"], shared_bank_account: ["vendor"] };
    for (const d of ds.demoDocs) {
      const type = ds.planted.find((p) => p.invoiceId === d.invoiceId)?.caseType ?? "";
      expect(detectorsOf(d.invoiceId), `${d.invoiceId} (${type})`).toEqual(want[type] ?? []);
    }
  });
});

describe("wording, separation and degradation", () => {
  it("every flagged signal says 'warning, not proof' and no accusing word appears", () => {
    const text = JSON.stringify(ds.invoices.map((i) => eng.stored(i.id)!.risk)).toLowerCase();
    expect(text).not.toMatch(/fraud|stolen|criminal|culprit|scam|guilty/);
    for (const i of ds.invoices) for (const s of eng.stored(i.id)!.risk!.flagged) expect(s.label).toBe("warning, not proof");
  });
  it("keeps vendor red flags and graph findings in separate detectors", () => {
    const [shared] = ids("shared_bank_account");
    const r = eng.stored(shared)!.risk!;
    expect(r.detectors.vendor.signals.every((s) => s.detector === "vendor")).toBe(true);
    expect(r.detectors.graph.signals.every((s) => s.detector === "graph")).toBe(true);
    expect(r.detectors.vendor.signals.some((s) => s.kind === "shared_cluster")).toBe(false);
  });
  it("a bank change always carries the independent-verification flag", () => {
    for (const i of ds.invoices) for (const s of eng.stored(i.id)!.risk!.flagged) if (s.kind === "bank_change") expect(s.requiresIndependentVerification).toBe(true);
  });
  it("shows the graph as not evaluated (not clear) when the Supplier database is down", () => {
    const [shared] = ids("shared_bank_account");
    setOutage(eng.integration, "supplier", true);
    try {
      const r = eng.evaluate(shared, { audit: false });
      expect(r.risk?.detectors.graph.flag ?? false).toBe(false);
      expect(r.notEvaluated.some((x) => x.check === "bank_and_account_risk")).toBe(true);
    } finally { setOutage(eng.integration, "supplier", false); eng.evaluate(shared, { audit: false }); }
  });
});
