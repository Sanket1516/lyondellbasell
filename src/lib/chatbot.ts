// "Where is my payment?" for suppliers. Deterministic: a question is matched to one of five intents by keywords,
// and the answer is a template filled from the supplier-safe invoice view. There is no model and no free text generation.
// It reads only through buildSupplierView, so it cannot say more than the supplier's own status page already does.
import { DEMO_TODAY } from "./constants";
import { fmtDate, fmtRupees } from "./format";
import { buildSupplierView, type SupplierInvoiceView } from "./supplier-view";
import type { AppState } from "./types";

export type Intent = "status" | "why_held" | "needs" | "due" | "late";


export interface ChatAnswer {
  /** The question as understood. */
  question: string;
  lines: string[];
  /** The invoices the answer was read from. */
  basedOn: string[];
}

type Who = { username: string; vendorId?: string };

const INVOICE_ID = /\bINV[-\s]?[A-Z0-9]+\b/i;

/** Map typed words to an intent. Returns undefined when nothing matches, and the bot then says so. */
export function intentFromText(text: string): Intent | undefined {
  const t = text.toLowerCase();
  if (/\b(late|overdue|delayed payments?|past due)\b/.test(t)) return "late";
  if (/\b(why|hold|held|blocked|stuck|reason)\b/.test(t)) return "why_held";
  if (/\b(need|needs|required|require|action|do i have to|from me|correct|fix)\b/.test(t)) return "needs";
  if (/\b(due|when|date|terms)\b/.test(t)) return "due";
  if (/\b(where|status|payment|paid|pay|progress|track)\b/.test(t)) return "status";
  return undefined;
}

export function invoiceIdFromText(text: string): string | undefined {
  const m = text.match(INVOICE_ID);
  return m ? m[0].toUpperCase().replace(/\s+/, "-").replace(/^INV(?!-)/, "INV-") : undefined;
}

const QUESTION: Record<Intent, string> = {
  status: "Where is my payment?", why_held: "Why is it on hold?", needs: "What do you need from me?", due: "When will I be paid?", late: "Which invoices are late?",
};

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function ownViews(s: AppState, who: Who): SupplierInvoiceView[] {
  return s.invoices
    .filter((i) => i.vendorId === who.vendorId || i.submittedBy === who.username)
    .sort((a, b) => (a.receivedOn === b.receivedOn ? (a.id < b.id ? 1 : -1) : a.receivedOn < b.receivedOn ? 1 : -1))
    .map((i) => buildSupplierView(s, i.id, who))
    .filter((v): v is SupplierInvoiceView => !!v);
}

/** One invoice, one intent. Quotes the supplier's own timeline, never anything internal. */
function lineFor(v: SupplierInvoiceView, intent: Exclude<Intent, "late">): string[] {
  const head = `${v.id} (${fmtRupees(v.total)})`;
  switch (intent) {
    case "status": {
      const done = v.steps.filter((x) => x.state === "done" && x.when).map((x) => `${x.title}${x.when ? `, ${x.when}` : ""}`);
      return [`${head}: ${v.headline}`, ...(done.length ? [`So far: ${done.join("; ")}.`] : [])];
    }
    case "why_held": {
      if (v.actions.length) return [`${head}: it is waiting on ${plural(v.actions.length, "correction")} from you. ${v.actions[0].what}${v.actions.length > 1 ? ` (and ${v.actions.length - 1} more, listed on the invoice page)` : ""}`];
      if (/^(Approved|Paid|Checked and waiting|Received)/.test(v.headline)) return [`${head}: it is not on hold. ${v.headline}`];
      return [`${head}: ${v.headline}`];
    }
    case "needs":
      return v.actions.length ? [`${head}: ${plural(v.actions.length, "thing")} needed from you.`, ...v.actions.map((a) => `• ${a.what}`)] : [`${head}: nothing needed from you.`];
    case "due":
      if (!v.payment) return [`${head}: no payment is scheduled for this invoice. ${v.headline}`];
      if (v.payment.paid) return [`${head}: already paid. ${v.headline}`];
      return [`${head}: payment is due on ${fmtDate(v.payment.dueOn)} (${v.payment.termsDays}-day terms from the invoice date)${/Approved/.test(v.headline) ? "." : ", once the invoice is approved."}`];
  }
}

/** Answer one question for one signed-in supplier. */
export function answer(s: AppState, who: Who, intent: Intent | undefined, invoiceId?: string, rawQuestion?: string): ChatAnswer {
  const question = rawQuestion?.trim() || (intent ? QUESTION[intent] : "");
  if (!intent) {
    return {
      question,
      lines: ["I can't answer that. I can tell you where an invoice is, why it is on hold, what we need from you, when it will be paid, and which invoices are late. Try one of the questions below."],
      basedOn: [],
    };
  }
  const mine = ownViews(s, who);

  if (intent === "late") {
    const late = mine.filter((v) => v.payment && !v.payment.paid && v.payment.dueOn < DEMO_TODAY);
    if (!late.length) return { question, lines: [`None of your invoices is past its payment due date as of ${fmtDate(DEMO_TODAY)}.`], basedOn: [] };
    return {
      question,
      lines: [`${plural(late.length, "invoice")} past the payment due date as of ${fmtDate(DEMO_TODAY)}:`, ...late.map((v) => `• ${v.id} (${fmtRupees(v.total)}): due ${fmtDate(v.payment!.dueOn)}, ${plural(days(v.payment!.dueOn, DEMO_TODAY), "day")} ago. ${v.headline}`)],
      basedOn: late.map((v) => v.id),
    };
  }

  if (invoiceId) {
    const v = mine.find((x) => x.id === invoiceId);
    // Another supplier's invoice and a number that does not exist get the same reply.
    if (!v) return { question, lines: [`I can't see an invoice ${invoiceId} in your records. Check the number on your invoice list.`], basedOn: [] };
    return { question, lines: lineFor(v, intent), basedOn: [v.id] };
  }

  const open = mine.filter((v) => !v.payment?.paid);
  if (!open.length) return { question, lines: ["You have no open invoices in our records."], basedOn: [] };
  const shown = open.slice(0, 6);
  const lines = shown.flatMap((v) => lineFor(v, intent));
  if (open.length > shown.length) lines.push(`${plural(open.length - shown.length, "more open invoice")} not shown. Pick an invoice to see it.`);
  return { question, lines, basedOn: shown.map((v) => v.id) };
}
