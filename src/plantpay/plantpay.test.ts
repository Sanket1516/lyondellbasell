import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENESIS_HASH, appendAudit as appendPure, verifyChain } from "../lib/audit";
import type { AuditEvent, AppState } from "../lib/types";
import { buildDataset, type Dataset } from "../foundation/generate";
import { loadCanonical, normGrnId, normPoId, normUom, normVendorId, paiseToInr, tonnesToKg, type CanonicalBundle } from "./canonical";
import { Connectors, SourceUnavailableError } from "./connectors";
import { PlantPayEngine } from "./engine";
import { DEMO_API_KEY, appendAudit, getSourceStates, pendingEvents, readAudit, setOutage, tasksFor, verifyApiKey, verifyAudit } from "./integration";
import { RagIndex, POLICY_PASSAGES, tokenize } from "./rag";
import { seedPlantPay } from "./runtime";
import { qualityCheck, weighbridgeCheck } from "./rules";
import { buildSourceDatabases } from "./sources/build";
import { SOURCE_IDS } from "./sources/schemas";
import { changeBankDetails, postGoodsReceipt, recordInspection, verifyBankDetails } from "./sources/writers";
import { listWorkflowEvents, verifyIntegrity, workflowEventCounts, workflowEventsFor, WORKFLOW_EVENT_TYPES } from "./workflowEvents";

let dir: string;
let eng: PlantPayEngine;
let ds: Dataset;
const TODAY = "2026-11-12";
const expectedOf = (id: string) => { const p = ds.planted.find((x) => x.invoiceId === id); if (p) return p.plantpayStatus ?? p.expectedStatus; return ds.riskPlants?.some((r) => r.invoiceId === id && r.expectFlag) ? "flag" : "approve"; };
const STATUS = { pass: "approve", review: "flag", block: "block", incomplete: "incomplete" } as const;
const docFor = (needle: RegExp) => ds.demoDocs.find((d) => needle.test(d.purpose))!;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-test-"));
  ds = buildDataset();
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: TODAY });
}, 180000);
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may still hold a handle; the OS temp folder is cleaned later */ } });

describe("six source databases and read-only connectors", () => {
  it("creates one SQLite file per source", () => {
    for (const id of SOURCE_IDS) expect(fs.existsSync(path.join(dir, `${id}.db`))).toBe(true);
  });
  it("splits the tables by department (no source holds another's data)", () => {
    const tables = (id: string) => (new Database(path.join(dir, `${id}.db`), { readonly: true }).prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables("procurement")).toEqual(expect.arrayContaining(["purchase_orders", "contracts", "contract_amendments"]));
    expect(tables("warehouse")).toEqual(expect.arrayContaining(["goods_receipts", "stock_transactions"]));
    expect(tables("quality")).toEqual(expect.arrayContaining(["inspections", "inspection_lines"]));
    expect(tables("finance")).toEqual(expect.arrayContaining(["invoices", "payments", "approvals"]));
    expect(tables("logistics")).toEqual(expect.arrayContaining(["gate_entries", "weighbridge_records", "shipments"]));
    expect(tables("supplier")).toEqual(expect.arrayContaining(["suppliers", "bank_accounts", "contacts"]));
    expect(tables("finance")).not.toContain("purchase_orders");
  });
  it("every connector is read-only: a write attempt is rejected", () => {
    for (const id of SOURCE_IDS) expect((eng.connectors[id] as unknown as { assertReadOnly(): boolean }).assertReadOnly(), id).toBe(true);
  });
  it("reports health, record counts and last sync for all six", () => {
    const h = eng.connectors.health();
    expect(h).toHaveLength(6);
    for (const s of h) { expect(s.status, s.id).toBe("up"); expect(s.records).toBeGreaterThan(0); expect(s.lastSync, s.id).toBeTruthy(); }
  });
  it("a missing database file is 'unavailable', not a crash", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pp-empty-"));
    const c = new Connectors(eng.integration, empty);
    expect(c.procurement.health()).toMatchObject({ status: "down" });
    expect(() => c.procurement.purchaseOrder("1")).toThrow(SourceUnavailableError);
    fs.rmSync(empty, { recursive: true, force: true });
  });
  it("the outage toggle takes one source down and back up", () => {
    setOutage(eng.integration, "quality", true);
    expect(eng.connectors.quality.health().status).toBe("down");
    expect(() => eng.connectors.quality.inspectionsForPo("PO-1")).toThrow(SourceUnavailableError);
    expect(getSourceStates(eng.integration).find((s) => s.source === "quality")!.outage).toBe(true);
    setOutage(eng.integration, "quality", false);
    expect(eng.connectors.quality.health().status).toBe("up");
  });
  it("splits the demo dataset consistently: every PO has its records in the right databases", () => {
    const po = ds.purchaseOrders.find((p) => ds.goodsReceipts.some((g) => g.poId === p.id))!;
    expect(eng.connectors.procurement.purchaseOrder(po.id)!.lines).toHaveLength(po.lines.length);
    expect(eng.connectors.warehouse.receiptsForPo(`PO-${po.id}`).length).toBeGreaterThan(0);
    expect(eng.connectors.quality.inspectionsForPo(`PO-${po.id}`).length).toBeGreaterThan(0);
    expect(eng.connectors.logistics.shipmentsForPo(po.id).length).toBeGreaterThan(0);
  });
});

