import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyChain } from "./audit";
import type { AppState, Invoice, InvoiceLine } from "./types";

vi.mock("server-only", () => ({}));
let state: AppState;
vi.mock("./store", async (orig) => ({ ...(await orig<typeof import("./store")>()), updateState: <T,>(fn: (s: AppState) => T) => fn(state) }));

import { matchInState } from "./matching";
import { bandFor, routeText } from "./routing";
import { buildSupplierView } from "./supplier-view";
import { approvalChecks, decideApproval, releaseInvoice, reopenInvoice, requestFix, simulateErpUpdate, closeSupplierTasks, type Actor } from "./workflow";

const clerk: Actor = { username: "priya.clerk", role: "clerk" };
const l1: Actor = { username: "neha.approver", role: "approver", approverLevel: "L1" };
const l2: Actor = { username: "rajesh.approver", role: "approver", approverLevel: "L2" };
const supplier: Actor = { username: "vihar.supplier", role: "supplier" };

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
const inv = (id: string) => state.invoices.find((i) => i.id === id)!;
const finding = (id: string, pred: (f: AppState["findings"][number]) => boolean) => state.findings.find((f) => f.invoiceId === id && pred(f))!;
const events = (id: string) => state.auditEvents.filter((e) => e.invoiceId === id).map((e) => e.action);

/** INV-7781 submitted, matched, both owner tasks requested and fixed: clean and routed. */
function goldenToClean() {
  state.invoices.push(demoInvoice("INV-7781"));
  matchInState(state, "INV-7781", "vihar.supplier");
  for (const f of state.findings.filter((x) => x.invoiceId === "INV-7781" && x.verdict !== "approve")) {
    const r = requestFix(state, clerk, "INV-7781", f.id);
    expect(r.ok).toBe(true);
  }
  for (const t of [...state.tasks]) {
    const r = simulateErpUpdate(state, clerk, t.id);
    expect(r.ok).toBe(true);
  }
}

beforeEach(async () => {
  const { loadSeed } = await import("./store");
  state = loadSeed();
});

describe("routing bands", () => {
  it("routes by amount: clerk up to Rs 1,00,000, L1 up to Rs 15,00,000, L2 above", () => {
    expect(bandFor(100000)).toBe("clerk");
    expect(bandFor(100000.01)).toBe("L1");
    expect(bandFor(1500000)).toBe("L1");
    expect(bandFor(1500000.01)).toBe("L2");
    expect(routeText(1062000)).toBe("Needs Approver L1: amount ₹10,62,000 > ₹1,00,000");
    expect(routeText(1964700)).toBe("Needs Approver L2: amount ₹19,64,700 > ₹15,00,000");
  });

  it("INV-7782 is released by the clerk, INV-7781 goes to Approver L1, seeded INV-6150 needs Approver L2", () => {
    state.invoices.push(demoInvoice("INV-7782"));
    matchInState(state, "INV-7782");
    expect(inv("INV-7782")).toMatchObject({ status: "pending_approval", verdict: "approve" });
    expect(bandFor(inv("INV-7782").total)).toBe("clerk");
    expect(state.auditEvents.find((e) => e.action === "routed" && e.invoiceId === "INV-7782")?.detail).toContain("Clerk can release");

    goldenToClean();
    expect(inv("INV-7781")).toMatchObject({ status: "pending_approval", verdict: "approve", total: 1062000 });
    expect(state.auditEvents.find((e) => e.action === "routed" && e.invoiceId === "INV-7781")?.detail).toContain("Needs Approver L1: amount ₹10,62,000 > ₹1,00,000");

    const big = inv("INV-6150");
    expect(big.total).toBe(1964700);
    matchInState(state, "INV-6150"); // the engine agrees it is clean
    expect(big).toMatchObject({ verdict: "approve", status: "pending_approval" });
    expect(bandFor(big.total)).toBe("L2");
  });
});

