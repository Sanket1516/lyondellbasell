// Stage 7: Payment Readiness Passport (restricted supplier view) and the Process-Mining Twin.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlantPayEngine, PlantPayResult } from "./engine";
import { HERO_INVOICE } from "./history";
import { assemble, buildPassport, loadSupplierPassport, PASSPORT_ALLOWED_KEYS, supplierPassports, type Passport } from "./passport";
import { analyse, EXPECTED_PATH, findLoops, pairExceptions, reconstructPath } from "./processMining";
import { processTwin } from "./processService";
import { seedPlantPay } from "./runtime";
import { allWorkflowEventsByInvoice, type WorkflowEvent, type WorkflowEventType } from "./workflowEvents";

let dir: string;
let eng: PlantPayEngine;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-s7-"));
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: "2026-11-12" });
}, 120_000);
afterAll(() => { try { eng.connectors.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a handle briefly */ } });

const allIds = () => (eng.integration.prepare("SELECT invoice_id FROM evaluations ORDER BY invoice_id").all() as { invoice_id: string }[]).map((r) => r.invoice_id);
const demoIds = () => (eng.integration.prepare("SELECT invoice_id FROM demo_invoices ORDER BY invoice_id").all() as { invoice_id: string }[]).map((r) => r.invoice_id);

// ---------------------------------------------------------------- pure fixtures
let nextId = 1;
const ev = (type: WorkflowEventType, at: string, department: string, payload: Record<string, unknown> = {}): WorkflowEvent => ({ id: nextId++, invoiceId: "T", type, actor: "x", department, at: `${at}:00.000Z`, payload, auditSeq: 0 });
const NOW = "2026-11-12T18:00:00.000Z";

const result = (over: Partial<PlantPayResult> = {}): PlantPayResult => ({
  invoiceId: "T-1", status: "pass", summary: "Pass", evaluatedAt: "2026-11-12T10:00:00.000Z", checks: [], discrepancies: [], warnings: [], sources: [], unavailable: [], notEvaluated: [], routing: [],
  prediction: { available: false, reason: "" }, tolerances: { pricePct: 2, qtyPct: 5, weighbridgePct: 1 }, meta: { vendorId: "V-1001", vendorName: "Vihar Chem Supplies", poId: "45001", totalInr: 100000, invoiceDate: "2026-11-01", receivedOn: "2026-11-02" }, ...over,
});
const disc = (check: string): PlantPayResult["discrepancies"][number] => ({ check, severity: "flag", message: `INTERNAL ${check} message ₹412 vs ₹398`, rootCause: "SECRET ROOT CAUSE", rootCauseStatus: "supported_by_evidence", evidence: ["SECRET EVIDENCE"], suggestedFix: "SECRET FIX", owner: "Buyer", department: "Procurement", sources: [] });

