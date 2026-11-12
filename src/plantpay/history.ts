// Deterministic workflow histories for the seed data. Built from what the six sources and the engine already say about each invoice,
// so the story always agrees with the records: a paid invoice has an approval and a payment event; an invoice still held for a
// Procurement fix stops at "exception raised, assigned to Procurement". Some invoices loop (AP review -> Procurement -> AP review
// again -> Procurement -> AP review). Same input, same events, every run.
import crypto from "node:crypto";
import type { PlantPayEngine, PlantPayResult } from "./engine";
import { recordWorkflowEvent, type WorkflowEventInput } from "./workflowEvents";

const AP = { name: "Priya Nair", dept: "Finance" };
const OWNER: Record<string, string> = { Procurement: "Anand Deshpande", Warehouse: "Kavita More", Quality: "Mahesh Gaikwad", Logistics: "Gate and Weighbridge Desk", Finance: "Priya Nair", "Supplier master data": "Supplier Master Data Team" };

/** Stable pseudo-random integer in [0, n) from a string. */
const h = (s: string, n: number) => crypto.createHash("sha1").update(s).digest().readUInt32BE(0) % n;
const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);

export function buildHistory(invoiceNo: string, head: Record<string, unknown>, extra: { approvals: { approver_name?: unknown; approver_id?: unknown; level?: unknown; approved_on?: unknown }[]; payment?: Record<string, unknown> }, ev: PlantPayResult | undefined, today: string): WorkflowEventInput[] {
  if (invoiceNo === HERO_INVOICE) return heroHistory(head, today);
  const out: WorkflowEventInput[] = [];
  const status = String(head.status);
  const received = String(head.received_on);
  let day = 0;
  let minute = 9 * 60 + h(invoiceNo + "m", 120);
  const clock = () => { minute += 7 + h(invoiceNo + minute, 40); if (minute > 18 * 60) { minute = 9 * 60 + 5; day++; } return `${addDays(received, day)}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00.000Z`; };
  const nextDay = (n = 1) => { day += n; minute = 9 * 60 + h(invoiceNo + day, 90); };
  const push = (type: WorkflowEventInput["type"], actor: string, department: string, payload: Record<string, unknown>, at?: string) => out.push({ invoiceId: invoiceNo, type, actor, department, at: at ?? clock(), payload });

  push("invoice_received", "Supplier portal", "Finance", { channel: "supplier portal", receivedOn: received, totalInr: Number(head.total_paise) / 100 });
  push("department_assigned", "system", "Finance", { from: "Intake", to: "Finance", reason: "New invoice enters AP review" });
  if (status === "received") return out;

  push("review_started", AP.name, AP.dept, { stage: "AP review" });
  let issues = [...(ev?.discrepancies.map((d) => ({ dept: d.department, check: d.check, msg: d.message })) ?? []), ...(ev?.warnings.filter((w) => w.severity === "review").map((w) => ({ dept: w.department, check: w.kind, msg: w.message })) ?? [])];
  const resolved = ["approved", "paid", "pending_approval"].includes(status);
  // About one in four resolved invoices passed through an exception earlier in its life (since fixed), so the stories contain loops.
  if (!issues.length && resolved && h(invoiceNo + "hist", 4) === 0) {
    const pool = [{ dept: "Procurement", check: "price", msg: "Invoice price differs from the PO price" }, { dept: "Warehouse", check: "quantity", msg: "Billed quantity is above goods received so far" }, { dept: "Quality", check: "quality", msg: "Inspection result not yet recorded for the receipt" }, { dept: "Procurement", check: "tax", msg: "Tax rate on the invoice differs from the PO tax code" }];
    issues = [pool[h(invoiceNo + "p", pool.length)], pool[h(invoiceNo + "q", pool.length)]];
  }
  if (issues.length) {
    const loops = resolved ? (h(invoiceNo + "loop", 4) === 0 ? 2 : 1) : 1;
    const first = issues[0];
    for (let i = 0; i < loops; i++) {
      const dept = i === 0 ? first.dept : issues[1]?.dept ?? "Procurement";
      const msg = i === 0 ? first.msg : issues[1]?.msg ?? "Follow-up question from AP after the first fix";
      const check = i === 0 ? first.check : issues[1]?.check ?? "follow_up";
      push("exception_raised", AP.name, AP.dept, { check, message: msg.slice(0, 200), severity: ev?.status === "block" ? "block" : "flag" });
      push("department_assigned", AP.name, dept, { from: "Finance", to: dept, reason: `${check} needs ${dept}` });
      nextDay();
      push("review_started", OWNER[dept] ?? dept, dept, { stage: `${dept} review` });
      if (!resolved) return out; // still open with the department
      nextDay(1 + h(invoiceNo + "d" + i, 3));
      push("exception_resolved", OWNER[dept] ?? dept, dept, { check, resolution: resolutionText(check) });
      push("review_completed", OWNER[dept] ?? dept, dept, { stage: `${dept} review`, outcome: "fixed" });
      push("department_assigned", OWNER[dept] ?? dept, "Finance", { from: dept, to: "Finance", reason: "Fix done, back to AP" });
      nextDay();
      push("review_started", AP.name, AP.dept, { stage: "AP review (again)", loop: i + 1 });
    }
    // Issues present but the status says unresolved: stopped above.
  }
  push("review_completed", AP.name, AP.dept, { stage: "AP review", outcome: status === "blocked" ? "blocked" : "ready for approval" });
  if (status === "blocked" || status === "pending_owner" || status === "sent_back" || status === "rejected") return out;

  nextDay();
  push("approval_requested", AP.name, AP.dept, { amountInr: Number(head.total_paise) / 100, requiredLevel: Number(head.total_paise) / 100 <= 100000 ? "clerk" : Number(head.total_paise) / 100 <= 1500000 ? "L1" : "L2" });
  if (status === "pending_approval") return out;
  const ap = extra.approvals[0];
  const approver = String(ap?.approver_name ?? ap?.approver_id ?? "Neha Kulkarni");
  const approvedOn = ap?.approved_on ? String(ap.approved_on) : addDays(received, day + 1);
  // The approval and payment dates come from the Finance records; the review events above are generated. Never let an approval or
  // payment come before the review events that precede it (that would send the invoice back to a department after it was approved).
  const after = (candidate: string) => { const last = out[out.length - 1].at!; return candidate > last ? candidate : new Date(Date.parse(last) + 3600000).toISOString(); };
  const approvalAt = after(`${approvedOn}T${String(10 + h(invoiceNo + "a", 6)).padStart(2, "0")}:15:00.000Z`);
  push("approval_granted", approver, "Finance", { level: String(ap?.level ?? "L1") }, approvalAt);
  if (status === "paid" && extra.payment) {
    const paidOn = String(extra.payment.paid_on);
    const scheduledAt = after(`${paidOn > approvedOn ? addDays(paidOn, -1) : approvedOn}T16:00:00.000Z`);
    push("payment_status_changed", "Finance payment run", "Finance", { from: "approved", to: "scheduled" }, scheduledAt);
    push("payment_status_changed", "Finance payment run", "Finance", { from: "scheduled", to: "paid", utr: String(extra.payment.utr), amountInr: Number(extra.payment.amount_paise) / 100 }, after(`${paidOn}T17:30:00.000Z`));
  }
  return out;
}
/** The golden demo invoice (₹412 invoice price, ₹398 on the PO, ₹412 on contract C-22). */
export const HERO_INVOICE = "INV-7781";