describe("golden journey (steps 3 to 6)", () => {
  it("runs end to end with no manual data edits and leaves an event for every action", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781", "vihar.supplier");
    const fs3 = state.findings.filter((f) => f.invoiceId === "INV-7781");
    expect(fs3.filter((f) => f.verdict !== "approve")).toHaveLength(2); // price (Buyer) and quantity (Warehouse); the UoM line clears itself

    const price = fs3.find((f) => f.kind === "price")!;
    const qty = fs3.find((f) => f.kind === "quantity")!;
    expect(requestFix(state, clerk, "INV-7781", price.id).ok).toBe(true);
    expect(requestFix(state, clerk, "INV-7781", qty.id).ok).toBe(true);
    expect(state.tasks.map((t) => [t.owner, t.status])).toEqual([["Buyer", "requested"], ["Warehouse", "requested"]]);

    // The supplier sees internal actions pending and nothing to do.
    const v1 = buildSupplierView(state, "INV-7781", { username: "vihar.supplier", vendorId: "V-1001" })!;
    expect(v1.headline).toBe("2 internal actions pending. Nothing needed from you.");
    expect(v1.actions).toEqual([]);

    // Simulated ERP updates change the data, then the invoice is re-matched automatically.
    const [tPrice, tQty] = state.tasks;
    const po = state.purchaseOrders.find((p) => p.id === "4500001234")!;
    expect(po.lines[0].unitPrice).toBe(398);
    const r1 = simulateErpUpdate(state, clerk, tPrice.id);
    expect(r1.ok).toBe(true);
    expect(po.lines[0].unitPrice).toBe(412);
    expect(inv("INV-7781").status).toBe("pending_owner"); // still waiting on the receipt
    const r2 = simulateErpUpdate(state, clerk, tQty.id);
    expect(r2.ok).toBe(true);
    const received = state.goodsReceipts.filter((g) => g.poId === "4500001234").flatMap((g) => g.lines).filter((l) => l.lineNo === 3).reduce((a, l) => a + l.qtyReceived, 0);
    expect(received).toBe(40);
    expect(inv("INV-7781")).toMatchObject({ verdict: "approve", status: "pending_approval" });
    expect(state.findings.filter((f) => f.invoiceId === "INV-7781" && f.verdict !== "approve")).toHaveLength(0);

    // Approver L1 approves.
    expect(decideApproval(state, l1, "INV-7781", "approve", "").ok).toBe(true);
    expect(inv("INV-7781")).toMatchObject({ status: "approved", resolvedOn: "2026-11-12" });

    // The audit trail holds every step, in order, and the chain is intact.
    const seen = events("INV-7781");
    for (const a of ["match_run", "task_requested", "erp_simulated", "task_done", "rematch", "routed", "approved", "ready_for_payment"]) expect(seen).toContain(a);
    expect(seen.indexOf("task_requested")).toBeLessThan(seen.indexOf("erp_simulated"));
    expect(seen.indexOf("routed")).toBeLessThan(seen.indexOf("approved"));
    expect(verifyChain(state.auditEvents)).toEqual({ ok: true, count: state.auditEvents.length });
    const approved = state.auditEvents.find((e) => e.action === "approved")!;
    expect(approved).toMatchObject({ actor: "neha.approver", role: "approver", before: "Awaiting approval", after: "Approved" });

    // The supplier now sees the approval and the payment date: invoice date + 45 days.
    const v2 = buildSupplierView(state, "INV-7781", { username: "vihar.supplier", vendorId: "V-1001" })!;
    expect(v2.headline).toMatch(/^Approved\. Payment scheduled for \d{2}-[A-Z][a-z]{2}-2026 \(45-day terms\)\.$/);
    expect(v2.steps.map((s) => s.title)).toContain("Checked against PO and goods receipt");
  });

  it("does not double-request a fix, and refuses a fix on a finding that needs no action", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    const price = finding("INV-7781", (f) => f.kind === "price");
    expect(requestFix(state, clerk, "INV-7781", price.id).ok).toBe(true);
    expect(requestFix(state, clerk, "INV-7781", price.id)).toMatchObject({ ok: false, error: expect.stringContaining("already been requested") });
    const uom = finding("INV-7781", (f) => f.kind === "uom");
    expect(requestFix(state, clerk, "INV-7781", uom.id)).toMatchObject({ ok: false });
  });

  it("a supplier-owned finding becomes a waiting-for-supplier task that the supplier's resubmission closes", () => {
    state.invoices.push(demoInvoice("INV-7786", "girnar.supplier"));
    matchInState(state, "INV-7786");
    const f = finding("INV-7786", (x) => x.owner === "Supplier");
    const r = requestFix(state, clerk, "INV-7786", f.id);
    expect(r.ok).toBe(true);
    const t = state.tasks[0];
    expect(t.fix).toEqual({ type: "supplier" });
    expect(simulateErpUpdate(state, clerk, t.id)).toMatchObject({ ok: false, error: expect.stringContaining("supplier") });
    const view = buildSupplierView(state, "INV-7786", { username: "vihar.supplier", vendorId: "V-1001" });
    expect(view).toBeUndefined(); // Girnar's invoice is not visible to Vihar
    closeSupplierTasks(state, "INV-7786", "vihar.supplier");
    expect(state.tasks[0]).toMatchObject({ status: "done", completedBy: "vihar.supplier" });
  });
});

