import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let state: AppState;
vi.mock("./store", async (orig) => ({ ...(await orig<typeof import("./store")>()), updateState: <T,>(fn: (s: AppState) => T) => fn(state) }));

import { answer, intentFromText, invoiceIdFromText } from "./chatbot";
import { buildControlsReport } from "./controls";
import { ageBucketOf, buildDashboard } from "./dashboard";
import { matchInState } from "./matching";
import { buildSupplierView } from "./supplier-view";
import type { AppState, Invoice, InvoiceLine } from "./types";
import { decideApproval, requestFix, simulateErpUpdate, type Actor } from "./workflow";

const clerk: Actor = { username: "priya.clerk", role: "clerk" };
const l1: Actor = { username: "neha.approver", role: "approver", approverLevel: "L1" };
const vihar = { username: "vihar.supplier", vendorId: "V-1001" };
const konkan = { username: "konkan.supplier", vendorId: "V-1002" };

function demoInvoice(file: string, by = "vihar.supplier"): Invoice {
  const e = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo-docs", `${file}.expected.json`), "utf8"));
  const lines: InvoiceLine[] = e.lines.map((l: { itemCode: string; description: string; qty: number; unit: string; unitPrice: number; amount: number }, i: number) => ({
    lineNo: i + 1, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.unit, unitPrice: l.unitPrice, taxRatePct: e.taxRatePct, amount: l.amount,
  }));
  return {
    id: e.invoiceNumber, vendorId: state.vendors.find((v) => v.gstin === e.vendorGstin)!.id, poId: e.poNumber, invoiceDate: e.invoiceDate, receivedOn: "2026-11-12",
    currency: "INR", lines, subtotal: e.subtotal, tax: e.taxAmount, total: e.total, status: "received", submittedBy: by,
  };
}

beforeEach(async () => {
  const { loadSeed } = await import("./store");
  state = loadSeed();
});

const causeCases = (c: string) => buildDashboard(state).causes.find((x) => x.cause === c)?.cases ?? 0;

function goldenToClean() {
  state.invoices.push(demoInvoice("INV-7781"));
  matchInState(state, "INV-7781", "vihar.supplier");
  for (const f of state.findings.filter((x) => x.invoiceId === "INV-7781" && x.verdict !== "approve")) expect(requestFix(state, clerk, "INV-7781", f.id).ok).toBe(true);
  for (const t of [...state.tasks]) expect(simulateErpUpdate(state, clerk, t.id).ok).toBe(true);
}

