// Stage 7: Payment Readiness Passport. The supplier-facing, RESTRICTED view of one invoice: where it is on the road to payment,
// what is holding it up, which internal team has to act, and whether the due date is at risk.
//
// Restricted means allow-list, not block-list. The passport is built field by field from a few safe inputs and every piece of
// text comes from a fixed template in this file. Nothing the engine wrote for staff (messages, root causes, evidence, risk
// signals, scores, predictions, task titles, employee names, other suppliers) is ever copied in, so it cannot leak by accident.
// Anything the templates do not recognise becomes the generic "additional verification" item.
import { DEFAULT_PAYMENT_TERMS_DAYS } from "../lib/constants";
import { addDaysIso, fmtDate } from "../lib/format";
import type { PlantPayEngine, PlantPayResult } from "./engine";
import { SourceUnavailableError } from "./connectors";
import { tasksFor } from "./integration";
import { workflowEventsFor } from "./workflowEvents";

export type MilestoneState = "done" | "current" | "blocked" | "upcoming";
export interface PassportMilestone { id: string; label: string; state: MilestoneState; note: string; date?: string }
export interface PassportBlocker { id: string; title: string; detail: string; team: string; supplierAction?: string }
export interface PassportAction { team: string; action: string; waitingSince?: string; waitingDays?: number }
export interface Passport {
  invoiceNumber: string; invoiceDate?: string; amountInr?: number; poNumber?: string; asOf: string;
  headline: string; tone: "good" | "wait" | "problem";
  milestones: PassportMilestone[]; blockers: PassportBlocker[]; actions: PassportAction[];
  paymentTermsDays?: number; dueDate?: string; daysToDue?: number; paidOn?: string;
  atRisk: { flag: boolean; reason: string };
}
/** Every key a passport may contain, at any depth. The leak test fails if a key outside this list appears. */
export const PASSPORT_ALLOWED_KEYS = new Set([
  "invoiceNumber", "invoiceDate", "amountInr", "poNumber", "asOf", "headline", "tone", "milestones", "blockers", "actions", "paymentTermsDays", "dueDate", "daysToDue", "paidOn", "atRisk",
  "id", "label", "state", "note", "date", "title", "detail", "team", "supplierAction", "action", "waitingSince", "waitingDays", "flag", "reason",
]);

/** At-risk rules (assumptions, shown on the page): unpaid and overdue; or due within 10 days with something still blocking; or due within 5 days and not yet approved. */
export const AT_RISK = { blockedWithinDays: 10, notApprovedWithinDays: 5 } as const;

const AP = "Accounts Payable";
interface Template { title: string; detail: string; team: string; action: string; supplierAction?: string }
const GENERIC: Template = { title: "Additional verification", detail: "Accounts Payable is completing an extra routine verification before this invoice can move on. You do not need to do anything unless we contact you.", team: AP, action: "Complete the verification step" };
const TEMPLATES: Record<string, Template> = {
  purchase_order: { title: "Purchase order match", detail: "We are matching this invoice to the purchase order.", team: "Procurement", action: "Confirm the purchase order for this invoice", supplierAction: "Check that the purchase order number printed on your invoice is correct." },
  vendor: { title: "Invoice details check", detail: "Accounts Payable is confirming the details on the invoice.", team: AP, action: "Confirm the invoice details" },
  price: { title: "Price confirmation", detail: "The invoice price is being confirmed against the purchase order and contract.", team: "Procurement", action: "Confirm the price against the purchase order and contract" },
  unit_of_measure: { title: "Unit of measure confirmation", detail: "The unit of measure on the invoice is being confirmed against the order.", team: "Procurement", action: "Confirm the unit of measure" },
  tax: { title: "Tax rate confirmation", detail: "The tax rate on the invoice is being confirmed.", team: "Procurement", action: "Confirm the tax rate" },
  contract: { title: "Contract terms confirmation", detail: "The invoice is being confirmed against the contract terms.", team: "Procurement", action: "Confirm the contract terms" },
  arithmetic: { title: "Invoice totals check", detail: "The invoice totals are being checked.", team: AP, action: "Check the invoice totals", supplierAction: "If the totals are wrong we may ask you for a corrected invoice." },
  quantity: { title: "Goods receipt", detail: "We are confirming the quantity received at the plant against the quantity invoiced.", team: "Warehouse", action: "Post or confirm the goods receipt" },
  inventory: { title: "Goods receipt reconciliation", detail: "We are reconciling the invoiced quantity with what the plant received.", team: "Warehouse", action: "Reconcile the goods receipt" },
  quality: { title: "Quality inspection", detail: "The quality inspection result for the delivery is being confirmed.", team: "Quality", action: "Record or confirm the inspection result" },
  weighbridge: { title: "Delivery weight confirmation", detail: "The delivery weight is being confirmed against the weighbridge record.", team: "Logistics", action: "Confirm the delivery weight" },
};
const GROUPS = {
  po: ["purchase_order", "vendor"], receipt: ["quantity", "inventory", "quality", "weighbridge"], procurement: ["price", "unit_of_measure", "tax", "contract", "arithmetic"],
} as const;
const group = (check: string): "po" | "receipt" | "procurement" | "hold" => (GROUPS.po as readonly string[]).includes(check) ? "po" : (GROUPS.receipt as readonly string[]).includes(check) ? "receipt" : (GROUPS.procurement as readonly string[]).includes(check) ? "procurement" : "hold";
const tpl = (check: string): Template & { id: string } => (TEMPLATES[check] ? { ...TEMPLATES[check], id: check } : { ...GENERIC, id: "verification" });