describe("clerk release", () => {
  it("releases a clean invoice within Rs 1,00,000 and marks it ready for payment", () => {
    state.invoices.push(demoInvoice("INV-7782"));
    matchInState(state, "INV-7782");
    expect(releaseInvoice(state, clerk, "INV-7782").ok).toBe(true);
    expect(inv("INV-7782")).toMatchObject({ status: "approved", decision: { outcome: "released", by: "priya.clerk" } });
    expect(events("INV-7782")).toEqual(expect.arrayContaining(["released", "ready_for_payment"]));
  });
  it("refuses to release above the limit, and refuses a non-clerk", () => {
    goldenToClean();
    expect(releaseInvoice(state, clerk, "INV-7781")).toMatchObject({ ok: false, error: expect.stringContaining("approver has to decide") });
    state.invoices.push(demoInvoice("INV-7782"));
    matchInState(state, "INV-7782");
    expect(releaseInvoice(state, l1, "INV-7782")).toMatchObject({ ok: false });
    expect(inv("INV-7782").status).toBe("pending_approval");
  });
});

describe("segregation of duties: the service layer refuses, whatever the UI does", () => {
  const refusals = () => state.auditEvents.filter((e) => e.action === "refused");

  it("a supplier cannot approve", () => {
    goldenToClean();
    const r = decideApproval(state, supplier, "INV-7781", "approve", "");
    expect(r).toMatchObject({ ok: false, error: "A supplier cannot approve invoices." });
    expect(inv("INV-7781").status).toBe("pending_approval");
    expect(refusals().at(-1)).toMatchObject({ actor: "vihar.supplier", role: "supplier", invoiceId: "INV-7781" });
  });

  it("the clerk who handled the invoice cannot approve it", () => {
    goldenToClean();
    const r = decideApproval(state, clerk, "INV-7781", "approve", "");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("clerk") });
    expect(inv("INV-7781").status).toBe("pending_approval");
  });

  it("an approver who worked on the invoice cannot approve it", () => {
    goldenToClean();
    inv("INV-7781").touchedBy = [...(inv("INV-7781").touchedBy ?? []), "neha.approver"];
    expect(decideApproval(state, l1, "INV-7781", "approve", "")).toMatchObject({ ok: false, error: expect.stringContaining("worked on this invoice") });
    expect(decideApproval(state, l2, "INV-7781", "approve", "").ok).toBe(true); // a different approver can
  });

  it("the submitter of an invoice cannot approve it", () => {
    goldenToClean();
    inv("INV-7781").submittedBy = "neha.approver";
    expect(decideApproval(state, l1, "INV-7781", "approve", "")).toMatchObject({ ok: false });
  });

  it("an approver cannot approve an invoice they rejected earlier in the same cycle", () => {
    goldenToClean();
    expect(decideApproval(state, l1, "INV-7781", "reject", "Price evidence is missing from the file").ok).toBe(true);
    expect(inv("INV-7781").status).toBe("rejected");
    expect(reopenInvoice(state, clerk, "INV-7781", "Evidence attached to the PO amendment").ok).toBe(true);
    expect(inv("INV-7781").status).toBe("pending_approval");
    expect(decideApproval(state, l1, "INV-7781", "approve", "")).toMatchObject({ ok: false, error: expect.stringContaining("rejected this invoice earlier") });
    expect(inv("INV-7781").status).toBe("pending_approval");
    expect(decideApproval(state, l2, "INV-7781", "approve", "").ok).toBe(true);
  });

  it("L1 cannot approve above Rs 15,00,000, and L2 can", () => {
    matchInState(state, "INV-6150");
    expect(decideApproval(state, l1, "INV-6150", "approve", "")).toMatchObject({ ok: false, error: expect.stringContaining("Approver L2 has to decide") });
    expect(decideApproval(state, l1, "INV-6150", "reject", "Not for me to reject either, wrong level")).toMatchObject({ ok: false });
    expect(inv("INV-6150").status).toBe("pending_approval");
    expect(decideApproval(state, l2, "INV-6150", "approve", "").ok).toBe(true);
    expect(inv("INV-6150").status).toBe("approved");
  });

  it("an invoice inside the clerk limit is not an approver's to approve", () => {
    state.invoices.push(demoInvoice("INV-7782"));
    matchInState(state, "INV-7782");
    expect(decideApproval(state, l1, "INV-7782", "approve", "")).toMatchObject({ ok: false, error: expect.stringContaining("released by the AP clerk") });
  });

  it("cannot approve an invoice with open findings or open tasks", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    expect(decideApproval(state, l1, "INV-7781", "approve", "")).toMatchObject({ ok: false });
    expect(inv("INV-7781").status).toBe("pending_owner");
  });

  it("only a clerk can request fixes or run the ERP update", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781");
    const price = finding("INV-7781", (f) => f.kind === "price");
    expect(requestFix(state, l1, "INV-7781", price.id)).toMatchObject({ ok: false });
    expect(requestFix(state, supplier, "INV-7781", price.id)).toMatchObject({ ok: false });
    expect(state.tasks).toHaveLength(0);
    expect(requestFix(state, clerk, "INV-7781", price.id).ok).toBe(true);
    expect(simulateErpUpdate(state, supplier, state.tasks[0].id)).toMatchObject({ ok: false });
    expect(state.purchaseOrders.find((p) => p.id === "4500001234")!.lines[0].unitPrice).toBe(398);
  });

  it("every refusal is written to the audit trail and the chain stays intact", () => {
    goldenToClean();
    const before = refusals().length;
    decideApproval(state, supplier, "INV-7781", "approve", "");
    decideApproval(state, clerk, "INV-7781", "approve", "");
    expect(refusals().length).toBe(before + 2);
    expect(verifyChain(state.auditEvents).ok).toBe(true);
  });

  it("shows the same rules on screen as checks", () => {
    goldenToClean();
    expect(approvalChecks(state, l1, inv("INV-7781")).every((c) => c.ok)).toBe(true);
    expect(approvalChecks(state, supplier, inv("INV-7781")).some((c) => !c.ok)).toBe(true);
  });
});