/**
 * Hand-written story for the golden invoice, consistent with its open exceptions (price with Procurement, receipt short with Warehouse):
 * AP flags the price, Procurement looks and sends it back, AP re-reviews and raises the receipt, so the AP -> Procurement -> AP
 * rework loop is real in the event log. All times are on the day it arrived and the day after (nothing after the demo "today").
 */
function heroHistory(head: Record<string, unknown>, today: string): WorkflowEventInput[] {
  const received = String(head.received_on);
  const d1 = received, d2 = addDays(received, 1) > today ? today : addDays(received, 1);
  const at = (d: string, hhmm: string) => `${d}T${hhmm}:00.000Z`;
  const total = Number(head.total_paise) / 100;
  const ev = (type: WorkflowEventInput["type"], actor: string, department: string, when: string, payload: Record<string, unknown>): WorkflowEventInput => ({ invoiceId: HERO_INVOICE, type, actor, department, at: when, payload });
  return [
    ev("invoice_received", "Supplier portal", "Finance", at(d1, "10:53"), { channel: "supplier portal", receivedOn: received, totalInr: total }),
    ev("department_assigned", "system", "Finance", at(d1, "10:55"), { from: "Intake", to: "Finance", reason: "New invoice enters AP review" }),
    ev("review_started", "Priya Nair", "Finance", at(d1, "11:30"), { stage: "AP review" }),
    ev("exception_raised", "Priya Nair", "Finance", at(d1, "12:10"), { check: "price", message: "Invoice price differs from the PO price on line 1", severity: "flag" }),
    ev("department_assigned", "Priya Nair", "Procurement", at(d1, "12:12"), { from: "Finance", to: "Procurement", reason: "price needs Procurement" }),
    ev("review_started", "Anand Deshpande", "Procurement", at(d1, "14:20"), { stage: "Procurement review" }),
    ev("review_completed", "Anand Deshpande", "Procurement", at(d1, "16:45"), { stage: "Procurement review", outcome: "returned to AP: contract C-22 supports the invoice price, PO amendment still to be raised" }),
    ev("department_assigned", "Anand Deshpande", "Finance", at(d1, "16:47"), { from: "Procurement", to: "Finance", reason: "Returned to AP with the contract finding" }),
    ev("review_started", "Priya Nair", "Finance", at(d2, "09:20"), { stage: "AP review (again)", loop: 1 }),
    ev("exception_raised", "Priya Nair", "Finance", at(d2, "09:48"), { check: "quantity", message: "Billed quantity is above goods received on line 3", severity: "flag" }),
    ev("department_assigned", "Priya Nair", "Warehouse", at(d2, "09:50"), { from: "Finance", to: "Warehouse", reason: "quantity needs Warehouse" }),
  ];
}