const dateOf = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

function termsFor(engine: PlantPayEngine, vendorId: string | undefined): number | undefined {
  if (!vendorId) return undefined;
  try {
    const sup = engine.connectors.supplier.supplier(`SUP-${vendorId.slice(2)}`);
    const t = Number(sup?.payment_terms_days);
    return Number.isFinite(t) && t > 0 ? t : DEFAULT_PAYMENT_TERMS_DAYS;
  } catch (e) { if (e instanceof SourceUnavailableError) return undefined; throw e; }
}

/** Build the restricted passport for one invoice. Returns undefined when PlantPay has no evaluation for it. */
export function buildPassport(engine: PlantPayEngine, invoiceId: string, opts: { termsDays?: number | null } = {}): Passport | undefined {
  const r = engine.stored(invoiceId);
  if (!r || !r.meta) return undefined;
  const events = workflowEventsFor(engine.integration, invoiceId);
  const tasks = tasksFor(engine.integration, invoiceId);
  const today = engine.today;
  const approvedOn = dateOf(events.filter((e) => e.type === "approval_granted").pop()?.at);
  const paidOn = dateOf(events.filter((e) => e.type === "payment_status_changed" && e.payload.to === "paid").pop()?.at);
  const approvalRequestedOn = dateOf(events.filter((e) => e.type === "approval_requested").pop()?.at);
  const terms = opts.termsDays === undefined ? termsFor(engine, r.meta.vendorId) : opts.termsDays ?? undefined;
  // "Waiting since" is when the exception was raised in the event log; the task's own creation time is only the fallback
  const raised = (check: string) => events.filter((e) => e.type === "exception_raised" && e.payload.check === check).pop()?.at;
  return assemble(r, { today, approvedOn, paidOn, approvalRequestedOn, terms, openTasks: tasks.filter((t) => t.status === "open").map((t) => ({ checkId: t.checkId, createdAt: raised(t.checkId) ?? t.createdAt })) });
}

