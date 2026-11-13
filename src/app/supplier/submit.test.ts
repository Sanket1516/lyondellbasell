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
import { buildSupplierView } from "@/lib/supplier-view";
import { requestFix } from "@/lib/workflow";
import type { Invoice } from "@/lib/types";

/** The same invoice as `payload()`, as if it had been seeded rather than submitted through the portal. */
const payloadInvoice = (): Invoice => ({
  id: "INV-7781", vendorId: "V-1001", poId: "4500001234", invoiceDate: "2026-11-10", receivedOn: "2026-11-10", currency: "INR",
  lines: [{ lineNo: 1, itemCode: "AX-40", description: "Process additive AX-40", qty: 1000, uom: "kg", unitPrice: 412, taxRatePct: 18, amount: 412000 }],
  subtotal: 412000, tax: 74160, total: 486160, status: "received",
});

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

  it("refuses another vendor's invoice number without revealing its status", async () => {
    await submitInvoice(payload());
    state.vendors.push({ id: "V-1002", name: "Konkan Packaging Works", gstin: "27FICTV1002A1Z0", active: true } as AppState["vendors"][number]);
    user = { username: "konkan.supplier", role: "supplier", vendorId: "V-1002" };
    const r = await submitInvoice(payload({ vendorName: "Konkan Packaging Works", vendorGstin: "27FICTV1002A1Z0" }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("already in use") });
    expect(state.invoices[0].vendorId).toBe("V-1001");
  });

  it("clerk sends a flagged invoice back to the supplier; the supplier sees the note, re-uploads, and the task closes", async () => {
    // A flagged, seeded invoice (no submittedBy) whose finding belongs to the buyer, with internal work already started.
    state.invoices.push({ ...payloadInvoice(), status: "pending_owner", verdict: "flag" });
    state.findings.push({ id: "F-1", invoiceId: "INV-7781", lineNo: 1, kind: "price", verdict: "flag", message: "Price differs", rootCause: "PO not updated after contract change", owner: "Buyer", smallestFix: "Amend the PO" });
    const clerk = { username: "priya.clerk", role: "clerk" as const };
    expect(requestFix(state, clerk, "INV-7781", "F-1").ok).toBe(true);
    // Before it is sent back, the supplier cannot replace it.
    expect((await submitInvoice(payload())).ok).toBe(false);

    expect(requestFix(state, clerk, "INV-7781", "F-1", undefined, { toSupplier: true, note: "short" }).ok).toBe(false);
    expect(requestFix(state, clerk, "INV-7781", "F-1", undefined, { toSupplier: true, note: "Reissue at the contract price of ₹412 per kg" }).ok).toBe(true);
    expect(requestFix(state, clerk, "INV-7781", "F-1", undefined, { toSupplier: true, note: "Reissue at the contract price of ₹412 per kg" }).ok).toBe(false);

    const view = buildSupplierView(state, "INV-7781", user!)!;
    expect(view.actions.map((a) => a.what)).toEqual(["Line 1: Reissue at the contract price of ₹412 per kg"]);
    expect(view.headline).toMatch(/Action needed from you/);

    const r = await submitInvoice(payload());
    expect(r).toEqual({ ok: true, invoiceId: "INV-7781" });
    const supplierTask = state.tasks.find((t) => t.owner === "Supplier")!;
    expect(supplierTask).toMatchObject({ status: "done", completedBy: "vihar.supplier" });
    expect(state.tasks.find((t) => t.owner === "Buyer")!.status).toBe("requested");
    expect(state.auditEvents.map((e) => e.action)).toEqual(expect.arrayContaining(["sent_to_supplier", "invoice_resubmitted", "task_done"]));
  });

  it("ignores a source reference that is not an allowed file", async () => {
    await submitInvoice(payload({ source: "demo:../../package.json" }));
    expect(state.invoices[0].sourceFile).toBeUndefined();
  });
});
