// What a supplier may see about one of their invoices. Built field by field from an allow-list: no internal names,
// owners, reasons, audit detail, approval level or other suppliers' data can reach this object.
import { fmtDate, fmtDateTime } from "./format";
import { paymentDueDate, paymentTermsDays } from "./terms";
import type { AppState, Finding } from "./types";

export interface SupplierStep { title: string; detail?: string; when?: string; state: "done" | "current" | "upcoming" }
export interface SupplierAction { lineNo?: number; what: string }
export interface SupplierInvoiceView {
  id: string;
  poId: string;
  invoiceDate: string;
  receivedOn: string;
  total: number;
  /** One plain sentence for the top of the page. */
  headline: string;
  steps: SupplierStep[];
  /** What the supplier has to correct, with the expected value. Empty when nothing is needed from them. */
  actions: SupplierAction[];
  payment?: { dueOn: string; termsDays: number; paid: boolean };
}

const price = (text: string | undefined) => text?.match(/₹[\d,]+(?:\.\d+)?/)?.[0];

/** The supplier-facing instruction for a finding the supplier owns, or undefined when it is not something they can act on. */
function actionFor(f: Finding): SupplierAction | undefined {
  const line = f.lineNo ? `Line ${f.lineNo}: ` : "";
  switch (f.rootCause) {
    case "Invoice tax rate differs from PO tax code":
      return { lineNo: f.lineNo, what: `${line}Reissue the invoice with tax at ${f.expected ?? "the rate on the purchase order"}. It shows ${f.actual ?? "a different rate"}.` };
    case "Price differs from both PO and contract": {
      const fix = price(f.smallestFix);
      return { lineNo: f.lineNo, what: `${line}Send a credit note or a corrected invoice at ${fix ?? "the contract price"} per unit. The invoice shows ${f.actual ?? "a different price"} per unit.` };
    }
    case "Invoice arithmetic does not add up":
      return { lineNo: f.lineNo, what: `${line}Correct the amount to ${f.expected ?? "the calculated value"}. The invoice shows ${f.actual ?? "a different amount"}.` };
    case "Billed for undelivered quantity":
      return { lineNo: f.lineNo, what: `${line}Our records show ${f.expected ?? "a smaller quantity"} but you billed ${f.actual ?? "more"}. Send a corrected invoice or a credit note, or send proof of delivery for the difference.` };
    case "Unit of measure cannot be converted":
      return { lineNo: f.lineNo, what: `${line}Bill in ${f.expected ?? "the unit on the purchase order"}. The invoice uses ${f.actual ?? "a different unit"}.` };
    case "No valid PO":
    case "PO belongs to a different supplier":
      return { what: "Quote a valid purchase order number that was raised on your company." };
    default:
      return f.owner === "Supplier" && f.kind !== "missing_receipt" ? { lineNo: f.lineNo, what: `${line}Send a corrected invoice.` } : undefined;
  }
}