describe("canonical normalisation", () => {
  it("normalises IDs", () => {
    expect(normPoId("PO-4600009003")).toBe("4600009003");
    expect(normPoId("4600009003")).toBe("4600009003");
    expect(normGrnId("GRN-5100000001")).toBe("5100000001");
    expect(normVendorId("SUP-1007")).toBe("V-1007");
    expect(normVendorId("V-1007")).toBe("V-1007");
  });
  it("normalises currency and weights", () => {
    expect(paiseToInr(106200000)).toBe(1062000);
    expect(paiseToInr(12345)).toBe(123.45);
    expect(tonnesToKg(5.52)).toBe(5520);
    expect(tonnesToKg(0.0005)).toBe(1);
  });
  it("normalises units to one spelling", () => {
    expect(["KGS", "Kg", "kilograms"].map(normUom)).toEqual(["kg", "kg", "kg"]);
    expect(["tonnes", "MT", "mt"].map(normUom)).toEqual(["MT", "MT", "MT"]);
    expect(["Pcs", "NOS", "each"].map(normUom)).toEqual(["nos", "nos", "nos"]);
    expect(["Ltr", "litres", "l"].map(normUom)).toEqual(["L", "L", "L"]);
    expect(normUom("Rolls")).toBe("rolls");
  });
  it("Finance's paise and V- ids come out as rupees and canonical ids", () => {
    const r = loadCanonical(eng.connectors, "INV-7781").bundle!;
    expect(r.invoice.total).toBe(1062000);
    expect(r.invoice.lines.find((l) => l.itemCode === "C-12")!.uom).toBe("MT");
    expect(r.ids).toEqual({ invoice: "inv:INV-7781", po: "po:4500001234", vendor: "vendor:V-1001" });
    expect(r.goodsReceipts.every((g) => /^\d+$/.test(g.id) && /^\d+$/.test(g.poId))).toBe(true);
    expect(r.vendor!.id).toBe("V-1001");
  });
  it("converts logistics tonnes to kilograms", () => {
    const doc = docFor(/Logistics: weighbridge/);
    const b = loadCanonical(eng.connectors, doc.invoiceId).bundle!;
    const raw = ds.weighbridge.find((w) => w.poId === b.po!.id)!;
    expect(b.weighbridge[0].netKg).toBe(raw.netKg);
  });
  it("every demo document gets evidence from each of the six sources", () => {
    for (const d of ds.demoDocs) {
      const c = loadCanonical(eng.connectors, d.invoiceId);
      expect(c.unavailable, d.invoiceId).toEqual([]);
      for (const s of c.sources) expect(s.contributed.length, `${d.invoiceId} ${s.source}`).toBeGreaterThan(0);
    }
  });
});

describe("the engine on the demo documents", () => {
  it("evaluates all 21 demo documents to their expected PlantPay outcome", () => {
    expect(ds.demoDocs.length).toBeGreaterThanOrEqual(15);
    for (const d of ds.demoDocs) {
      const r = eng.stored(d.invoiceId)!;
      expect(STATUS[r.status], d.invoiceId).toBe(d.plantpayStatus ?? d.expectedStatus);
    }
  });
  it("evaluates every one of the invoices to its labelled outcome", () => {
    const wrong = ds.invoices.filter((i) => STATUS[eng.stored(i.id)!.status] !== expectedOf(i.id)).map((i) => i.id);
    expect(wrong).toEqual([]);
  });
  it("shows which sources contributed to the decision", () => {
    const r = eng.stored("INV-7781")!;
    expect(r.sources.map((s) => s.source).sort()).toEqual([...SOURCE_IDS].sort());
    expect(r.sources.every((s) => s.status === "ok")).toBe(true);
  });
  it("labels causes honestly and never uses accusing words", () => {
    const text = JSON.stringify(SOURCE_IDS.flatMap(() => []).concat(ds.invoices.map((i) => eng.stored(i.id)!) as never)).toLowerCase();
    expect(text).not.toMatch(/fraud|stolen|criminal|culprit/);
    const r = eng.stored("INV-7781")!;
    for (const d of r.discrepancies) expect(["supported_by_evidence", "unverified_prediction"]).toContain(d.rootCauseStatus);
  });
  it("prediction is a clearly-labelled stub (no hard-coded probabilities)", () => {
    expect(eng.stored("INV-7781")!.prediction).toMatchObject({ available: false });
  });
});

