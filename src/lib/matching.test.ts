import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Invoice, InvoiceLine } from "./types";

vi.mock("server-only", () => ({}));
let state: AppState;
vi.mock("./store", async (orig) => ({ ...(await orig<typeof import("./store")>()), updateState: <T,>(fn: (s: AppState) => T) => fn(state) }));

import { applyDuplicateDecision, matchInState, rematch } from "./matching";

function demoInvoice(file: string): Invoice {
  const e = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo-docs", `${file}.expected.json`), "utf8"));
  const lines: InvoiceLine[] = e.lines.map((l: { itemCode: string; description: string; qty: number; unit: string; unitPrice: number; amount: number }, i: number) => ({
    lineNo: i + 1, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.unit, unitPrice: l.unitPrice, taxRatePct: e.taxRatePct, amount: l.amount,
  }));
  return {
    id: e.invoiceNumber, vendorId: state.vendors.find((v) => v.gstin === e.vendorGstin)!.id, poId: e.poNumber, invoiceDate: e.invoiceDate, receivedOn: "2026-11-12",
    currency: "INR", lines, subtotal: e.subtotal, tax: e.taxAmount, total: e.total, status: "received", submittedBy: "test",
  };
}

beforeEach(async () => {
  const { loadSeed } = await import("./store");
  state = loadSeed();
});

describe("matchInState", () => {
  it("sets verdict, status and findings, and logs one event", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    const r = matchInState(state, "INV-7781", "vihar.supplier");
    expect(r).toEqual({ verdict: "flag", changed: true });
    const inv = state.invoices.find((i) => i.id === "INV-7781")!;
    expect(inv).toMatchObject({ verdict: "flag", status: "pending_owner" });
    expect(state.findings.filter((f) => f.invoiceId === "INV-7781")).toHaveLength(3);
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({ actor: "vihar.supplier", action: "match_run", invoiceId: "INV-7781" });
  });

  it("maps verdicts to statuses: approve -> pending approval, block -> blocked", () => {
    state.invoices.push(demoInvoice("INV-7782"), demoInvoice("INV-7784"));
    matchInState(state, "INV-7782");
    matchInState(state, "INV-7784");
    expect(state.invoices.find((i) => i.id === "INV-7782")).toMatchObject({ verdict: "approve", status: "pending_approval" });
    expect(state.invoices.find((i) => i.id === "INV-7784")).toMatchObject({ verdict: "block", status: "blocked" });
  });

  it("is idempotent: a second run changes nothing and writes no event", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    const snap = JSON.stringify([state.findings, state.invoices, state.auditEvents]);
    const again = matchInState(state, "INV-7781");
    expect(again?.changed).toBe(false);
    expect(JSON.stringify([state.findings, state.invoices, state.auditEvents])).toBe(snap);
  });

  it("re-matches after a PO price change: the price finding disappears, the quantity finding stays", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    state.purchaseOrders.find((p) => p.id === "4500001234")!.lines[0].unitPrice = 412;
    const r = rematch("INV-7781", "priya.clerk");
    expect(r?.changed).toBe(true);
    expect(state.findings.filter((f) => f.invoiceId === "INV-7781").map((f) => f.kind)).toEqual(["uom", "quantity"]);
  });

  it("goes clean after both owner fixes, and is logged as a re-match", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    const po = state.purchaseOrders.find((p) => p.id === "4500001234")!;
    po.lines[0].unitPrice = 412;
    state.goodsReceipts.push({ id: "5000009099", poId: po.id, receivedOn: "2026-11-12", receivedBy: "Sunil Patil (Stores)", lines: [{ lineNo: 3, qtyReceived: 8, uom: "nos" }] });
    rematch("INV-7781");
    const inv = state.invoices.find((i) => i.id === "INV-7781")!;
    expect(inv).toMatchObject({ verdict: "approve", status: "pending_approval" });
    expect(state.findings.filter((f) => f.invoiceId === "INV-7781").map((f) => f.kind)).toEqual(["uom"]);
    expect(state.auditEvents.map((e) => e.action)).toEqual(["match_run", "rematch"]);
  });

  it("never moves an approved or paid invoice backwards", () => {
    const paid = state.invoices.find((i) => i.status === "paid")!;
    matchInState(state, paid.id);
    expect(state.invoices.find((i) => i.id === paid.id)!.status).toBe("paid");
  });

  it("keeps the audit chain linked", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    state.purchaseOrders.find((p) => p.id === "4500001234")!.lines[0].unitPrice = 412;
    rematch("INV-7781");
    expect(state.auditEvents[1].prevHash).toBe(state.auditEvents[0].hash);
    expect(state.auditEvents[1].seq).toBe(2);
  });
});

describe("duplicate decision", () => {
  beforeEach(() => {
    state.invoices.push(demoInvoice("INV-6120R"));
    matchInState(state, "INV-6120R");
  });

  it("blocks INV-6120R as a possible duplicate of the paid INV-6120", () => {
    expect(state.invoices.find((i) => i.id === "INV-6120R")).toMatchObject({ verdict: "block", status: "blocked" });
    expect(state.findings.find((f) => f.invoiceId === "INV-6120R")).toMatchObject({ kind: "duplicate", matchedInvoiceId: "INV-6120" });
  });

  it("requires a reason", () => {
    for (const reason of ["", "   ", "ok"]) {
      const r = applyDuplicateDecision(state, "INV-6120R", "not_duplicate", reason, "priya.clerk");
      expect(r.ok).toBe(false);
    }
    expect(state.invoices.find((i) => i.id === "INV-6120R")!.duplicateDecision).toBeUndefined();
  });

  it("'not a duplicate' with a reason releases the block and is logged", () => {
    const r = applyDuplicateDecision(state, "INV-6120R", "not_duplicate", "Second delivery batch confirmed with stores", "priya.clerk");
    expect(r.ok).toBe(true);
    const inv = state.invoices.find((i) => i.id === "INV-6120R")!;
    expect(inv).toMatchObject({ verdict: "approve", status: "pending_approval", duplicateDecision: { decision: "not_duplicate", by: "priya.clerk" } });
    expect(state.auditEvents.some((e) => e.action === "duplicate_dismissed" && e.detail.includes("Second delivery batch"))).toBe(true);
  });

  it("'confirm duplicate' keeps it blocked", () => {
    applyDuplicateDecision(state, "INV-6120R", "duplicate", "Same bill re-sent with a new number", "priya.clerk");
    expect(state.invoices.find((i) => i.id === "INV-6120R")).toMatchObject({ verdict: "block", status: "blocked" });
    expect(state.findings.find((f) => f.invoiceId === "INV-6120R")!.message).toContain("Confirmed duplicate");
  });

  it("refuses a decision on an invoice with no duplicate finding", () => {
    expect(applyDuplicateDecision(state, "INV-6120", "duplicate", "A long enough reason", "priya.clerk").ok).toBe(false);
  });
});