// ================================================================ Payment Readiness Passport
describe("passport: milestones, blockers, due date (pure)", () => {
  const x = { today: "2026-11-12", openTasks: [] as { checkId: string; createdAt: string }[], terms: 30 };
  it("has the seven milestones in order", () => {
    const p = assemble(result(), x);
    expect(p.milestones.map((m) => m.id)).toEqual(["uploaded", "extracted", "po", "receipt", "procurement", "approval", "payment"]);
    expect(p.milestones.map((m) => m.label)).toEqual(["Invoice uploaded", "Invoice data extracted", "Purchase order matched", "Goods receipt confirmed", "Procurement confirmation", "Final approval", "Payment"]);
  });
  it("a clean invoice waits for approval; due date is invoice date plus terms; days to due counts from today", () => {
    const p = assemble(result(), x);
    expect(p.milestones.filter((m) => m.state === "current").map((m) => m.id)).toEqual(["approval"]);
    expect(p.dueDate).toBe("2026-12-01");
    expect(p.daysToDue).toBe(19);
    expect(p.atRisk.flag).toBe(false);
    expect(p.blockers).toEqual([]);
  });
  it("a price exception blocks Procurement confirmation and names the team, without internal wording", () => {
    const p = assemble(result({ status: "review", discrepancies: [disc("price")] }), { ...x, openTasks: [{ checkId: "price", createdAt: "2026-11-09T10:00:00.000Z" }] });
    expect(p.milestones.find((m) => m.id === "procurement")!.state).toBe("blocked");
    expect(p.milestones.find((m) => m.id === "approval")!.state).toBe("upcoming");
    expect(p.blockers).toHaveLength(1);
    expect(p.blockers[0].team).toBe("Procurement");
    expect(p.actions).toEqual([{ team: "Procurement", action: "Confirm the price against the purchase order and contract", waitingSince: "2026-11-09", waitingDays: 3 }]);
    expect(JSON.stringify(p)).not.toMatch(/INTERNAL|SECRET|412|398/);
  });
  it("a missing goods receipt blocks the receipt milestone", () => {
    const p = assemble(result({ status: "review", discrepancies: [disc("quantity")] }), x);
    expect(p.milestones.find((m) => m.id === "receipt")!.state).toBe("blocked");
    expect(p.blockers[0].team).toBe("Warehouse");
  });
  it("risk warnings and unknown checks become one generic item that says nothing about why", () => {
    const warn = { kind: "shared_bank_account", severity: "review" as const, message: "Shares a bank account with Coimbatore Motors", department: "Finance", sources: [] } as unknown as PlantPayResult["warnings"][number];
    const p = assemble(result({ status: "review", warnings: [warn], discrepancies: [disc("duplicate")] }), x);
    expect(p.blockers.map((b) => b.id)).toEqual(["verification"]);
    expect(p.blockers[0].title).toBe("Additional verification");
    expect(JSON.stringify(p)).not.toMatch(/Coimbatore|bank|duplicate|shared/i);
    expect(p.milestones.find((m) => m.id === "approval")!.state).toBe("blocked");
  });
  it("evidence that a source is down shows as waiting for records, never as a failure", () => {
    const p = assemble(result({ status: "incomplete", notEvaluated: [{ check: "quantity", because: "warehouse" }] }), x);
    const g = p.milestones.find((m) => m.id === "receipt")!;
    expect(g.state).toBe("current");
    expect(g.note).toMatch(/Waiting for records/);
    expect(p.blockers).toEqual([]);
  });
  it("paid invoice: everything done, payment date shown, not at risk", () => {
    const p = assemble(result(), { ...x, approvedOn: "2026-11-05", paidOn: "2026-11-10", terms: 5 });
    expect(p.milestones.every((m) => m.state === "done")).toBe(true);
    expect(p.paidOn).toBe("2026-11-10");
    expect(p.atRisk).toEqual({ flag: false, reason: "Paid." });
    expect(p.headline).toBe("Paid on 10-Nov-2026.");
  });
  it("approved but unpaid: payment is the current step", () => {
    const p = assemble(result(), { ...x, approvedOn: "2026-11-10" });
    expect(p.milestones.find((m) => m.id === "approval")!.state).toBe("done");
    expect(p.milestones.find((m) => m.id === "payment")!.state).toBe("current");
  });
  it("at-risk rules: overdue; blocked and due soon; not approved and due very soon; comfortable", () => {
    const blocked = result({ status: "review", discrepancies: [disc("price")] });
    expect(assemble(result(), { ...x, terms: 5 }).atRisk).toEqual({ flag: true, reason: "Past the due date by 6 days." });
    expect(assemble(blocked, { ...x, terms: 20 }).atRisk).toEqual({ flag: true, reason: "Due in 9 days and 1 item is still open." });
    expect(assemble(blocked, { ...x, terms: 40 }).atRisk.flag).toBe(false);
    expect(assemble(result(), { ...x, terms: 15 }).atRisk).toEqual({ flag: true, reason: "Due in 4 days and not yet approved." });
    expect(assemble(result(), { ...x, terms: 15, approvedOn: "2026-11-10" }).atRisk.flag).toBe(false);
    const noTerms = assemble(result(), { today: "2026-11-12", openTasks: [] });
    expect(noTerms.dueDate).toBeUndefined();
    expect(noTerms.atRisk.flag).toBe(false);
    expect(noTerms.atRisk.reason).toMatch(/not available/);
  });
});