describe("quality and weighbridge cross-checks", () => {
  const bundle = (over: Partial<CanonicalBundle> = {}): CanonicalBundle => ({
    ids: { invoice: "inv:T", po: "po:1", vendor: "vendor:V-1" },
    invoice: { id: "T", vendorId: "V-1", poId: "1", invoiceDate: "2026-11-01", receivedOn: "2026-11-02", currency: "INR", subtotal: 0, tax: 0, total: 0, status: "received", lines: [{ lineNo: 1, itemCode: "X", description: "X", qty: 100, uom: "kg", unitPrice: 10, taxRatePct: 18, amount: 1000 }] },
    approvals: [], poChanges: [], amendments: [], uomRules: [{ itemCode: "X", fromUom: "MT", toUom: "kg", factor: 1000 }],
    po: { id: "1", vendorId: "V-1", buyer: "B", issuedOn: "2026-10-01", lines: [{ lineNo: 1, itemCode: "X", description: "X", qty: 100, uom: "kg", unitPrice: 10, taxCode: "GST18", taxRatePct: 18 }] },
    goodsReceipts: [{ id: "G1", poId: "1", receivedOn: "2026-10-20", receivedBy: "S", lines: [{ lineNo: 1, qtyReceived: 100, uom: "kg" }] }],
    deliveryNotes: [], inspections: [{ id: "QI1", grId: "G1", poId: "1", inspectedOn: "2026-10-21", inspector: "Q", lines: [{ poLineNo: 1, qtyInspected: 100, qtyAccepted: 100, qtyRejected: 0, uom: "kg" }] }],
    stockLedger: [], weighbridge: [], gateEntries: [], shipments: [], relatedInvoices: [], accountHolders: [], ...over,
  });
  it("quality: billing the full quantity when 15% was rejected is flagged with the inspection as evidence", () => {
    const b = bundle({ inspections: [{ id: "QI1", grId: "G1", poId: "1", inspectedOn: "d", inspector: "Q", lines: [{ poLineNo: 1, qtyInspected: 100, qtyAccepted: 85, qtyRejected: 15, uom: "kg", reason: "Damaged packaging" }] }] });
    const o = qualityCheck(b);
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0].message).toMatch(/only 85 kg passed inspection \(15 kg rejected: Damaged packaging\)/);
    expect(o.findings[0].evidence[0]).toMatch(/QI1/);
    expect(o.findings[0].smallestFix).toMatch(/credit/);
  });
  it("quality: billing only what was accepted passes; within the 5% tolerance passes", () => {
    const mk = (acc: number, billed: number) => bundle({ invoice: { ...bundle().invoice, lines: [{ ...bundle().invoice.lines[0], qty: billed }] }, inspections: [{ id: "QI1", grId: "G1", poId: "1", inspectedOn: "d", inspector: "Q", lines: [{ poLineNo: 1, qtyInspected: 100, qtyAccepted: acc, qtyRejected: 100 - acc, uom: "kg" }] }] });
    expect(qualityCheck(mk(85, 85)).findings).toHaveLength(0);
    expect(qualityCheck(mk(95, 99)).findings).toHaveLength(0);
    expect(qualityCheck(mk(95, 101)).findings).toHaveLength(1);
  });
  it("quality: goods received but not inspected are held; nothing received is not a quality problem", () => {
    expect(qualityCheck(bundle({ inspections: [] })).findings[0].rootCause).toBe("Inspection not completed");
    expect(qualityCheck(bundle({ goodsReceipts: [], inspections: [] })).findings).toHaveLength(0);
  });
  it("quality: converts a billed unit (5 MT) before comparing with accepted kg", () => {
    const b = bundle({ invoice: { ...bundle().invoice, lines: [{ ...bundle().invoice.lines[0], qty: 0.1, uom: "MT" }] } });
    expect(qualityCheck(b).findings).toHaveLength(0);
  });
  it("weighbridge: net weight 8% under the GRN and invoice is flagged; within 1% passes; counted goods are not applicable", () => {
    const wb = (net: number) => [{ id: "W1", entryId: "E", poId: "1", weighedOn: "d", grossKg: net + 6000, tareKg: 6000, netKg: net }];
    const bad = weighbridgeCheck(bundle({ weighbridge: wb(92) }));
    expect(bad.findings[0].message).toMatch(/Weighbridge net weight is 92 kg; the goods receipt says 100 kg and the invoice bills 100 kg/);
    expect(bad.findings[0].owner).toBe("Logistics");
    expect(weighbridgeCheck(bundle({ weighbridge: wb(99.5 as number) })).findings).toHaveLength(0);
    expect(weighbridgeCheck(bundle({ weighbridge: [] })).note).toMatch(/not weighed/);
  });
  it("on the demo documents: the quality document and the weighbridge document are flagged by the right check", () => {
    const q = eng.stored(docFor(/^Quality:/).invoiceId)!;
    expect(q.status).toBe("review");
    expect(q.discrepancies.map((d) => d.check)).toContain("quality");
    expect(q.checks.find((c) => c.check === "quality")!.passed).toBe(false);
    expect(q.routing.map((r) => r.department)).toContain("Quality");
    const w = eng.stored(docFor(/^Logistics:/).invoiceId)!;
    expect(w.discrepancies.map((d) => d.check)).toContain("weighbridge");
    expect(w.routing.map((r) => r.department)).toContain("Logistics");
    expect(eng.stored("INV-7782")!.checks.find((c) => c.check === "quality")!.passed).toBe(true);
  });
});