/** Pure part: stored result plus a few dates in, passport out. Exported for tests. */
export function assemble(r: PlantPayResult, x: { today: string; approvedOn?: string; paidOn?: string; approvalRequestedOn?: string; terms?: number; openTasks: { checkId: string; createdAt: string }[] }): Passport {
  const meta = r.meta!;
  const failing = new Set(r.discrepancies.map((d) => d.check));
  const hold = r.warnings.some((w) => w.severity === "review");
  const notEval = new Set(r.notEvaluated.map((n) => n.check));
  const paid = !!x.paidOn;
  const approved = paid || !!x.approvedOn;

  // Blockers: one per distinct template, in a stable order
  const blockers: PassportBlocker[] = [];
  const seen = new Set<string>();
  const addBlocker = (check: string) => { const t = tpl(check); if (seen.has(t.id)) return; seen.add(t.id); blockers.push({ id: t.id, title: t.title, detail: t.detail, team: t.team, ...(t.supplierAction ? { supplierAction: t.supplierAction } : {}) }); };
  if (!approved) {
    for (const c of Object.keys(TEMPLATES)) if (failing.has(c)) addBlocker(c);
    for (const d of r.discrepancies) if (!TEMPLATES[d.check]) addBlocker(d.check);
    if (hold) addBlocker("verification");
  }

  const has = (g: "po" | "receipt" | "procurement") => r.discrepancies.some((d) => group(d.check) === g) && !approved;
  const waitingData = (g: "po" | "receipt" | "procurement") => (GROUPS[g] as readonly string[]).some((c) => notEval.has(c));
  const own = (g: "po" | "receipt" | "procurement", label: string, id: string, doneNote: string, blockedNote: string): PassportMilestone =>
    has(g) ? { id, label, state: "blocked", note: blockedNote }
      : waitingData(g) && !approved ? { id, label, state: "current", note: "Waiting for records from the plant systems. This clears automatically when they are available." }
        : { id, label, state: "done", note: doneNote };

  const m: PassportMilestone[] = [
    { id: "uploaded", label: "Invoice uploaded", state: "done", note: `Received on ${fmtDate(meta.receivedOn)}.`, date: meta.receivedOn },
    { id: "extracted", label: "Invoice data extracted", state: "done", note: "Invoice details were read and entered for checking." },
    own("po", "Purchase order matched", "po", "The invoice matches a purchase order.", "Being matched to the purchase order."),
    own("receipt", "Goods receipt confirmed", "receipt", "The plant has confirmed the goods received.", "Waiting for the plant to confirm the goods received."),
    own("procurement", "Procurement confirmation", "procurement", "Price, tax and terms are confirmed.", "Procurement is confirming price, tax or terms."),
  ];
  const earlierDone = m.every((s) => s.state === "done");
  m.push(
    approved ? { id: "approval", label: "Final approval", state: "done", note: `Approved${x.approvedOn ? ` on ${fmtDate(x.approvedOn)}` : ""}.`, date: x.approvedOn }
      : hold ? { id: "approval", label: "Final approval", state: "blocked", note: "Held for an additional verification step." }
        : earlierDone ? { id: "approval", label: "Final approval", state: "current", note: x.approvalRequestedOn ? `Approval requested on ${fmtDate(x.approvalRequestedOn)}; waiting for the approver.` : "All checks are clear. The invoice is ready to go for approval." }
          : { id: "approval", label: "Final approval", state: "upcoming", note: "Starts when the checks above are complete." },
  );
  const dueDate = x.terms ? addDaysIso(meta.invoiceDate, x.terms) : undefined;
  m.push(
    paid ? { id: "payment", label: "Payment", state: "done", note: `Paid on ${fmtDate(x.paidOn)}.`, date: x.paidOn }
      : approved ? { id: "payment", label: "Payment", state: "current", note: dueDate ? `Approved. Payment is released in the payment run on or before ${fmtDate(dueDate)}.` : "Approved. Payment is released in the next payment run." }
        : { id: "payment", label: "Payment", state: "upcoming", note: dueDate ? `Due on ${fmtDate(dueDate)}.` : "Due date not available at the moment." },
  );
  // Only one "current" step: the first not-done step that is not blocked, and only when nothing earlier is blocked behind it
  let seenCurrent = false;
  for (const s of m) { if (s.state === "current") { if (seenCurrent) s.state = "upcoming"; seenCurrent = true; } }
  if (!seenCurrent && !m.some((s) => s.state === "blocked")) { const next = m.find((s) => s.state !== "done"); if (next) next.state = "current"; }

  // Pending internal actions (from the open tasks, by team and template only)
  const actions: PassportAction[] = [];
  const aseen = new Set<string>();
  if (!approved) {
    for (const t of x.openTasks) {
      const tp = tpl(t.checkId);
      const key = `${tp.team}|${tp.action}`;
      if (aseen.has(key)) continue; aseen.add(key);
      const since = dateOf(t.createdAt) ?? x.today;
      actions.push({ team: tp.team, action: tp.action, waitingSince: since, waitingDays: Math.max(0, daysBetween(since, x.today)) });
    }
    if (!actions.length && !blockers.length && earlierDone) actions.push({ team: "Approver", action: "Review and approve the invoice", ...(x.approvalRequestedOn ? { waitingSince: x.approvalRequestedOn, waitingDays: Math.max(0, daysBetween(x.approvalRequestedOn, x.today)) } : {}) });
  } else if (!paid) actions.push({ team: AP, action: "Release payment in the next payment run" });

  const daysToDue = dueDate ? daysBetween(x.today, dueDate) : undefined;
  let atRisk = { flag: false, reason: dueDate ? "On track for the due date." : "The due date is not available right now, so the due-date risk cannot be assessed." };
  if (paid) atRisk = { flag: false, reason: "Paid." };
  else if (daysToDue !== undefined) {
    if (daysToDue < 0) atRisk = { flag: true, reason: `Past the due date by ${-daysToDue} day${daysToDue === -1 ? "" : "s"}.` };
    else if (blockers.length > 0 && daysToDue <= AT_RISK.blockedWithinDays) atRisk = { flag: true, reason: `Due in ${daysToDue} day${daysToDue === 1 ? "" : "s"} and ${blockers.length} item${blockers.length === 1 ? " is" : "s are"} still open.` };
    else if (!approved && daysToDue <= AT_RISK.notApprovedWithinDays) atRisk = { flag: true, reason: `Due in ${daysToDue} day${daysToDue === 1 ? "" : "s"} and not yet approved.` };
  }

  const headline = paid ? `Paid on ${fmtDate(x.paidOn)}.`
    : approved ? "Approved. Payment is scheduled."
      : blockers.length ? `${blockers.length} item${blockers.length === 1 ? " is" : "s are"} holding this invoice. The responsible team${new Set(blockers.map((b) => b.team)).size === 1 ? " has" : "s have"} been asked to act.`
        : earlierDone ? "All checks are clear. Waiting for final approval." : "Checks are in progress.";
  return {
    invoiceNumber: r.invoiceId, invoiceDate: meta.invoiceDate, amountInr: meta.totalInr, poNumber: meta.poId, asOf: x.today,
    headline, tone: paid || (approved && !blockers.length) ? "good" : blockers.length ? "problem" : "wait",
    milestones: m, blockers, actions, ...(x.terms ? { paymentTermsDays: x.terms } : {}), ...(dueDate ? { dueDate, daysToDue } : {}), ...(x.paidOn ? { paidOn: x.paidOn } : {}), atRisk,
  };
}

