// Workflow service: owner tasks, simulated ERP fixes, release and approval, segregation of duties.
// Every rule is enforced here, not in the UI. Each function takes the state, who is acting, and the request;
// a refusal returns a readable message and writes a "refused" audit event, so a direct call cannot get round the rules.
import { uomFactor } from "../engine/match";
import { appendAudit } from "./audit";
import { DEMO_TODAY, MIN_REASON_CHARS, TASK_DUE_DAYS, THRESHOLDS } from "./constants";
import { addDaysIso, fmtDate, fmtRupees } from "./format";
import { matchInState } from "./matching";
import { bandFor, routeText, type ApprovalBand } from "./routing";
import { paymentDueDate, paymentTermsDays } from "./terms";
import type { AppState, ApproverLevel, ErpFix, Finding, Invoice, Role, Task } from "./types";

export interface Actor { username: string; role: Role; approverLevel?: ApproverLevel }
export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(r3(n)));

/** Refuse, and record the refusal in the audit trail. */
function refuse(s: AppState, a: Actor, action: string, invoiceId: string | undefined, error: string): { ok: false; error: string } {
  appendAudit(s, { actor: a.username, role: a.role, action: "refused", invoiceId, detail: `Refused ${action}: ${error}` });
  return { ok: false, error };
}

function touch(inv: Invoice, username: string) {
  inv.touchedBy = [...new Set([...(inv.touchedBy ?? []), username])];
}

export const OPEN_FOR_FIXES = ["pending_owner", "blocked"] as const;
const isOpenForFixes = (inv: Invoice) => (OPEN_FOR_FIXES as readonly string[]).includes(inv.status);
const requested = (s: AppState, invoiceId: string) => s.tasks.filter((t) => t.invoiceId === invoiceId && t.status === "requested");

const sameFinding = (t: Task, f: Finding) => t.kind === f.kind && t.lineNo === f.lineNo && t.rootCause === f.rootCause;

// ------------------------------------------------------------------ A. owner tasks
/** What a simulated ERP update would do for this finding, or undefined when no simulation exists for it. */
function planFix(s: AppState, inv: Invoice, f: Finding): ErpFix | undefined {
  if (f.owner === "Supplier") return { type: "supplier" };
  const po = s.purchaseOrders.find((p) => p.id === inv.poId);
  const line = inv.lines.find((l) => l.lineNo === f.lineNo);
  if (!po || !line) return undefined;
  const poLine = po.lines.find((p) => (line.itemCode ? p.itemCode === line.itemCode : p.description.toLowerCase() === line.description.toLowerCase()));
  if (!poLine) return undefined;
  const conv = uomFactor(s.uomRules, poLine.itemCode, line.uom, poLine.uom);
  if (!conv) return undefined;

  if (f.kind === "price" && f.rootCause === "PO not updated after contract change") {
    return { type: "po_price", poId: po.id, poLineNo: poLine.lineNo, itemCode: poLine.itemCode, from: poLine.unitPrice, to: Math.round((line.unitPrice / conv.factor) * 100) / 100 };
  }
  if ((f.kind === "quantity" && f.rootCause === "Goods receipt under-posted") || (f.kind === "missing_receipt" && f.rootCause === "Goods receipt not posted")) {
    const received = s.goodsReceipts.filter((g) => g.poId === po.id).flatMap((g) => g.lines).filter((l) => l.lineNo === poLine.lineNo).reduce((a, l) => a + l.qtyReceived, 0);
    const qty = r3(line.qty * conv.factor - received);
    if (qty <= 0) return undefined;
    return { type: "post_receipt", poId: po.id, poLineNo: poLine.lineNo, itemCode: poLine.itemCode, qty, uom: poLine.uom };
  }
  return undefined;
}

/**
 * The clerk raises a task for the owner named on a Flag or Block finding.
 * With `toSupplier`, the task goes to the supplier instead (whoever owns the finding), carrying the clerk's note:
 * the supplier sees the note, fixes the invoice and uploads it again under the same number, which closes the task.
 */