describe("risk warnings are for human review", () => {
  const warningsOf = (re: RegExp) => eng.stored(docFor(re).invoiceId)!.warnings;
  it("bank-detail change requires independent verification", () => {
    const w = warningsOf(/Bank-detail change/).find((x) => x.kind === "bank_change")!;
    expect(w.severity).toBe("review");
    expect(w.requiresIndependentVerification).toBe(true);
    expect(w.message).toMatch(/independently|independent/);
    expect(w.message).toMatch(/contact already on file/);
  });
  it("shared accounts are a prompt, not an accusation; a confirmed group account is only informational", () => {
    const w = warningsOf(/also on file for an unrelated vendor/).find((x) => x.kind === "shared_bank_account")!;
    expect(w.message).toMatch(/can be legitimate/);
    const dahej = ds.invoices.filter((i) => i.vendorId === "V-1028" && !ds.planted.some((p) => p.invoiceId === i.id)).map((i) => eng.stored(i.id)!);
    expect(dahej.length).toBeGreaterThan(0);
    for (const r of dahej) { expect(r.status).toBe("pass"); expect(r.warnings.every((x) => x.severity === "info")).toBe(true); }
  });
  it("threshold splitting is flagged on each of the three invoices, as one warning each", () => {
    for (const d of ds.demoDocs.filter((x) => /Threshold splitting/.test(x.purpose))) {
      const r = eng.stored(d.invoiceId)!;
      expect(r.status).toBe("review");
      expect(r.warnings.find((x) => x.kind === "threshold_splitting")!.message).toMatch(/3 invoices/);
    }
  });
});

describe("outage handling", () => {
  const withOutage = <T,>(ids: (typeof SOURCE_IDS)[number][], fn: () => T): T => { ids.forEach((i) => setOutage(eng.integration, i, true)); try { return fn(); } finally { ids.forEach((i) => setOutage(eng.integration, i, false)); } };
  it("Procurement down: price/quantity checks are 'not evaluated', no false 'missing PO', status incomplete, no crash", () => {
    const r = withOutage(["procurement"], () => eng.compute("INV-7782").result);
    expect(r.status).toBe("incomplete");
    expect(r.unavailable).toEqual(["procurement"]);
    expect(r.notEvaluated.map((x) => x.check)).toEqual(expect.arrayContaining(["price", "quantity", "purchase_order"]));
    expect(r.discrepancies.find((d) => d.check === "purchase_order")).toBeUndefined();
    expect(r.summary).toMatch(/Procurement DB unavailable/);
    expect(r.checks.find((c) => c.check === "price")).toMatchObject({ passed: null });
    expect(r.checks.find((c) => c.check === "price")!.detail).toMatch(/Not evaluated: Procurement DB is unavailable/);
    expect(r.sources.find((s) => s.source === "procurement")).toMatchObject({ status: "unavailable" });
  });
  it("Warehouse down: a missing-receipt invoice is not falsely blocked", () => {
    const r = withOutage(["warehouse"], () => eng.compute("INV-7784").result);
    expect(r.discrepancies.find((d) => d.check === "quantity")).toBeUndefined();
    expect(r.status).toBe("incomplete");
  });
  it("Quality or Logistics down: only their checks are not evaluated", () => {
    const r = withOutage(["quality", "logistics"], () => eng.compute("INV-7782").result);
    expect(r.notEvaluated.map((x) => x.check).sort()).toEqual(["quality", "weighbridge"]);
    expect(r.checks.find((c) => c.check === "price")!.passed).toBe(true);
    expect(r.status).toBe("incomplete");
  });
  it("Supplier DB down: the vendor is still identified from Procurement and bank checks are not evaluated", () => {
    const r = withOutage(["supplier"], () => eng.compute("INV-7782").result);
    expect(r.checks.find((c) => c.check === "bank_and_account_risk")).toMatchObject({ passed: null });
    expect(r.checks.find((c) => c.check === "vendor")!.passed).toBe(true);
  });
  it("Finance down: a clear 'source unavailable' result instead of a crash", () => {
    const r = withOutage(["finance"], () => eng.compute("INV-7782").result);
    expect(r.status).toBe("incomplete");
    expect(r.summary).toMatch(/Finance DB is unavailable/);
    expect(r.unavailable).toContain("finance");
  });
  it("all six down at once still returns a result", () => {
    const r = withOutage([...SOURCE_IDS], () => eng.compute("INV-7782").result);
    expect(r.status).toBe("incomplete");
  });
  it("after the outage is cleared the original result comes back", () => {
    expect(eng.compute("INV-7782").result.status).toBe("pass");
  });
});