export function buildSupplierView(s: AppState, invoiceId: string, user: { username: string; vendorId?: string }): SupplierInvoiceView | undefined {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv || !(inv.vendorId === user.vendorId || inv.submittedBy === user.username)) return undefined;

  const vendor = s.vendors.find((v) => v.id === inv.vendorId);
  const findings = s.findings.filter((f) => f.invoiceId === inv.id && f.verdict !== "approve");
  const tasks = s.tasks.filter((t) => t.invoiceId === inv.id);
  const internalOpen = tasks.filter((t) => t.status === "requested" && t.owner !== "Supplier").length;
  const done = tasks.filter((t) => t.status === "done");
  const actions = inv.status === "pending_owner" || inv.status === "blocked"
    ? findings.filter((f) => f.owner === "Supplier").map(actionFor).filter((x): x is SupplierAction => !!x)
    : [];
  const notYetDelivered = findings.some((f) => f.rootCause === "Billed before delivery or receipt");
  const events = s.auditEvents.filter((e) => e.invoiceId === inv.id);
  const when = (action: string, fallback: string) => {
    const e = events.find((x) => x.action === action);
    return e ? fmtDateTime(e.at) : fmtDate(fallback);
  };
  const confirmedDuplicate = inv.duplicateDecision?.decision === "duplicate" ? inv.duplicateDecision.matchedInvoiceId : undefined;

  const dueOn = paymentDueDate(inv, vendor);
  const terms = paymentTermsDays(vendor);
  const termsText = `${terms}-day terms`;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const steps: SupplierStep[] = [{ title: "Received", when: fmtDate(inv.receivedOn), state: "done" }];
  let headline = "Received. We are checking it.";

  if (inv.verdict) {
    steps.push({
      title: "Checked against PO and goods receipt", when: when("match_run", inv.receivedOn), state: "done",
      detail: findings.length || tasks.length ? undefined : "No differences found.",
    });
  }

  const reviewing = inv.status === "pending_owner" || inv.status === "blocked";
  if (confirmedDuplicate) {
    headline = `Closed as a duplicate of ${confirmedDuplicate}. No payment will be made for this copy.`;
    steps.push({ title: "Closed as a duplicate", detail: `This invoice repeats ${confirmedDuplicate}.`, state: "current" });
  } else if (reviewing) {
    if (actions.length) {
      const also = internalOpen ? ` ${plural(internalOpen, "internal action")} also pending.` : "";
      headline = `Action needed from you: ${plural(actions.length, "correction")}.${also}`;
      steps.push({ title: "Action needed from you", detail: `${plural(actions.length, "item")} to correct, listed below.${also}`, state: "current" });
    } else if (internalOpen) {
      headline = `${plural(internalOpen, "internal action")} pending. Nothing needed from you.`;
      steps.push({ title: `${plural(internalOpen, "internal action")} pending`, detail: "Nothing needed from you.", state: "current" });
    } else {
      headline = "Under review by Plant X accounts payable. Nothing needed from you.";
      steps.push({
        title: "Under review",
        detail: notYetDelivered ? "This invoice arrived before the goods. We will check it again once delivery is recorded. Nothing needed from you." : "Nothing needed from you.",
        state: "current",
      });
    }
    if (!notYetDelivered || actions.length || internalOpen) steps.push({ title: "Approval", state: "upcoming" });
  } else if (done.length && inv.verdict === "approve" && !["received"].includes(inv.status)) {
    const last = done.map((t) => t.completedAt ?? "").sort().pop();
    steps.push({ title: "Internal actions completed", detail: `${plural(done.length, "action")} done. The invoice now matches.`, when: last ? fmtDateTime(last) : undefined, state: "done" });
  }

  switch (inv.status) {
    case "pending_approval":
      headline = "Checked and waiting for approval. Nothing needed from you.";
      steps.push({ title: "Waiting for approval", detail: "Nothing needed from you.", state: "current" });
      break;
    case "sent_back":
      headline = "Under additional internal review. Nothing needed from you.";
      steps.push({ title: "Under additional review", detail: "Nothing needed from you.", state: "current" });
      break;
    case "rejected":
      headline = "This invoice was not approved. Please contact Plant X accounts payable.";
      steps.push({ title: "Not approved", detail: "Please contact Plant X accounts payable for the reason.", when: inv.decision ? fmtDateTime(inv.decision.at) : undefined, state: "done" });
      break;
    case "approved":
      headline = `Approved. Payment scheduled for ${fmtDate(dueOn)} (${termsText}).`;
      steps.push({ title: "Approved", when: inv.decision ? fmtDateTime(inv.decision.at) : fmtDate(inv.resolvedOn), state: "done" });
      steps.push({ title: `Payment scheduled for ${fmtDate(dueOn)} (${termsText})`, state: "current" });
      break;
    case "paid":
      headline = `Paid on ${fmtDate(inv.resolvedOn)}.`;
      steps.push({ title: "Approved", state: "done" });
      steps.push({ title: `Paid on ${fmtDate(inv.resolvedOn)}`, state: "done" });
      break;
    default:
      if (inv.status === "received") steps.push({ title: "Checked against PO and goods receipt", state: "current" });
  }
  if (!["approved", "paid"].includes(inv.status) && !confirmedDuplicate && inv.status !== "rejected") {
    steps.push({ title: `Payment due ${fmtDate(dueOn)} (${termsText}) once approved`, state: "upcoming" });
  }

  return {
    id: inv.id, poId: inv.poId ?? "", invoiceDate: inv.invoiceDate, receivedOn: inv.receivedOn, total: inv.total,
    headline, steps, actions,
    payment: inv.status === "rejected" || confirmedDuplicate ? undefined : { dueOn, termsDays: terms, paid: inv.status === "paid" },
  };
}