export function requestFix(
  s: AppState, a: Actor, invoiceId: string, findingId: string, at = new Date().toISOString(),
  opts: { toSupplier?: boolean; note?: string } = {},
): Result<{ taskId: string }> {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: "That invoice was not found." };
  if (a.role !== "clerk") return refuse(s, a, "request fix", invoiceId, "Only an AP clerk can request a fix from an owner.");
  if (!isOpenForFixes(inv)) return { ok: false, error: "A fix can be requested only while the invoice is flagged or blocked." };
  const f = s.findings.find((x) => x.id === findingId && x.invoiceId === invoiceId);
  if (!f) return { ok: false, error: "That finding was not found. Re-run the match and try again." };
  if (f.verdict === "approve") return { ok: false, error: "This finding needs no action." };
  if (f.kind === "duplicate") return { ok: false, error: "Use Confirm duplicate or Not a duplicate for this finding." };
  const toSupplier = !!opts.toSupplier;
  const owner = toSupplier ? "Supplier" : f.owner;
  const note = toSupplier ? String(opts.note ?? "").trim().slice(0, 500) : undefined;
  if (toSupplier && (note ?? "").length < MIN_REASON_CHARS) return { ok: false, error: "Tell the supplier what to correct, in a few words. They see this note." };
  if (s.tasks.some((t) => t.invoiceId === invoiceId && t.status === "requested" && sameFinding(t, f) && t.owner === owner)) {
    return { ok: false, error: toSupplier ? "This finding has already been sent to the supplier." : "A fix has already been requested for this finding." };
  }

  const next = s.tasks.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, "")) || 0), 0) + 1;
  const task: Task = {
    id: `T-${String(next).padStart(4, "0")}`, invoiceId, findingId, kind: f.kind, lineNo: f.lineNo, rootCause: f.rootCause, owner,
    title: note ?? f.smallestFix, status: "requested", dueOn: addDaysIso(DEMO_TODAY, TASK_DUE_DAYS), createdAt: at, createdBy: a.username,
    fix: toSupplier ? { type: "supplier" } : planFix(s, inv, f), ...(note ? { note } : {}),
  };
  s.tasks.push(task);
  touch(inv, a.username);
  appendAudit(s, {
    actor: a.username, action: toSupplier ? "sent_to_supplier" : "task_requested", invoiceId,
    detail: toSupplier
      ? `Sent to the supplier for correction${f.lineNo ? ` (line ${f.lineNo})` : ""}: ${note} Due ${fmtDate(task.dueOn)}.`
      : `Requested a fix from ${f.owner}${f.lineNo ? ` for line ${f.lineNo}` : ""}: ${f.rootCause}. Due ${fmtDate(task.dueOn)}.`,
    before: "No task", after: `${task.id} requested from ${owner}`,
  }, at);
  return { ok: true, taskId: task.id };
}

/** Close the supplier's tasks when the supplier sends a corrected invoice. */
export function closeSupplierTasks(s: AppState, invoiceId: string, actor: string, at = new Date().toISOString()) {
  for (const t of s.tasks.filter((x) => x.invoiceId === invoiceId && x.status === "requested" && x.owner === "Supplier")) {
    t.status = "done"; t.completedAt = at; t.completedBy = actor; t.resolution = "Supplier sent a corrected invoice.";
    appendAudit(s, { actor, action: "task_done", invoiceId, detail: `${t.id} closed: the supplier sent a corrected invoice.`, before: `${t.id} requested`, after: `${t.id} done` }, at);
  }
}

/**
 * Demo control: apply the suggested fix to the seed data as the owner would in the ERP, then re-match.
 * Supplier tasks have no simulation (they wait for the supplier's corrected invoice).
 */