describe("event-driven re-matching and workflow automation", () => {
  it("a goods receipt posted by Warehouse re-matches the invoice, then Quality's inspection clears it", () => {
    const id = "INV-7784";
    const po = eng.stored(id)!;
    expect(po.status).toBe("block");
    expect(tasksFor(eng.integration, id).some((t) => t.department === "Warehouse" && t.status === "open")).toBe(true);
    const inv = loadCanonical(eng.connectors, id).bundle!;
    const ctx = { integration: eng.integration, dir, now: () => `${TODAY}T10:00:00.000Z` };
    const grn = postGoodsReceipt(ctx, { poId: inv.po!.id, receivedOn: TODAY, lines: inv.po!.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty, uom: l.uom })) });
    expect(pendingEvents(eng.integration).some((e) => e.type === "grn_posted" && e.payload.grnNo === grn)).toBe(true);
    const r1 = eng.processEvents();
    expect(r1.reevaluated).toContain(id);
    const mid = eng.stored(id)!;
    expect(mid.status).toBe("review");
    expect([...new Set(mid.discrepancies.map((d) => d.check))]).toEqual(["quality"]);
    expect(tasksFor(eng.integration, id).find((t) => t.department === "Warehouse")!.status).toBe("done");
    recordInspection(ctx, { poId: inv.po!.id, grnNo: grn, inspectedOn: TODAY, lines: inv.po!.lines.map((l) => ({ lineNo: l.lineNo, inspected: l.qty, accepted: l.qty, uom: l.uom })) });
    eng.processEvents();
    expect(eng.stored(id)!.status).toBe("pass");
    expect(tasksFor(eng.integration, id).every((t) => t.status === "done")).toBe(true);
    const types = workflowEventsFor(eng.integration, id).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["exception_resolved"]));
    const audit = readAudit(eng.integration).filter((a) => a.invoiceId === id && a.action === "rematch_triggered");
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[audit.length - 1]).toMatchObject({ before: "review", after: "pass" });
    expect(pendingEvents(eng.integration)).toHaveLength(0);
    expect(verifyIntegrity(eng.integration).ok).toBe(true);
  });
  it("a bank-detail change event re-matches the supplier's open invoices; verification clears the warning", () => {
    const open = ds.invoices.find((i) => i.vendorId === "V-1011" && i.status === "pending_approval") ?? ds.invoices.find((i) => i.vendorId === "V-1011" && i.status !== "paid" && !ds.planted.some((p) => p.invoiceId === i.id));
    expect(open).toBeTruthy();
    const before = eng.stored(open!.id)!;
    expect(before.warnings.filter((w) => w.severity === "review")).toHaveLength(0);
    const ctx = { integration: eng.integration, dir, now: () => `${TODAY}T11:00:00.000Z` };
    changeBankDetails(ctx, { vendorId: "V-1011", accountNo: "99900011122233", ifsc: "FICB0999999", bankName: "Western Trust Bank", changedOn: TODAY });
    // the invoice must name the new account to be affected; change what Finance recorded for the test via the writer role
    const fin = new Database(path.join(dir, "finance.db"));
    fin.prepare("UPDATE invoices SET remit_account_no = ?, remit_ifsc = ? WHERE invoice_no = ?").run("99900011122233", "FICB0999999", open!.id);
    fin.close();
    const r = eng.processEvents();
    expect(r.reevaluated).toContain(open!.id);
    const mid = eng.stored(open!.id)!;
    expect(mid.status).toBe("review");
    expect(mid.warnings.find((w) => w.kind === "bank_change")!.requiresIndependentVerification).toBe(true);
    expect(tasksFor(eng.integration, open!.id).some((t) => t.department === "Supplier master data" && t.status === "open")).toBe(true);
    verifyBankDetails(ctx, { vendorId: "V-1011", accountNo: "99900011122233", verifiedOn: TODAY, verifiedBy: "E-09" });
    eng.processEvents();
    expect(eng.stored(open!.id)!.warnings.filter((w) => w.severity === "review")).toHaveLength(0);
  });
  it("events stay queued while Finance is unavailable and are processed once it returns", () => {
    const ctx = { integration: eng.integration, dir, now: () => `${TODAY}T12:00:00.000Z` };
    const po = ds.purchaseOrders.find((p) => p.id === "4500001236")!;
    postGoodsReceipt(ctx, { poId: po.id, receivedOn: TODAY, lines: [{ lineNo: 1, qty: 10, uom: po.lines[0].uom }] });
    setOutage(eng.integration, "finance", true);
    const r = eng.processEvents();
    expect(r.deferred).toBeGreaterThan(0);
    expect(pendingEvents(eng.integration).length).toBeGreaterThan(0);
    setOutage(eng.integration, "finance", false);
    expect(eng.processEvents().processed).toBeGreaterThan(0);
    expect(pendingEvents(eng.integration)).toHaveLength(0);
  });
  it("routes each exception to the responsible department", () => {
    expect(new Set(eng.stored("INV-7781")!.routing.map((r) => r.department))).toEqual(new Set(["Procurement", "Warehouse"]));
    expect(eng.stored(docFor(/Quality:/).invoiceId)!.routing.map((r) => r.department)).toEqual(["Quality"]);
  });
});