const resolutionText = (check: string) =>
  ({ price: "PO amended to the contract price", quantity: "Goods receipt posted", quality: "Supplier issued a credit note for rejected goods", weighbridge: "Weighbridge record confirmed after re-weigh", tax: "Supplier reissued the invoice at the PO tax rate", bank_change: "Call-back verification completed", duplicate: "Clerk compared both documents and recorded a reason" } as Record<string, string>)[check] ?? "Confirmed and corrected by the owner";

/** Generate and store the histories for every invoice, in global time order so the audit chain reads chronologically. */
export function seedWorkflowHistories(engine: PlantPayEngine): { events: number; invoices: number } {
  const heads = engine.connectors.finance.listInvoiceHeaders();
  const all: { e: WorkflowEventInput; n: number }[] = [];
  let n = 0;
  for (const head of heads) {
    const no = String(head.invoice_no);
    const inv = engine.connectors.finance.invoice(no);
    if (!inv) continue;
    for (const e of buildHistory(no, { ...head, ...inv.header }, { approvals: inv.approvals, payment: inv.payment }, engine.stored(no), engine.today)) if (e.at! <= `${engine.today}T23:59:59.000Z`) all.push({ e, n: n++ });
  }
  all.sort((a, b) => (a.e.at! < b.e.at! ? -1 : a.e.at! > b.e.at! ? 1 : a.n - b.n));
  engine.integration.transaction(() => { for (const { e } of all) recordWorkflowEvent(engine.integration, e); })();
  return { events: all.length, invoices: heads.length };
}
// Events that would fall after the demo "today" are simply not generated: the invoice has not got that far yet.
