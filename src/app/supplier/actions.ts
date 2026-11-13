"use server";
import { resolveSource } from "@/lib/demo-docs";
import { DEMO_TODAY } from "@/lib/constants";
import { fmtRupees } from "@/lib/format";
import { appendAudit } from "@/lib/audit";
import { matchInState } from "@/lib/matching";
import { getSessionUser } from "@/lib/session";
import { getState, updateState } from "@/lib/store";
import { UNKNOWN_VENDOR } from "@/lib/status";
import { closeSupplierTasks } from "@/lib/workflow";
import type { Invoice, InvoiceLine } from "@/lib/types";

export interface SubmitLine { itemCode?: string; description: string; qty: number; unit: string; unitPrice: number; amount: number }
export interface SubmitPayload {
  source: string;
  vendorName: string;
  vendorGstin: string;
  invoiceNumber: string;
  invoiceDate: string; // yyyy-mm-dd
  poNumber: string;
  lines: SubmitLine[];
  subtotal: number;
  taxRatePct: number;
  taxAmount: number;
  total: number;
}
export type SubmitResult = { ok: true; invoiceId: string } | { ok: false; error: string };

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const text = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** Creates the invoice, then runs the match engine, which sets the verdict and status. */
export async function submitInvoice(p: SubmitPayload): Promise<SubmitResult> {
  const user = await getSessionUser();
  if (!user || user.role !== "supplier") return { ok: false, error: "Please sign in as a supplier." };
  if (!p || typeof p !== "object") return { ok: false, error: "The invoice details were not received. Please try again." };

  const id = text(p.invoiceNumber, 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9\/\-]{2,39}$/.test(id)) return { ok: false, error: "Enter a valid invoice number (letters, digits, - or /)." };
  if (typeof p.invoiceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.invoiceDate) || Number.isNaN(Date.parse(p.invoiceDate))) return { ok: false, error: "Enter the invoice date as DD-MM-YYYY." };
  const po = text(p.poNumber, 20);
  if (!/^\d{6,12}$/.test(po)) return { ok: false, error: "Enter the PO number (digits only)." };
  if (!Array.isArray(p.lines) || p.lines.length === 0 || p.lines.length > 50) return { ok: false, error: "The invoice needs at least one line item." };
  for (const [i, l] of p.lines.entries()) {
    if (!l || typeof l !== "object") return { ok: false, error: `Line ${i + 1}: the line details are missing.` };
    if (!text(l.description) || !text(l.unit, 12)) return { ok: false, error: `Line ${i + 1}: description and unit are required.` };
    if (!isNum(l.qty) || l.qty <= 0 || !isNum(l.unitPrice) || !isNum(l.amount)) return { ok: false, error: `Line ${i + 1}: quantity, rate and amount must be numbers.` };
  }
  for (const [name, v] of [["subtotal", p.subtotal], ["tax rate", p.taxRatePct], ["tax amount", p.taxAmount], ["total", p.total]] as const) {
    if (!isNum(v)) return { ok: false, error: `Enter the ${name} as a number.` };
  }
  const source = p.source && resolveSource(p.source) ? p.source : undefined;

  return updateState<SubmitResult>((s) => {
    const existing = s.invoices.find((i) => i.id === id);
    // Only the vendor's own invoice can be replaced. Another vendor's number is refused without revealing its status.
    const own = !!existing && (existing.vendorId === user.vendorId || existing.submittedBy === user.username);
    if (existing && !own) return { ok: false, error: `Invoice number ${id} is already in use. Check the number on your invoice.` };
    // A supplier may correct their own submission until internal work has started on it (an owner task, approval or payment).
    // Tasks waiting on the supplier do not count: sending the corrected invoice is how they get done.
    const untouched = !!existing?.submittedBy && ["received", "matched", "pending_owner", "pending_approval", "blocked"].includes(existing.status)
      && !s.tasks.some((t) => t.invoiceId === id && (t.status === "done" || t.owner !== "Supplier"));
    // Once a correction is asked of the supplier (the clerk sent it back, or a finding is theirs to fix), they may always re-upload.
    const correctionAsked = !!existing && ["pending_owner", "blocked"].includes(existing.status) && (
      s.tasks.some((t) => t.invoiceId === id && t.status === "requested" && t.owner === "Supplier")
      || s.findings.some((f) => f.invoiceId === id && f.owner === "Supplier" && f.verdict !== "approve")
    );
    const replaceable = untouched || correctionAsked;
    if (existing && !replaceable) return { ok: false, error: `Invoice ${id} has already been submitted and is ${existing.status.replace("_", " ")}.` };

    const gstin = text(p.vendorGstin, 15).toUpperCase();
    const vname = text(p.vendorName, 80);
    const vendor = s.vendors.find((v) => v.gstin === gstin) ?? s.vendors.find((v) => v.name.toLowerCase() === vname.toLowerCase());

    const lines: InvoiceLine[] = p.lines.map((l, i) => ({
      lineNo: i + 1,
      itemCode: text(l.itemCode, 30) || undefined,
      description: text(l.description),
      qty: l.qty,
      uom: text(l.unit, 12),
      unitPrice: l.unitPrice,
      taxRatePct: p.taxRatePct,
      amount: l.amount,
    }));
    const inv: Invoice = {
      id,
      vendorId: vendor?.id ?? UNKNOWN_VENDOR,
      poId: po,
      invoiceDate: p.invoiceDate,
      receivedOn: DEMO_TODAY,
      currency: "INR",
      lines,
      subtotal: p.subtotal,
      tax: p.taxAmount,
      total: p.total,
      status: "received",
      sourceFile: source,
      submittedBy: user.username,
      ...(vendor ? {} : { printedVendor: { name: vname, gstin: gstin || undefined } }),
    };
    if (existing) s.invoices[s.invoices.indexOf(existing)] = inv;
    else s.invoices.push(inv);
    s.findings = s.findings.filter((f) => f.invoiceId !== id);
    appendAudit(s, {
      actor: user.username, action: existing ? "invoice_resubmitted" : "invoice_submitted", invoiceId: id,
      detail: `${existing ? "Corrected invoice" : "Invoice"} submitted${source ? ` from ${source.replace(/^(demo|upload):/, "")}` : ""}, total ${fmtRupees(p.total)}.`,
      before: existing ? `${existing.status.replace("_", " ")}` : "Not on file", after: "Submitted",
    });
    if (existing) closeSupplierTasks(s, id, user.username);
    matchInState(s, id, user.username);
    return { ok: true, invoiceId: id };
  });
}