describe("exceptions dashboard", () => {
  it("reconciles with the invoice list: open exceptions equal the flagged and blocked invoices in the open queue", () => {
    const d = buildDashboard(state);
    const queue = state.invoices.filter((i) => i.status !== "approved" && i.status !== "paid");
    const exc = queue.filter((i) => i.verdict === "flag" || i.verdict === "block");
    expect(d.kpi.open).toBe(exc.length);
    expect(d.rows.map((r) => r.invoiceId).sort()).toEqual(exc.map((i) => i.id).sort());
    // Every chart adds up to the same population.
    const findings = d.rows.reduce((n, r) => n + r.findings.length, 0);
    expect(d.byAge.reduce((n, b) => n + b.count, 0)).toBe(d.kpi.open);
    expect(d.bySupplier.reduce((n, r) => n + r.open, 0)).toBe(d.kpi.open);
    expect(d.byType.reduce((n, t) => n + t.findings, 0)).toBe(findings);
    expect(d.causes.reduce((n, c) => n + c.cases, 0)).toBe(findings);
  });

  it("shows the seeded top cause: PO not updated after contract change, 7 cases, with each PO and invoice", () => {
    const top = buildDashboard(state).causes[0];
    expect(top.cause).toBe("PO not updated after contract change");
    expect(top.cases).toBe(7);
    expect(top.pos.flatMap((p) => p.invoiceIds)).toHaveLength(7);
    expect(top.fix).toBe("Upstream fix: update 7 POs");
  });

  it("buckets age at the stated boundaries", () => {
    expect([0, 2, 3, 7, 8, 14, 15, 40].map(ageBucketOf)).toEqual(["0-2", "0-2", "3-7", "3-7", "8-14", "8-14", "15+", "15+"]);
  });

  it("filters by supplier and date, and the table filter does not change the charts", () => {
    const all = buildDashboard(state);
    const one = buildDashboard(state, { supplier: "V-1001" });
    expect(one.rows.every((r) => r.vendorId === "V-1001")).toBe(true);
    expect(one.kpi.open).toBeLessThan(all.kpi.open);
    const recent = buildDashboard(state, { from: "2026-11-05" });
    expect(recent.rows.every((r) => r.receivedOn >= "2026-11-05")).toBe(true);
    const t = buildDashboard(state, { type: "price" });
    expect(t.rows).toHaveLength(all.rows.length);
    expect(t.tableRows.length).toBeLessThan(all.rows.length);
    expect(t.tableRows.every((r) => r.findings.some((f) => f.kind === "price"))).toBe(true);
  });

  it("updates live along the golden journey: INV-7781 adds a case, resolving it removes it", () => {
    const before = buildDashboard(state);
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781", "vihar.supplier");
    const mid = buildDashboard(state);
    expect(mid.kpi.open).toBe(before.kpi.open + 1);
    expect(causeCases("PO not updated after contract change")).toBe(8);
    expect(mid.byAge.find((b) => b.id === "0-2")!.count).toBe(before.byAge.find((b) => b.id === "0-2")!.count + 1);

    for (const f of state.findings.filter((x) => x.invoiceId === "INV-7781" && x.verdict !== "approve")) expect(requestFix(state, clerk, "INV-7781", f.id).ok).toBe(true);
    for (const t of [...state.tasks]) expect(simulateErpUpdate(state, clerk, t.id).ok).toBe(true);
    const after = buildDashboard(state);
    expect(after.kpi.open).toBe(before.kpi.open);
    expect(causeCases("PO not updated after contract change")).toBe(7);
  });

  it("computes KPIs from the records", () => {
    const d = buildDashboard(state);
    expect(d.kpi.avgAgeDays).toBeCloseTo(d.rows.reduce((n, r) => n + r.ageDays, 0) / d.rows.length, 1);
    expect(d.kpi.blockedValue).toBe(d.rows.filter((r) => r.verdict === "block").reduce((n, r) => n + r.total, 0));
    expect(d.kpi.firstPassPct).toBeGreaterThan(0);
    expect(d.kpi.firstPassPct).toBeLessThan(100);
  });
});

describe("controls report", () => {
  it("matches the audit data after the golden journey", () => {
    goldenToClean();
    expect(decideApproval(state, l1, "INV-7781", "approve", "").ok).toBe(true);
    // An attempted breach, refused and logged.
    expect(decideApproval(state, clerk, "INV-6138", "approve", "").ok).toBe(false);

    const r = buildControlsReport(state);
    const line = (id: string) => r.lines.find((l) => l.id === id)!;
    expect(r.chain.ok).toBe(true);
    expect(r.scope.auditRecords).toBe(state.auditEvents.length);
    expect(line("audit").result).toContain(`${state.auditEvents.length} records`);
    expect(line("thresholds").result).toMatch(/^1 decision recorded/);
    expect(line("thresholds").status).toBe("pass");
    expect(line("sod").result).toContain(`${state.auditEvents.filter((e) => e.action === "refused").length} refusal`);
    expect(line("paid").status).toBe("pass");
    expect(line("paid").detail).toContain("INV-6112");
    expect(r.exceptions.open).toBe(buildDashboard(state).kpi.open);
    expect(r.evidence.some((e) => e.invoiceId === "INV-7781")).toBe(true);
  });

  it("reports a broken chain and an invoice approved without a match", () => {
    const target = state.invoices.find((i) => i.id === "INV-6138")!;
    target.status = "approved";
    target.verdict = undefined;
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781", "vihar.supplier");
    state.auditEvents[0].detail = "edited";
    const r = buildControlsReport(state);
    expect(r.chain.ok).toBe(false);
    expect(r.lines.find((l) => l.id === "audit")!.status).toBe("attention");
    expect(r.lines.find((l) => l.id === "paid")!.status).toBe("attention");
    expect(r.lines.find((l) => l.id === "paid")!.result).toContain("INV-6138");
  });
});