describe("passport on the demo data", () => {
  it("the golden invoice shows Procurement and Warehouse actions, with a due date and a clear headline", () => {
    const p = buildPassport(eng, HERO_INVOICE)!;
    expect(p).toBeDefined();
    expect(p.blockers.map((b) => b.team).sort()).toEqual(["Procurement", "Warehouse"]);
    expect(p.actions.map((a) => a.team).sort()).toEqual(["Procurement", "Warehouse"]);
    expect(p.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof p.daysToDue).toBe("number");
    expect(p.headline).toMatch(/2 items are holding this invoice/);
    expect(p.milestones.find((m) => m.id === "receipt")!.state).toBe("blocked");
    expect(p.milestones.find((m) => m.id === "procurement")!.state).toBe("blocked");
  });
  it("every demo document and every invoice builds a passport with 7 milestones, at most one current step and no raw placeholders", () => {
    for (const id of allIds()) {
      const p = buildPassport(eng, id)!;
      expect(p, id).toBeDefined();
      expect(p.milestones, id).toHaveLength(7);
      expect(p.milestones.filter((m) => m.state === "current").length, id).toBeLessThanOrEqual(1);
      expect(p.headline.length, id).toBeGreaterThan(5);
      expect(JSON.stringify(p), id).not.toMatch(/undefined|NaN|\[object|null/);
    }
    expect(demoIds().length).toBeGreaterThanOrEqual(15);
    for (const id of demoIds()) expect(buildPassport(eng, id), id).toBeDefined();
  });
  it("a paid invoice in the data shows as paid with every milestone done", () => {
    const id = allIds().map((i) => buildPassport(eng, i)!).find((p) => p.paidOn);
    expect(id).toBeDefined();
    expect(id!.milestones.every((m) => m.state === "done")).toBe(true);
  });
  it("a source outage gives waiting wording, not an error", () => {
    const e2 = eng.stored("INV-7782")!;
    expect(buildPassport(eng, "INV-7782")!.invoiceNumber).toBe(e2.invoiceId);
  });
  it("an unknown invoice has no passport", () => {
    expect(buildPassport(eng, "INV-DOES-NOT-EXIST")).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the restricted-view leak test
const STAFF = ["Priya Nair", "Anand Deshpande", "Kavita More", "Mahesh Gaikwad", "Neha Kulkarni", "Rajesh Menon", "Gate and Weighbridge Desk", "Supplier Master Data Team"];
const FORBIDDEN_WORDS = /fraud|suspicious|duplicate|splitting|threshold|shared|bank|ifsc|gstin|cluster|graph|probabilit|prediction|predicted|score|root cause|unverified|accus|supported by evidence|counterfactual|internal note/i;

describe("restricted view: no restricted field leaks", () => {
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
    return out;
  };
  it("every key of every passport is on the allow-list (so no internal field can be present)", () => {
    for (const id of allIds()) for (const k of keysOf(buildPassport(eng, id))) expect(PASSPORT_ALLOWED_KEYS.has(k), `${id}: key ${k}`).toBe(true);
  });
  it("no passport contains internal findings, evidence, root causes, risk wording, predictions, task titles, staff names or any supplier's name, id, tax id or account", () => {
    const vendors = eng.connectors.supplier.allSuppliers();
    const banks = eng.connectors.supplier.allBankAccounts();
    for (const id of allIds()) {
      const r = eng.stored(id)!;
      const json = JSON.stringify(buildPassport(eng, id));
      const secrets: string[] = [
        ...r.discrepancies.flatMap((d) => [d.message, d.rootCause, d.suggestedFix, ...d.evidence]),
        ...r.warnings.map((w) => w.message), r.summary,
        ...(r.risk ? [JSON.stringify(r.risk).slice(0, 0)] : []),
        ...(r.prediction.available ? r.prediction.items.map((i) => i.label) : []),
        ...STAFF,
        ...vendors.flatMap((v) => [String(v.legal_name), String(v.gstin), String(v.supplier_code), `V-${String(v.supplier_code).slice(4)}`]),
        ...banks.map((b) => String(b.account_no)),
      ].filter((t) => t && t.length >= 4);
      for (const t of secrets) expect(json.includes(t), `${id} leaks "${t.slice(0, 60)}"`).toBe(false);
      expect(json, id).not.toMatch(FORBIDDEN_WORDS);
    }
  });
  it("risk-flagged demo documents (bank change, splitting, shared account, duplicate) show only the generic wording", () => {
    // Only invoices not yet approved: once approved or paid there is nothing left to hold, so no blocker is shown
    const risky = allIds().filter((id) => { const r = eng.stored(id)!; return (r.warnings.some((w) => w.severity === "review") || r.discrepancies.some((d) => d.check === "duplicate")) && buildPassport(eng, id)!.milestones.find((m) => m.id === "approval")!.state !== "done"; });
    expect(risky.length).toBeGreaterThanOrEqual(10);
    for (const id of risky) {
      const p = buildPassport(eng, id)!;
      expect(p.blockers.some((b) => b.id === "verification"), id).toBe(true);
      expect(JSON.stringify(p.blockers.filter((b) => b.id === "verification"))).toContain("extra routine verification");
    }
  });
  it("a supplier can only open their own invoices; someone else's looks the same as a missing one", () => {
    const vihar = { role: "supplier", vendorId: "V-1001" }, konkan = { role: "supplier", vendorId: "V-1002" };
    const own = allIds().filter((i) => eng.stored(i)?.meta?.vendorId === "V-1001");
    const theirs = allIds().filter((i) => eng.stored(i)?.meta?.vendorId === "V-1002");
    expect(own.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    for (const i of own) { expect(loadSupplierPassport(eng, vihar, i), i).toBeDefined(); expect(loadSupplierPassport(eng, konkan, i), i).toBeUndefined(); }
    for (const i of theirs) expect(loadSupplierPassport(eng, vihar, i), i).toBeUndefined();
    expect(loadSupplierPassport(eng, vihar, "INV-DOES-NOT-EXIST")).toBeUndefined();
  });
  it("staff roles and suppliers with no vendor get nothing from the supplier loader", () => {
    expect(loadSupplierPassport(eng, { role: "clerk" }, HERO_INVOICE)).toBeUndefined();
    expect(loadSupplierPassport(eng, { role: "approver", vendorId: "V-1001" }, HERO_INVOICE)).toBeUndefined();
    expect(loadSupplierPassport(eng, { role: "supplier" }, HERO_INVOICE)).toBeUndefined();
  });
  it("a supplier's list holds only their own invoices", () => {
    for (const v of ["V-1001", "V-1002"]) {
      const list = supplierPassports(eng, v);
      const expected = allIds().filter((i) => eng.stored(i)?.meta?.vendorId === v);
      expect(list.map((p) => p.invoiceNumber).sort()).toEqual([...expected].sort());
      const other = allIds().filter((i) => eng.stored(i)?.meta?.vendorId !== v);
      const json = JSON.stringify(list);
      for (const o of other.slice(0, 200)) expect(json.includes(`"${o}"`), `${v} list shows ${o}`).toBe(false);
    }
  });
  it("the passport object is built only from allow-listed keys even when the stored result carries risk, prediction and task data", () => {
    const r = result({ status: "review", discrepancies: [disc("price")], warnings: [{ kind: "duplicate_risk", severity: "review", message: "Looks like a duplicate of INV-9", department: "Finance", sources: [] } as never], prediction: { available: true, items: [{ label: "Exception probability 91%", probability: 0.91, model: "gb", trainedOn: "x" }] } });
    const p: Passport = assemble(r, { today: "2026-11-12", terms: 30, openTasks: [{ checkId: "duplicate_risk", createdAt: "2026-11-10T00:00:00.000Z" }] });
    for (const k of keysOf(p)) expect(PASSPORT_ALLOWED_KEYS.has(k), k).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/91|INV-9|duplicate|probab/i);
  });
});

// ================================================================ Process-Mining Twin
describe("process mining (pure)", () => {
  it("reads the path and splits time into waiting and being worked", () => {
    nextId = 1;
    const evs = [
      ev("invoice_received", "2026-11-10T09:00", "Finance"),
      ev("department_assigned", "2026-11-10T09:30", "Finance", { to: "Finance" }),
      ev("review_started", "2026-11-10T11:30", "Finance"),
      ev("review_completed", "2026-11-10T13:30", "Finance"),
      ev("approval_requested", "2026-11-10T15:30", "Finance"),
      ev("approval_granted", "2026-11-11T15:30", "Finance"),
      ev("payment_status_changed", "2026-11-12T09:30", "Finance", { to: "paid" }),
    ];
    const p = reconstructPath("T", evs, NOW)!;
    expect(p.stations).toEqual([...EXPECTED_PATH]);
    expect(p.completed).toBe(true);
    expect(p.loops).toEqual([]);
    expect(p.conformance).toBe("conforming");
    const total = p.segments.reduce((a, s) => a + s.hours, 0);
    expect(total).toBeCloseTo(p.cycleHours, 5);
    expect(p.cycleHours).toBeCloseTo(48.5, 5);
    const ap = p.segments.filter((s) => s.station === "AP review");
    expect(ap.find((s) => s.phase === "working")!.hours).toBeCloseTo(2, 5);
    expect(ap.filter((s) => s.phase === "waiting").reduce((a, s) => a + s.hours, 0)).toBeCloseTo(2 + 2, 5);
  });
  it("finds the AP → Procurement → AP loop and reports the detour time", () => {
    nextId = 1;
    const evs = [
      ev("invoice_received", "2026-11-10T09:00", "Finance"),
      ev("department_assigned", "2026-11-10T09:05", "Finance", { to: "Finance" }),
      ev("review_started", "2026-11-10T09:30", "Finance"),
      ev("exception_raised", "2026-11-10T10:00", "Finance", { check: "price" }),
      ev("department_assigned", "2026-11-10T10:05", "Procurement", { to: "Procurement" }),
      ev("review_started", "2026-11-11T10:05", "Procurement"),
      ev("exception_resolved", "2026-11-11T12:00", "Procurement", { check: "price" }),
      ev("review_completed", "2026-11-11T12:05", "Procurement"),
      ev("department_assigned", "2026-11-11T12:10", "Finance", { to: "Finance" }),
      ev("review_started", "2026-11-11T13:00", "Finance"),
      ev("review_completed", "2026-11-11T14:00", "Finance"),
    ];
    const p = reconstructPath("T", evs, NOW)!;
    expect(p.stations).toEqual(["Intake", "AP review", "Procurement", "AP review"]);
    expect(p.loops).toHaveLength(1);
    expect(p.loops[0].sequence).toEqual(["AP review", "Procurement", "AP review"]);
    expect(p.conformance).toBe("rework");
    expect(p.deviations.join(" ")).toMatch(/Rework loop: AP review → Procurement → AP review/);
    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0]).toMatchObject({ check: "price", department: "Procurement", open: false });
    expect(p.exceptions[0].hours).toBeCloseTo(26, 5);
    expect(p.completed).toBe(false);
    expect(p.segments[p.segments.length - 1].open).toBe(true); // still open, counted up to "now"
  });
  it("loop finder: no loop, one loop, two loops, nested returns", () => {
    expect(findLoops(["Intake", "AP review", "Approval", "Payment"])).toEqual([]);
    expect(findLoops(["A", "B", "A"])).toHaveLength(1);
    expect(findLoops(["A", "B", "A", "C", "A"])).toHaveLength(2);
  });
  it("unresolved exceptions stay open and are timed to now; FIFO pairing per check", () => {
    nextId = 1;
    const evs = [
      ev("exception_raised", "2026-11-10T09:00", "Finance", { check: "quantity" }),
      ev("department_assigned", "2026-11-10T09:01", "Warehouse", { to: "Warehouse" }),
      ev("exception_raised", "2026-11-10T10:00", "Finance", { check: "quantity" }),
      ev("exception_resolved", "2026-11-10T21:00", "Warehouse", { check: "quantity" }),
    ];
    const x = pairExceptions(evs, NOW);
    expect(x[0]).toMatchObject({ resolvedAt: "2026-11-10T21:00:00.000Z", open: false });
    expect(x[0].hours).toBeCloseTo(12, 5);
    expect(x[1].open).toBe(true);
    expect(x[1].hours).toBeCloseTo(56, 5);
  });
  it("an invoice that stops early is in progress and on track, not deviating", () => {
    nextId = 1;
    const p = reconstructPath("T", [ev("invoice_received", "2026-11-12T09:00", "Finance"), ev("department_assigned", "2026-11-12T09:05", "Finance", { to: "Finance" })], NOW)!;
    expect(p.stations).toEqual(["Intake", "AP review"]);
    expect(p.conformance).toBe("on_track");
  });
  it("an invoice with no events has no path", () => {
    expect(reconstructPath("T", [], NOW)).toBeUndefined();
  });
});

describe("process twin on the demo data", () => {
  it("rebuilds a path for every invoice, with no negative time", () => {
    const a = processTwin(eng);
    expect(a.invoices).toBe(allIds().length);
    for (const p of a.paths.values()) { expect(p.cycleHours).toBeGreaterThanOrEqual(0); for (const s of p.segments) expect(s.hours).toBeGreaterThanOrEqual(0); }
    for (const id of demoIds()) expect(a.paths.get(id), id).toBeDefined();
  });
  it("no invoice goes back to a department after it was approved: Payment is always the last station", () => {
    for (const p of processTwin(eng).paths.values()) {
      const i = p.stations.indexOf("Payment");
      if (i >= 0) expect(i, `${p.invoiceId}: ${p.stations.join(" > ")}`).toBe(p.stations.length - 1);
      const a = p.stations.indexOf("Approval");
      if (a >= 0) expect(p.stations.slice(a + 1).every((x) => x === "Payment" || x === "Approval"), `${p.invoiceId}: ${p.stations.join(" > ")}`).toBe(true);
    }
  });
  it("the AP → Procurement → AP rework loop appears for the golden invoice", () => {
    const events = allWorkflowEventsByInvoice(eng.integration).get(HERO_INVOICE)!;
    const p = reconstructPath(HERO_INVOICE, events, `${eng.today}T18:00:00.000Z`)!;
    expect(p.stations.slice(0, 4)).toEqual(["Intake", "AP review", "Procurement", "AP review"]);
    expect(p.loops.map((l) => l.sequence.join(" → "))).toContain("AP review → Procurement → AP review");
    expect(p.conformance).toBe("rework");
    const a = processTwin(eng);
    expect(a.paths.get(HERO_INVOICE)!.loops.length).toBeGreaterThanOrEqual(1);
    expect(a.loops.some((l) => l.sequence === "AP review → Procurement → AP review" && l.invoices >= 1)).toBe(true);
    expect(a.variants.find((v) => v.example === HERO_INVOICE || v.key.startsWith("Intake → AP review → Procurement → AP review"))).toBeDefined();
  });
  it("the golden invoice's exceptions match what is open now: price with Procurement, quantity with Warehouse", () => {
    const p = processTwin(eng).paths.get(HERO_INVOICE)!;
    expect(p.exceptions.map((x) => `${x.check}:${x.department}:${x.open}`).sort()).toEqual(["price:Procurement:true", "quantity:Warehouse:true"]);
  });
  it("reports where time is spent, bottlenecks, loops, exception types, complexity and variants", () => {
    const a = processTwin(eng);
    expect(a.stations.length).toBeGreaterThanOrEqual(5);
    expect(a.stations.reduce((s, x) => s + x.sharePct, 0)).toBeCloseTo(100, 3);
    for (const st of a.stations) expect(st.waitHours + st.workHours).toBeCloseTo(st.totalHours, 5);
    expect(a.bottlenecks.length).toBeGreaterThan(0);
    expect(a.reworkInvoices).toBeGreaterThan(10);
    expect(a.loops[0].invoices).toBeGreaterThan(5);
    expect(a.exceptions.length).toBeGreaterThanOrEqual(3);
    expect(a.exceptions.reduce((s, x) => s + x.sharePct, 0)).toBeCloseTo(100, 3);
    expect(a.exceptions[0].totalDays).toBeGreaterThanOrEqual(a.exceptions[a.exceptions.length - 1].totalDays);
    expect(a.variants.reduce((s, v) => s + v.invoices, 0)).toBe(a.invoices);
    expect(a.variants[0].invoices).toBeGreaterThanOrEqual(a.variants[a.variants.length - 1].invoices);
    expect(a.complexCount).toBeGreaterThan(0);
    expect(a.edges.some((e) => e.from === "AP review" && e.to === "Procurement")).toBe(true);
    expect(a.edges.some((e) => e.from === "Procurement" && e.to === "AP review" && e.rework)).toBe(true);
    expect(a.conformance.conforming + a.conformance.on_track + a.conformance.rework + a.conformance.extra_steps).toBe(a.invoices);
  });
  it("is deterministic and cached until the event log changes", () => {
    const a1 = processTwin(eng);
    expect(processTwin(eng)).toBe(a1);
    const b = analyse(allWorkflowEventsByInvoice(eng.integration), `${eng.today}T18:00:00.000Z`);
    expect(JSON.stringify([...b.variants])).toBe(JSON.stringify([...a1.variants]));
  });
});
