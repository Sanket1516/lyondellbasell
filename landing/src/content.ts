// Chapter copy. Every number is read from story.json, which scripts/build-landing-story.ts writes from the demo data.
import story from "./data/story.json";

export const S = story;

/** Indian digit grouping: 1062000 -> "10,62,000". */
export function inr(n: number, decimals = 0): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export const rs = (n: number, d = 0) => `₹${inr(n, d)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}
export const pct = (p: number) => `${Math.round(p * 100)}%`;

const H = S.hero;
const clerk = S.approval.staff.find((x) => x.role === "ap_clerk")!;
const l1 = S.approval.staff.find((x) => x.role === "approver_l1")!;
export const APPROVER = l1;
export const CLERK = clerk;

export interface Counter { value: number; label: string; prefix?: string; suffix?: string; decimals?: number; tone?: "bad" | "warn" | "ok" | "accent" }
export interface Chapter {
  id: string;
  nav: string;           // short label for the progress rail
  eyebrow: string;
  headline: string;
  caption: string;
  /** What the 3D scene shows, for screen readers (the canvas itself is hidden from assistive technology). */
  alt: string;
  counters?: Counter[];
  tag?: { text: string; tone: "ok" | "warn" | "bad" | "accent" | "ai" };
}

export const CHAPTERS: Chapter[] = [
  {
    id: "hero", nav: "Start", eyebrow: "PlantPay Intelligence Engine · Plant X",
    headline: "Every invoice has a story.",
    caption: `Follow one invoice, ${H.id} from ${H.supplier}, through every check PlantPay makes before a rupee moves.`,
    alt: `A glass invoice, ${H.id} for ${rs(H.totalInr)}, floats and turns slowly in a field of fine particles.`,
  },
  {
    id: "problem", nav: "Problem", eyebrow: "01 · The problem",
    headline: "Paper hides the problems.",
    caption: `Plant X finance checks ${inr(S.problem.total)} invoices by hand. ${S.problem.exceptions} of them need a person, and every answer means an email chase across ${S.problem.departments} teams.`,
    alt: `Invoices pile up in three stacks. Red marks appear on the ones with mismatches, possible duplicates and missing approvals.`,
    counters: [
      { value: S.problem.overdueOpen, label: "invoices past due, still unpaid", tone: "bad" },
      { value: S.problem.block, label: "blocked as audit risk", tone: "warn" },
      { value: S.problem.reworkPct, suffix: "%", label: "loop back for rework", tone: "warn" },
    ],
  },
  {
    id: "read", nav: "Read", eyebrow: "02 · Upload and read",
    headline: "Read in seconds.",
    caption: `${H.id} arrives as a PDF. A scan pulls out the six fields every check needs: vendor, PO number, items, quantities, prices and tax.`,
    alt: `The invoice slides in. A blue scan line sweeps down it and six labelled chips fly out: vendor ${H.supplier}, PO ${H.po}, ${H.lines.length} items, quantities, prices and ${H.taxPct}% GST.`,
  },
  {
    id: "sources", nav: "Sources", eyebrow: "03 · Six sources",
    headline: "Six systems. One view.",
    caption: `PlantPay reads Procurement, Warehouse, Quality, Finance, Logistics and Supplier records directly. It never writes to them and never guesses when one is down.`,
    alt: `Six glowing nodes orbit a central PlantPay core, each connected by a line carrying pulses of data: ${S.sources.map((x) => `${x.label} with ${inr(x.records)} records`).join(", ")}.`,
  },
  {
    id: "match", nav: "Match", eyebrow: "04 · Three-way match",
    headline: "Three documents. One mismatch.",
    caption: `Invoice ${rs(S.match.trio.invoice)} per ${S.match.trio.unit} against the PO's ${rs(S.match.trio.po)}. That is 3.5% over a ${S.match.tolerancePct}% tolerance, so the rules flag it.`,
    alt: `The invoice, purchase order ${H.po} and goods receipt ${S.match.grn} line up side by side. The AX-40 price turns red on the invoice (₹412) and the PO (₹398). A red badge reads FLAGGED: price 3.5% above PO.`,
    tag: { text: "Flagged · rule-based", tone: "bad" },
  },
  {
    id: "cause", nav: "Root cause", eyebrow: "05 · Root cause",
    headline: "Not an error. A missed update.",
    caption: `Contract C-22 was amended to ${rs(S.match.trio.contract)} from 01-Oct-2026. The PO never was. ${S.rootCause.responsible.department} buyer ${S.rootCause.responsible.person} fixes it.`,
    alt: `A contract amendment card slides in. A green line links it to the invoice price, which turns from red to green; an amber line marks the PO as not updated. ${S.rootCause.counterfactual}`,
    tag: { text: "Evidence-supported", tone: "ok" },
  },
  {
    id: "risk", nav: "Risk", eyebrow: "06 · Risk signals",
    headline: "Warning, not proof.",
    caption: `${S.risk.shared.a} and ${S.risk.shared.b} share one bank account. A re-issued copy of a paid invoice scores ${S.risk.duplicate.score} of 100. A person looks before anything is paid.`,
    alt: `A network of ${S.risk.graph.vendors.length} suppliers and their bank accounts. Two suppliers light up amber, linked to the same account. To the side, a translucent copy ${S.risk.duplicate.copy} slides over the original ${S.risk.duplicate.original}, scored ${S.risk.duplicate.score} of 100.`,
    tag: { text: "Warning, not proof", tone: "warn" },
  },
  {
    id: "approval", nav: "Approval", eyebrow: "07 · Approval",
    headline: "The right person signs.",
    caption: `Above ${rs(S.approval.clerkMax)} the AP clerk cannot approve. ${rs(H.totalInr)} goes to the ${l1.title}, ${l1.name}, whose limit is ${rs(l1.limit)}.`,
    alt: `The invoice travels along a track through two gates: AP Clerk ${clerk.name}, then Approver L1 ${l1.name}. It crosses a threshold marker at ${rs(S.approval.clerkMax)}. A comment appears and an APPROVED stamp lands, dated ${day(S.approval.approvedOn)}.`,
    tag: { text: "Role-checked", tone: "accent" },
  },
  {
    id: "intel", nav: "Intelligence", eyebrow: "08 · Intelligence",
    headline: "See trouble coming.",
    caption: `Trained models estimate the chance of an exception and a late payment, and show what drives each one. They advise. The rules decide.`,
    alt: `A gauge fills to ${S.intelligence.criticality.score} for supplier criticality (${S.intelligence.criticality.band}). Bars show exception risk ${pct(S.intelligence.exception.p)} and payment-delay risk ${pct(S.intelligence.delay.p)}, with their top contributing factors, labelled AI-assisted.`,
    tag: { text: "AI-assisted", tone: "ai" },
  },
  {
    id: "trust", nav: "Trust", eyebrow: "09 · Trust",
    headline: "Change one record. The chain shows it.",
    caption: `Every action is hash-chained: ${inr(S.trust.auditEntries)} audit entries, each sealed to the one before. Edit record ${S.trust.tamperedSeq} and every block after it stops matching.`,
    alt: `A chain of ${S.trust.chain.length} hash blocks assembles. Block ${S.trust.tamperedSeq} is tampered with, the blocks after it turn red and a detection ping spreads; then the chain is repaired and turns blue again.`,
    tag: { text: "Tamper-evident", tone: "accent" },
  },
  {
    id: "paid", nav: "Paid", eyebrow: "10 · Ready for payment",
    headline: "Ready for payment.",
    caption: `Every milestone confirmed. Due ${day(S.paid.dueDate)} on ${S.paid.termsDays}-day terms. Across all ${inr(S.impact.evaluated)} invoices in the demo data:`,
    alt: `The supplier's payment passport fills milestone by milestone: ${S.paid.milestones.map((m) => m.label).join(", ")}. Status: ready for payment.`,
    counters: [
      { value: S.impact.duplicateCount, label: `possible duplicates held, ${rs(S.impact.duplicateValue)}`, tone: "ok" },
      { value: S.impact.hoursSaved, label: `clerk hours saved (assumes ${S.impact.minutesPerInvoice} min per manual check)`, tone: "accent" },
      { value: S.impact.exceptionsWithCause, suffix: ` of ${S.impact.exceptionsTotal}`, label: `exceptions arrive with cause and owner, not after ${S.impact.manualDays} days of email`, tone: "ok" },
    ],
    tag: { text: "Ready for payment", tone: "ok" },
  },
  {
    id: "cta", nav: "Live demo", eyebrow: "The live system",
    headline: "Enter the live demo.",
    caption: "Same data, same invoice, real screens. Pick a role and you are signed in with the demo account.",
    alt: "Buttons to open the live PlantPay app as a supplier, an AP clerk or an approver, and to start the Golden Journey.",
  },
];

export const ROLES = [
  { role: "supplier", title: "Supplier", who: "Vihar Chem Supplies", user: "vihar.supplier", pass: "Vihar@2026", what: "Upload an invoice, track the payment passport" },
  { role: "clerk", title: "AP Clerk", who: clerk.name, user: "priya.clerk", pass: "Clerk@2026", what: "Work the exception queue with evidence" },
  { role: "approver", title: "Approver", who: `${l1.name}, L1`, user: "neha.approver", pass: "ApproverL1@2026", what: "Decide within a role-checked limit" },
] as const;

export const demoHref = (role: string, next?: string) => `/demo/${role}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