describe("payment chatbot", () => {
  const ask = (who: typeof vihar, intent: Parameters<typeof answer>[2], id?: string) => answer(state, who, intent, id);

  it("answers all five intents for each seeded supplier from their own records", () => {
    for (const who of [vihar, konkan]) {
      const own = state.invoices.filter((i) => i.vendorId === who.vendorId);
      for (const intent of ["status", "why_held", "needs", "due", "late"] as const) {
        const a = ask(who, intent);
        expect(a.lines.length).toBeGreaterThan(0);
        expect(a.lines.join(" ")).not.toMatch(/undefined|NaN|\[object/);
        for (const id of a.basedOn) expect(own.some((i) => i.id === id)).toBe(true);
      }
      // A specific invoice quotes that invoice's status page headline.
      const target = own.find((i) => i.status === "pending_owner")!;
      const view = buildSupplierView(state, target.id, who)!;
      expect(ask(who, "status", target.id).lines[0]).toContain(view.headline);
      expect(ask(who, "due", target.id).lines[0]).toContain(`${view.payment!.termsDays}-day terms`);
    }
  });

  it("refuses other suppliers' invoices with the same reply as a missing one, and leaks nothing", () => {
    const konkanInv = state.invoices.find((i) => i.vendorId === "V-1002")!.id;
    for (const intent of ["status", "why_held", "needs", "due"] as const) {
      const a = ask(vihar, intent, konkanInv);
      expect(a.lines[0]).toBe(`I can't see an invoice ${konkanInv} in your records. Check the number on your invoice list.`);
      expect(a.basedOn).toEqual([]);
    }
    expect(ask(vihar, "status", "INV-0000").lines[0]).toContain("I can't see");
    const all = (["status", "why_held", "needs", "due", "late"] as const).flatMap((i) => ask(vihar, i).lines).join(" ");
    expect(all).not.toMatch(/Konkan|Sahyadri|Deccan|Malabar|Girnar|Warehouse|Buyer|Approver L|priya|neha/);
  });

  it("says it cannot answer unknown questions, and maps words to intents", () => {
    expect(answer(state, vihar, intentFromText("what is the weather"), undefined, "what is the weather").lines[0]).toMatch(/^I can't answer that/);
    expect(intentFromText("Where is my payment?")).toBe("status");
    expect(intentFromText("why is it on hold")).toBe("why_held");
    expect(intentFromText("what do you need from me")).toBe("needs");
    expect(intentFromText("when will I be paid")).toBe("due");
    expect(intentFromText("which invoices are overdue")).toBe("late");
    expect(invoiceIdFromText("why is inv-7781 held")).toBe("INV-7781");
  });

  it("reads the golden invoice for the supplier: internal actions pending, nothing needed", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781", "vihar.supplier");
    for (const f of state.findings.filter((x) => x.invoiceId === "INV-7781" && x.verdict !== "approve")) requestFix(state, clerk, "INV-7781", f.id);
    expect(ask(vihar, "status", "INV-7781").lines[0]).toContain("2 internal actions pending. Nothing needed from you.");
    expect(ask(vihar, "needs", "INV-7781").lines[0]).toContain("nothing needed from you");
  });

  it("lists late invoices only when the payment due date has passed", () => {
    for (const id of ask(vihar, "late").basedOn) {
      const v = buildSupplierView(state, id, vihar)!;
      expect(v.payment!.dueOn < "2026-11-12" && !v.payment!.paid).toBe(true);
    }
  });
});