describe("integration layer: API keys and audit", () => {
  it("accepts the demo key and rejects others", () => {
    expect(verifyApiKey(eng.integration, DEMO_API_KEY).ok).toBe(true);
    expect(verifyApiKey(eng.integration, "wrong").ok).toBe(false);
    expect(verifyApiKey(eng.integration, undefined).ok).toBe(false);
  });
  it("the audit trail is hash-chained and verifies", () => {
    expect(readAudit(eng.integration).length).toBeGreaterThan(1000);
    expect(verifyAudit(eng.integration).ok).toBe(true);
  });
});

describe("RAG with citations", () => {
  it("answers 'why' for an invoice with the evaluation and cited policy/contract passages", () => {
    const a = eng.ask("Why was this invoice flagged and what does the contract say about the price?", "INV-7781");
    expect(a.grounded).toBe(true);
    expect(a.citations.some((c) => c.kind === "evaluation")).toBe(true);
    expect(a.citations.some((c) => c.kind === "amendment" || c.kind === "contract" || c.kind === "policy")).toBe(true);
    expect(a.answer).toMatch(/\[POL-AP-|\[Contract C-/);
    expect(a.answer).toMatch(/unverified prediction|supported by evidence/);
  });
  it("answers policy questions with a citation", () => {
    const a = eng.ask("What is the approval limit for an AP clerk?");
    expect(a.grounded).toBe(true);
    expect(a.citations[0].id).toBe("POL-AP-04");
    expect(a.answer).toMatch(/1,00,000/);
    expect(eng.ask("How should a supplier bank detail change be verified?").citations[0].id).toBe("POL-AP-05");
  });
  it("finds contract amendments by material and says where it found them", () => {
    const a = eng.ask("When did the price of AX-40 change in the contract amendment?");
    expect(a.citations.some((c) => c.kind === "amendment" && /AX-40/.test(c.text))).toBe(true);
  });
  it("says so when nothing relevant is found instead of guessing", () => {
    const a = eng.ask("What is the airspeed velocity of an unladen swallow?");
    expect(a.grounded).toBe(false);
    expect(a.citations).toEqual([]);
    expect(a.answer).toMatch(/will not guess/);
  });
  it("notes when the contract source is unavailable", () => {
    setOutage(eng.integration, "procurement", true);
    try {
      const fresh = new PlantPayEngine(eng.integration, eng.connectors, { today: TODAY });
      const a = fresh.ask("What does the approval matrix say?");
      expect(a.notes.join(" ")).toMatch(/Procurement DB is unavailable/);
      expect(a.grounded).toBe(true);
    } finally { setOutage(eng.integration, "procurement", false); }
  });
  it("tokenizer and index basics", () => {
    expect(tokenize("The Price of AX-40, in ₹")).toContain("ax-40");
    expect(new RagIndex(POLICY_PASSAGES).search("weighbridge net weight tolerance")[0].p.id).toBe("POL-AP-03");
    expect(new RagIndex(POLICY_PASSAGES).search("zzzzzz")).toEqual([]);
  });
});

// ================================================================ Stage 2
describe("Stage 2: workflow_events", () => {
  it("has every required event type in the seeded histories", () => {
    const counts = workflowEventCounts(eng.integration);
    for (const t of WORKFLOW_EVENT_TYPES) expect(counts[t], t).toBeGreaterThan(0);
  });
  it("every event has invoice, actor, department, timestamp and payload", () => {
    const { events } = listWorkflowEvents(eng.integration, { limit: 1000 });
    for (const e of events) { expect(e.invoiceId).toBeTruthy(); expect(e.actor).toBeTruthy(); expect(e.department).toBeTruthy(); expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(typeof e.payload).toBe("object"); }
  });
  it("every invoice starts with invoice_received and none is dated after today", () => {
    for (const i of ds.invoices) {
      const ev = workflowEventsFor(eng.integration, i.id);
      expect(ev[0]?.type, i.id).toBe("invoice_received");
      expect(ev.every((e) => e.at <= `${TODAY}T23:59:59.000Z`), i.id).toBe(true);
      expect(ev.map((e) => e.at)).toEqual([...ev.map((e) => e.at)].sort());
    }
  });
  it("histories agree with the records: paid invoices have approval and payment, open exceptions stop with the department", () => {
    const paid = ds.invoices.find((i) => i.status === "paid")!;
    const pt = workflowEventsFor(eng.integration, paid.id);
    expect(pt.map((e) => e.type)).toEqual(expect.arrayContaining(["approval_requested", "approval_granted", "payment_status_changed"]));
    expect(pt[pt.length - 1].payload).toMatchObject({ to: "paid" });
    const blocked = ds.invoices.find((i) => i.status === "blocked")!;
    const bt = workflowEventsFor(eng.integration, blocked.id).map((e) => e.type);
    expect(bt).toContain("exception_raised");
    expect(bt).not.toContain("exception_resolved");
    expect(bt).not.toContain("approval_granted");
  });
  it("includes loops: AP review -> department -> AP review again (twice for some)", () => {
    const rows = eng.integration.prepare("SELECT invoice_id, COUNT(*) n FROM workflow_events WHERE event_type = 'review_started' AND json_extract(payload, '$.stage') LIKE 'AP review (again)%' GROUP BY invoice_id").all() as { invoice_id: string; n: number }[];
    expect(rows.length).toBeGreaterThan(10);
    const twice = rows.filter((r) => r.n >= 2);
    expect(twice.length).toBeGreaterThan(0);
    const t = workflowEventsFor(eng.integration, twice[0].invoice_id);
    const depts = t.filter((e) => e.type === "department_assigned").map((e) => e.department);
    expect(depts.filter((d) => d === "Finance").length).toBeGreaterThanOrEqual(3);
    expect(depts.some((d) => d !== "Finance")).toBe(true);
  });
  it("live instrumentation: re-evaluating through the engine emits events automatically", () => {
    const id = docFor(/Price about 7%/).invoiceId;
    const before = workflowEventsFor(eng.integration, id).length;
    eng.integration.prepare("DELETE FROM evaluations WHERE invoice_id = ?").run(id);
    eng.integration.prepare("DELETE FROM workflow_tasks WHERE invoice_id = ?").run(id);
    eng.evaluate(id, { actor: "priya.clerk", role: "clerk" });
    const after = workflowEventsFor(eng.integration, id);
    expect(after.length).toBeGreaterThan(before);
    const recent = after.slice(before).map((e) => e.type);
    expect(recent).toEqual(expect.arrayContaining(["review_started", "review_completed", "exception_raised", "department_assigned"]));
  });
  it("approval and payment status changes are recorded through the engine", () => {
    const id = "INV-7782";
    eng.requestApproval(id, "priya.clerk", 70564);
    eng.grantApproval(id, "Neha Kulkarni", "clerk");
    eng.setPaymentStatus(id, "Finance payment run", "approved", "scheduled");
    const t = workflowEventsFor(eng.integration, id).map((e) => e.type);
    expect(t.slice(-3)).toEqual(["approval_requested", "approval_granted", "payment_status_changed"]);
  });
});

describe("Stage 2: hash-chained audit log and tamper detection", () => {
  const copy = () => { const db = new Database(eng.integration.serialize()); db.exec("DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete;"); return db; };
  const mid = () => Math.floor((eng.integration.prepare("SELECT MAX(seq) m FROM audit_events").get() as { m: number }).m / 2);

  it("valid chain: every entry links to the one before and the whole log verifies", () => {
    const events = readAudit(eng.integration);
    expect(events[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < events.length; i++) expect(events[i].prevHash).toBe(events[i - 1].hash);
    expect(verifyAudit(eng.integration)).toMatchObject({ ok: true });
    expect(verifyIntegrity(eng.integration)).toMatchObject({ ok: true });
  });
  it("edited record: detected, and the position of the first broken link is reported", () => {
    const db = copy(); const n = mid();
    const e = JSON.parse((db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(n) as { data: string }).data); e.detail = "changed";
    db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(JSON.stringify(e), n);
    const r = verifyAudit(db);
    expect(r).toMatchObject({ ok: false, brokenSeq: n });
    expect((r as { reason: string }).reason).toMatch(/has been changed/);
    expect(verifyIntegrity(db)).toMatchObject({ ok: false, kind: "audit_chain", position: n });
  });
  it("deleted record: detected at the gap", () => {
    const db = copy(); const n = mid();
    db.prepare("DELETE FROM audit_events WHERE seq = ?").run(n);
    const r = verifyAudit(db);
    expect(r.ok).toBe(false);
    expect((r as { brokenSeq: number }).brokenSeq).toBe(n + 1);
    expect((r as { reason: string }).reason).toMatch(/missing or out of order/);
  });
  it("reordered records: detected", () => {
    const db = copy(); const n = mid();
    const a = (db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(n) as { data: string }).data;
    const b = (db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(n + 1) as { data: string }).data;
    db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(b, n);
    db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(a, n + 1);
    const r = verifyAudit(db);
    expect(r.ok).toBe(false);
    expect((r as { brokenSeq: number }).brokenSeq).toBeGreaterThanOrEqual(n);
    expect((r as { brokenSeq: number }).brokenSeq).toBeLessThanOrEqual(n + 1);
  });
  it("the append-only triggers refuse edits and deletes through the normal path", () => {
    expect(() => eng.integration.prepare("UPDATE audit_events SET hash = 'x' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => eng.integration.prepare("DELETE FROM audit_events WHERE seq = 1").run()).toThrow(/append-only/);
  });
  it("an edited workflow_events row no longer matches its audit record", () => {
    const db = copy();
    const row = db.prepare("SELECT id, audit_seq FROM workflow_events WHERE event_type = 'approval_granted' ORDER BY id LIMIT 1").get() as { id: number; audit_seq: number };
    db.prepare("UPDATE workflow_events SET actor = 'someone.else' WHERE id = ?").run(row.id);
    expect(verifyIntegrity(db)).toMatchObject({ ok: false, kind: "workflow_event", position: row.audit_seq });
  });
  it("a deleted workflow_events row is detected", () => {
    const db = copy();
    const row = db.prepare("SELECT id, audit_seq FROM workflow_events WHERE event_type = 'exception_resolved' ORDER BY id LIMIT 1").get() as { id: number; audit_seq: number };
    db.prepare("DELETE FROM workflow_events WHERE id = ?").run(row.id);
    const r = verifyIntegrity(db);
    expect(r).toMatchObject({ ok: false, kind: "workflow_event", position: row.audit_seq });
  });
  it("pure chain logic (no database): valid, edited, deleted, reordered arrays", () => {
    const s = { auditEvents: [] as AuditEvent[] } as unknown as AppState;
    for (let i = 1; i <= 6; i++) appendPure(s, { actor: "system", action: `a${i}`, detail: `event ${i}` }, `2026-11-0${i}T10:00:00.000Z`);
    const ev = s.auditEvents;
    expect(verifyChain(ev)).toEqual({ ok: true, count: 6 });
    const edited = structuredClone(ev); edited[3].detail = "tampered";
    expect(verifyChain(edited)).toMatchObject({ ok: false, brokenSeq: 4 });
    const deleted = ev.filter((_, i) => i !== 2);
    expect(verifyChain(deleted)).toMatchObject({ ok: false, brokenSeq: 4 });
    const reordered = [ev[0], ev[2], ev[1], ...ev.slice(3)];
    expect(verifyChain(reordered)).toMatchObject({ ok: false, brokenSeq: 3 });
    expect(verifyChain([])).toEqual({ ok: true, count: 0 });
  });
  it("a new entry appended after tampering does not hide the break", () => {
    const db = copy(); const n = mid();
    const e = JSON.parse((db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(n) as { data: string }).data); e.actor = "mallory";
    db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(JSON.stringify(e), n);
    appendAudit(db, { actor: "system", action: "later", detail: "after the tamper" });
    expect(verifyAudit(db)).toMatchObject({ ok: false, brokenSeq: n });
  });
});

describe("rebuilding the source databases from a dataset", () => {
  it("is deterministic: two builds produce the same rows", () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "pp-det-"));
    buildSourceDatabases(ds, d2);
    const a = new Database(path.join(d2, "finance.db"), { readonly: true });
    const b = new Database(path.join(dir, "finance.db"), { readonly: true });
    expect(a.prepare("SELECT COUNT(*) n FROM invoices").get()).toEqual({ n: ds.invoices.length });
    expect(a.prepare("SELECT SUM(total_paise) s FROM invoices WHERE invoice_no NOT IN ('x')").get()).toBeTruthy();
    expect(b.prepare("SELECT COUNT(*) n FROM invoices").get()).toEqual({ n: ds.invoices.length });
    a.close(); b.close(); fs.rmSync(d2, { recursive: true, force: true });
  });
});