export function simulateErpUpdate(s: AppState, a: Actor, taskId: string, at = new Date().toISOString()): Result<{ verdict: string; summary: string }> {
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: "That task was not found." };
  const inv = s.invoices.find((i) => i.id === task.invoiceId);
  if (!inv) return { ok: false, error: "That invoice was not found." };
  if (a.role !== "clerk") return refuse(s, a, "simulate ERP update", inv.id, "Only an AP clerk can run the demo ERP update.");
  if (task.status !== "requested") return { ok: false, error: `${task.id} is already done.` };
  if (!isOpenForFixes(inv)) return { ok: false, error: "The invoice is no longer waiting on owner actions." };
  const fix = task.fix;
  if (!fix) return { ok: false, error: `There is no simulated update for this fix. ${task.owner} has to act outside this system.` };
  if (fix.type === "supplier") return { ok: false, error: "This is waiting for the supplier's corrected invoice. No ERP update applies." };

  let done: string;
  let before: string;
  let after: string;
  if (fix.type === "po_price") {
    const po = s.purchaseOrders.find((p) => p.id === fix.poId);
    const line = po?.lines.find((l) => l.lineNo === fix.poLineNo);
    if (!po || !line) return { ok: false, error: `PO ${fix.poId} line ${fix.poLineNo} was not found.` };
    before = `PO ${po.id} line ${line.lineNo} ${line.itemCode}: ${fmtRupees(line.unitPrice)} per ${line.uom}`;
    line.unitPrice = fix.to;
    after = `PO ${po.id} line ${line.lineNo} ${line.itemCode}: ${fmtRupees(line.unitPrice)} per ${line.uom}`;
    done = `PO ${po.id} line ${line.lineNo} price amended from ${fmtRupees(fix.from)} to ${fmtRupees(fix.to)}.`;
  } else {
    const grId = String(5000009000 + s.goodsReceipts.filter((g) => Number(g.id) >= 5000009000).length + 1);
    const total = (poId: string, lineNo: number) => s.goodsReceipts.filter((g) => g.poId === poId).flatMap((g) => g.lines).filter((l) => l.lineNo === lineNo).reduce((x, l) => x + l.qtyReceived, 0);
    const was = total(fix.poId, fix.poLineNo);
    s.goodsReceipts.push({ id: grId, poId: fix.poId, receivedOn: DEMO_TODAY, receivedBy: "Warehouse (simulated)", lines: [{ lineNo: fix.poLineNo, qtyReceived: fix.qty, uom: fix.uom }] });
    before = `PO ${fix.poId} line ${fix.poLineNo} ${fix.itemCode}: ${num(was)} ${fix.uom} received`;
    after = `PO ${fix.poId} line ${fix.poLineNo} ${fix.itemCode}: ${num(r3(was + fix.qty))} ${fix.uom} received`;
    done = `Goods receipt ${grId} posted for ${num(fix.qty)} ${fix.uom} against PO ${fix.poId} line ${fix.poLineNo}.`;
  }

  touch(inv, a.username);
  appendAudit(s, { actor: a.username, action: "erp_simulated", invoiceId: inv.id, detail: `Demo: simulated ERP update by ${task.owner}. ${done}`, before, after }, at);
  task.status = "done"; task.completedAt = at; task.completedBy = a.username; task.resolution = done;
  appendAudit(s, { actor: a.username, action: "task_done", invoiceId: inv.id, detail: `${task.id} done (${task.owner}).`, before: `${task.id} requested`, after: `${task.id} done` }, at);

  matchInState(s, inv.id, a.username); // logs "rematch", and "routed" when the invoice has just become clean
  return { ok: true, verdict: inv.verdict ?? "approve", summary: done };
}

// ------------------------------------------------------------------ B. thresholds, release and approval
export interface SodCheck { ok: boolean; label: string; message: string }

/** Every rule that decides whether this person may approve this invoice. The same list drives the screen and the refusal. */
export function approvalChecks(s: AppState, a: Actor, inv: Invoice): SodCheck[] {
  const band: ApprovalBand = bandFor(inv.total);
  const involved = inv.submittedBy === a.username || (inv.touchedBy ?? []).includes(a.username) || inv.duplicateDecision?.by === a.username;
  const levelOk = band === "L1" ? a.approverLevel === "L1" || a.approverLevel === "L2" : band === "L2" ? a.approverLevel === "L2" : false;
  return [
    { ok: a.role === "approver", label: "You are signed in as an approver", message: a.role === "supplier" ? "A supplier cannot approve invoices." : a.role === "clerk" ? "The AP clerk who handles an invoice cannot approve it." : "Only an approver can decide on this invoice." },
    { ok: !involved, label: "You did not submit, edit, release or raise tasks on this invoice", message: "You worked on this invoice, so a different approver has to decide on it." },
    {
      ok: levelOk,
      label: band === "clerk" ? "Amount is above the clerk release limit" : `Amount ${fmtRupees(inv.total)} is within your limit`,
      message: band === "clerk"
        ? `Invoices up to ${fmtRupees(THRESHOLDS.clerkMax)} are released by the AP clerk and are not routed to approvers.`
        : `${fmtRupees(inv.total)} is above the ${fmtRupees(THRESHOLDS.l1Max)} limit for Approver L1. Approver L2 has to decide.`,
    },
    { ok: !(inv.rejectedBy ?? []).includes(a.username), label: "You did not reject it earlier in this cycle", message: "You rejected this invoice earlier, so a different approver has to decide on it." },
  ];
}

function readyForDecision(s: AppState, inv: Invoice): string | undefined {
  if (inv.status !== "pending_approval") return `This invoice is not waiting for approval (it is ${inv.status.replace("_", " ")}).`;
  if (inv.verdict !== "approve") return "This invoice still has unresolved findings.";
  if (requested(s, inv.id).length) return "This invoice still has open owner tasks.";
  return undefined;
}

/** Clerk release for a clean invoice within the clerk limit. */
export function releaseInvoice(s: AppState, a: Actor, invoiceId: string, at = new Date().toISOString()): Result {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: "That invoice was not found." };
  if (a.role !== "clerk") return refuse(s, a, "release", invoiceId, "Only an AP clerk can release an invoice.");
  const why = readyForDecision(s, inv);
  if (why) return { ok: false, error: why };
  if (bandFor(inv.total) !== "clerk") return refuse(s, a, "release", invoiceId, `${fmtRupees(inv.total)} is above ${fmtRupees(THRESHOLDS.clerkMax)}, so an approver has to decide. ${routeText(inv.total)}.`);
  touch(inv, a.username);
  inv.status = "approved"; inv.resolvedOn = DEMO_TODAY;
  inv.decision = { outcome: "released", by: a.username, at };
  appendAudit(s, { actor: a.username, action: "released", invoiceId, detail: `Released by the AP clerk: clean match, ${fmtRupees(inv.total)} is within the clerk limit of ${fmtRupees(THRESHOLDS.clerkMax)}.`, before: "Awaiting clerk release", after: "Approved" }, at);
  markReady(s, inv, a.username, at);
  return { ok: true };
}