describe("reasons are required", () => {
  it("rejecting and sending back need a reason; approving does not", () => {
    goldenToClean();
    expect(decideApproval(state, l1, "INV-7781", "reject", "")).toMatchObject({ ok: false, error: expect.stringContaining("reason") });
    expect(decideApproval(state, l1, "INV-7781", "send_back", "  short ")).toMatchObject({ ok: false });
    expect(inv("INV-7781").status).toBe("pending_approval");
    expect(decideApproval(state, l1, "INV-7781", "send_back", "Ask the buyer to confirm the amendment").ok).toBe(true);
    expect(inv("INV-7781").status).toBe("sent_back");
    expect(state.auditEvents.find((e) => e.action === "sent_back")?.reason).toBe("Ask the buyer to confirm the amendment");
  });

  it("returning to approval needs a reason, and re-matches", () => {
    goldenToClean();
    decideApproval(state, l1, "INV-7781", "send_back", "Ask the buyer to confirm the amendment");
    expect(reopenInvoice(state, clerk, "INV-7781", "")).toMatchObject({ ok: false });
    expect(reopenInvoice(state, clerk, "INV-7781", "Buyer confirmed by email").ok).toBe(true);
    expect(inv("INV-7781").status).toBe("pending_approval");
  });
});

describe("audit trail", () => {
  it("detects a changed record and names the first broken one", () => {
    goldenToClean();
    decideApproval(state, l1, "INV-7781", "approve", "");
    expect(verifyChain(state.auditEvents).ok).toBe(true);
    const copy = structuredClone(state.auditEvents);
    const target = copy[Math.floor(copy.length / 2)];
    target.detail = target.detail + " (edited)";
    const r = verifyChain(copy);
    expect(r).toMatchObject({ ok: false, brokenSeq: target.seq });
  });

  it("detects a deleted record and a reordered record", () => {
    goldenToClean();
    const gone = state.auditEvents.filter((e) => e.seq !== 3);
    expect(verifyChain(gone)).toMatchObject({ ok: false, brokenSeq: 4 });
    const swapped = [...state.auditEvents];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(verifyChain(swapped).ok).toBe(false);
  });

  it("each event carries actor, role, action, invoice, before/after, reason and a hash of the one before", () => {
    goldenToClean();
    decideApproval(state, l1, "INV-7781", "approve", "Evidence checked");
    const e = state.auditEvents.find((x) => x.action === "approved")!;
    expect(e).toMatchObject({ actor: "neha.approver", role: "approver", invoiceId: "INV-7781", before: "Awaiting approval", after: "Approved", reason: "Evidence checked" });
    expect(e.prevHash).toBe(state.auditEvents[e.seq - 2].hash);
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("supplier view leaks nothing internal", () => {
  const SECRETS = [
    "Priya", "Neha", "Rajesh", "priya.clerk", "neha.approver", "rajesh.approver", "Anand", "Meera", "Buyer", "Warehouse", "AP Clerk",
    "Approver L1", "Approver L2", "Simulated", "simulated", "touchedBy", "rejectedBy", "task", "Task", "Finding", "rootCause", "smallestFix",
    "Konkan", "Sahyadri", "Deccan", "Malabar", "Girnar", "V-1002", "V-1003", "V-1004", "V-1005", "V-1006",
  ];
  const view = (id: string, who = { username: "vihar.supplier", vendorId: "V-1001" }) => buildSupplierView(state, id, who);
  const text = (v: unknown) => JSON.stringify(v);

  it("at every stage of the golden journey, including a rejection reason typed by an approver", () => {
    state.invoices.push(demoInvoice("INV-7781"));
    matchInState(state, "INV-7781", "vihar.supplier");
    const stages: unknown[] = [view("INV-7781")];
    const price = finding("INV-7781", (f) => f.kind === "price");
    const qty = finding("INV-7781", (f) => f.kind === "quantity");
    requestFix(state, clerk, "INV-7781", price.id);
    requestFix(state, clerk, "INV-7781", qty.id);
    stages.push(view("INV-7781"));
    for (const t of [...state.tasks]) simulateErpUpdate(state, clerk, t.id);
    stages.push(view("INV-7781"));
    decideApproval(state, l1, "INV-7781", "reject", "Priya and Anand disagree about the Girnar contract, internal note");
    stages.push(view("INV-7781"));
    reopenInvoice(state, clerk, "INV-7781", "Reopened after talking to Meera in stores");
    decideApproval(state, l2, "INV-7781", "approve", "Fine by Rajesh");
    stages.push(view("INV-7781"));
    for (const v of stages) for (const w of SECRETS) expect(text(v), `"${w}" leaked`).not.toContain(w);
  });

  it("when the supplier must act, shows exactly what to fix with the expected value, and no internal names", () => {
    state.invoices.push(demoInvoice("INV-7785"), demoInvoice("INV-7786"));
    matchInState(state, "INV-7785");
    matchInState(state, "INV-7786");
    const tax = buildSupplierView(state, "INV-7785", { username: "malabar", vendorId: "V-1005" })!;
    expect(tax.actions[0].what).toContain("tax at 18%");
    expect(tax.actions[0].what).toContain("12%");
    const price = buildSupplierView(state, "INV-7786", { username: "girnar", vendorId: "V-1006" })!;
    expect(price.actions[0].what).toContain("₹18,200.00");
    expect(price.headline).toMatch(/^Action needed from you/);
    for (const v of [tax, price]) for (const w of ["Buyer", "Warehouse", "Priya", "Vihar", "V-1001"]) expect(text(v)).not.toContain(w);
  });

  it("does not show another supplier's invoice, or a different supplier's data on a wrong-supplier PO", () => {
    state.invoices.push(demoInvoice("INV-7782", "konkan.supplier"));
    expect(view("INV-7782")).toBeUndefined(); // Konkan's invoice, Vihar's login
    expect(view("INV-6120")).toBeUndefined();
    expect(buildSupplierView(state, "INV-7782", { username: "konkan.supplier", vendorId: "V-1002" })).toBeDefined();
  });

  it("uses the vendor's payment terms, 45 days by default", () => {
    state.invoices.push(demoInvoice("INV-7782"));
    matchInState(state, "INV-7782");
    releaseInvoice(state, clerk, "INV-7782");
    const v = buildSupplierView(state, "INV-7782", { username: "konkan.supplier", vendorId: "V-1002" })!;
    expect(v.payment).toMatchObject({ termsDays: 45, paid: false });
    state.vendors.find((x) => x.id === "V-1002")!.paymentTermsDays = 30;
    const v30 = buildSupplierView(state, "INV-7782", { username: "konkan.supplier", vendorId: "V-1002" })!;
    expect(v30.payment?.termsDays).toBe(30);
    expect(v30.headline).toContain("(30-day terms)");
  });
});
