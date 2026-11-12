import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/lib/types";

vi.mock("server-only", () => ({}));
let user: { username: string; role: string; vendorId?: string } | undefined;
vi.mock("@/lib/session", () => ({ getSessionUser: async () => user }));

let state: AppState;
vi.mock("@/lib/store", () => ({
  getState: () => state,
  updateState: <T,>(fn: (s: AppState) => T) => fn(state),
}));

import { submitInvoice, type SubmitPayload } from "./actions";

const payload = (over: Partial<SubmitPayload> = {}): SubmitPayload => ({
  source: "demo:INV-7781.pdf", vendorName: "Vihar Chem Supplies", vendorGstin: "27FICTV1001A1Z0",
  invoiceNumber: "INV-7781", invoiceDate: "2026-11-10", poNumber: "4500001234",
  lines: [{ itemCode: "AX-40", description: "Process additive AX-40", qty: 1000, unit: "kg", unitPrice: 412, amount: 412000 }],
  subtotal: 412000, taxRatePct: 18, taxAmount: 74160, total: 486160, ...over,
});

beforeEach(() => {
  user = { username: "vihar.supplier", role: "supplier", vendorId: "V-1001" };
  state = {
    version: 1, goodsReceipts: [], contracts: [], deliveryNotes: [], uomRules: [], purchaseOrders: [], findings: [], tasks: [], auditEvents: [], invoices: [],
    vendors: [{ id: "V-1001", name: "Vihar Chem Supplies", gstin: "27FICTV1001A1Z0", active: true }],
  };
});

describe("submitInvoice", () => {
  it("creates the invoice, runs the match (no PO on file here, so it is blocked) under the vendor matched by GSTIN", async () => {
    const r = await submitInvoice(payload());
    expect(r).toEqual({ ok: true, invoiceId: "INV-7781" });
    expect(state.invoices[0]).toMatchObject({ id: "INV-7781", vendorId: "V-1001", status: "blocked", verdict: "block", poId: "4500001234", submittedBy: "vihar.supplier", sourceFile: "demo:INV-7781.pdf" });
    expect(state.invoices[0].lines[0].taxRatePct).toBe(18);
  });

  it("records an unrecognised vendor as UNKNOWN with the printed name", async () => {
    await submitInvoice(payload({ vendorName: "Nowhere Traders", vendorGstin: "27ZZZZZ9999Z1Z9" }));
    expect(state.invoices[0]).toMatchObject({ vendorId: "UNKNOWN", printedVendor: { name: "Nowhere Traders" } });
  });

  it("refuses non-suppliers and signed-out users", async () => {
    user = { username: "priya.clerk", role: "clerk" };
    expect((await submitInvoice(payload())).ok).toBe(false);
    user = undefined;
    expect((await submitInvoice(payload())).ok).toBe(false);
    expect(state.invoices).toHaveLength(0);
  });

  it("rejects bad input with a clear message", async () => {
    for (const bad of [
      payload({ invoiceNumber: "" }), payload({ invoiceDate: "10-Nov" }), payload({ poNumber: "abc" }), payload({ lines: [] }),
      payload({ total: Number.NaN }), payload({ lines: [{ description: "x", qty: -1, unit: "kg", unitPrice: 1, amount: 1 }] }),
    ]) {
      const r = await submitInvoice(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
    expect(state.invoices).toHaveLength(0);
  });

  it("replaces an unprocessed resubmission but refuses to overwrite one already in the workflow", async () => {
    await submitInvoice(payload());
    await submitInvoice(payload({ poNumber: "4500001999" }));
    expect(state.invoices).toHaveLength(1);
    expect(state.invoices[0].poId).toBe("4500001999");
    state.invoices[0].status = "approved";
    const r = await submitInvoice(payload());
    expect(r.ok).toBe(false);
  });

  it("ignores a source reference that is not an allowed file", async () => {
    await submitInvoice(payload({ source: "demo:../../package.json" }));
    expect(state.invoices[0].sourceFile).toBeUndefined();
  });
});