/** The supplier's own invoices (by canonical vendor id), newest first, with their passports. Other suppliers' invoices are never read into the result. */
export function supplierPassports(engine: PlantPayEngine, vendorId: string): Passport[] {
  const terms = termsFor(engine, vendorId) ?? null;
  const rows = engine.integration.prepare("SELECT invoice_id FROM evaluations").all() as { invoice_id: string }[];
  const out: Passport[] = [];
  for (const { invoice_id } of rows) {
    const r = engine.stored(invoice_id);
    if (r?.meta?.vendorId !== vendorId) continue;
    const p = buildPassport(engine, invoice_id, { termsDays: terms });
    if (p) out.push(p);
  }
  return out.sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "") || a.invoiceNumber.localeCompare(b.invoiceNumber));
}

/**
 * The only way a supplier session gets a passport. Returns undefined unless the signed-in user is a supplier and the invoice is theirs;
 * "not yours" and "does not exist" look identical, so invoice numbers cannot be probed.
 */
export function loadSupplierPassport(engine: PlantPayEngine, user: { role: string; vendorId?: string }, invoiceId: string): Passport | undefined {
  if (user.role !== "supplier" || !user.vendorId) return undefined;
  const r = engine.stored(invoiceId);
  if (!r?.meta || r.meta.vendorId !== user.vendorId) return undefined;
  return buildPassport(engine, invoiceId);
}