function markReady(s: AppState, inv: Invoice, actor: string, at: string) {
  const vendor = s.vendors.find((v) => v.id === inv.vendorId);
  appendAudit(s, {
    actor, action: "ready_for_payment", invoiceId: inv.id,
    detail: `Ready for payment. Due ${fmtDate(paymentDueDate(inv, vendor))} (${paymentTermsDays(vendor)} days from the invoice date). No payment is made by this system.`,
    before: "Approved", after: "Ready for payment",
  }, at);
}

export type Decision = "approve" | "reject" | "send_back";

/** An approver's decision. Reject and send-back need a reason. */
export function decideApproval(s: AppState, a: Actor, invoiceId: string, decision: Decision, reason: string, at = new Date().toISOString()): Result {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: "That invoice was not found." };
  if (decision !== "approve" && decision !== "reject" && decision !== "send_back") return { ok: false, error: "Choose Approve, Reject or Send back." };
  const verb = decision === "approve" ? "approve" : decision === "reject" ? "reject" : "send back";

  const checks = approvalChecks(s, a, inv);
  // Rejecting or sending back is not blocked by "you worked on it" or "you rejected it earlier"; role and limit still apply.
  const applicable = decision === "approve" ? checks : [checks[0], checks[2]];
  const failed = applicable.find((c) => !c.ok);
  if (failed) return refuse(s, a, verb, invoiceId, failed.message);

  const why = readyForDecision(s, inv);
  if (why) return { ok: false, error: why };
  const text = String(reason ?? "").trim();
  if (decision !== "approve" && text.length < MIN_REASON_CHARS) return { ok: false, error: `Give a reason of at least a few words to ${verb} an invoice. It is saved in the audit trail.` };

  const level = a.approverLevel;
  inv.decision = { outcome: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "sent_back", by: a.username, level, at, ...(text ? { reason: text.slice(0, 400) } : {}) };
  if (decision === "approve") {
    inv.status = "approved"; inv.resolvedOn = DEMO_TODAY;
    appendAudit(s, { actor: a.username, action: "approved", invoiceId, detail: `Approved by Approver ${level}. ${routeText(inv.total)}.`, before: "Awaiting approval", after: "Approved", ...(text ? { reason: text.slice(0, 400) } : {}) }, at);
    markReady(s, inv, a.username, at);
  } else if (decision === "reject") {
    inv.status = "rejected"; inv.rejectedBy = [...new Set([...(inv.rejectedBy ?? []), a.username])];
    appendAudit(s, { actor: a.username, action: "rejected", invoiceId, detail: `Rejected by Approver ${level}.`, before: "Awaiting approval", after: "Rejected", reason: text.slice(0, 400) }, at);
  } else {
    inv.status = "sent_back";
    appendAudit(s, { actor: a.username, action: "sent_back", invoiceId, detail: `Sent back to the AP clerk by Approver ${level}.`, before: "Awaiting approval", after: "Sent back", reason: text.slice(0, 400) }, at);
  }
  return { ok: true };
}

/** The clerk returns a rejected or sent-back invoice to the approval queue after dealing with the reason. */
export function reopenInvoice(s: AppState, a: Actor, invoiceId: string, reason: string, at = new Date().toISOString()): Result {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: "That invoice was not found." };
  if (a.role !== "clerk") return refuse(s, a, "reopen", invoiceId, "Only an AP clerk can return an invoice to approval.");
  if (inv.status !== "sent_back" && inv.status !== "rejected") return { ok: false, error: "Only a rejected or sent-back invoice can be reopened." };
  const text = String(reason ?? "").trim();
  if (text.length < MIN_REASON_CHARS) return { ok: false, error: "Give a reason of at least a few words. It is saved in the audit trail." };
  const was = inv.status;
  touch(inv, a.username);
  inv.status = "received";
  appendAudit(s, { actor: a.username, action: "reopened", invoiceId, detail: `Returned to the matching and approval queue after being ${was === "rejected" ? "rejected" : "sent back"}.`, before: was === "rejected" ? "Rejected" : "Sent back", after: "Reopened", reason: text.slice(0, 400) }, at);
  matchInState(s, invoiceId, a.username);
  return { ok: true };
}
