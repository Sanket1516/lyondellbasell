// Quantified impact, computed from the live invoice records. Counts and rupee values are measured.
// Time and day comparisons use the labelled assumptions below; the UI always marks them as assumptions.
import { DEMO_TODAY } from "./constants";
import { bandFor } from "./routing";
import type { AppState, Invoice } from "./types";

/** Assumptions for the before/after comparison [ASSUMPTION]. Shown next to every figure that uses them. */
export const IMPACT_ASSUMPTIONS = {
  manualMinutesPerInvoice: 12, // an AP clerk checking invoice, PO and goods receipt by hand
  manualDaysToFindRootCause: 3, // chasing buyers, stores and the supplier by email
  manualSupplierReplyDays: 5, // a supplier waiting for an answer to "where is my payment"
} as const;

const isDone = (i: Invoice) => i.status === "approved" || i.status === "paid";
const age = (i: Invoice) => Math.max(0, Math.round((Date.parse(DEMO_TODAY) - Date.parse(i.receivedOn)) / 86400000));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Impact {
  /** Value of possible duplicates held back from payment (measured). */
  duplicateValue: number;
  duplicateCount: number;
  /** Invoices that matched clean first time, and the clerk hours that saved (hours uses an assumption). */
  autoClean: number;
  hoursSaved: number;
  /** Exceptions that carry a named root cause and owner the moment they are matched. */
  exceptionsWithCause: number;
  exceptionsTotal: number;
  /** Value held from payment until a person looks (measured). */
  heldValue: number;
  totalInvoices: number;
}

export function buildImpact(s: AppState): Impact {
  const dup = s.invoices.filter((i) => !isDone(i) && s.findings.some((f) => f.invoiceId === i.id && f.kind === "duplicate"));
  const matched = s.invoices.filter((i) => i.verdict);
  const autoClean = matched.filter((i) => i.verdict === "approve" && !i.resolvedOn).length;
  const exc = s.invoices.filter((i) => i.verdict && i.verdict !== "approve");
  const withCause = exc.filter((i) => s.findings.some((f) => f.invoiceId === i.id && f.verdict !== "approve" && f.rootCause && f.owner));
  return {
    duplicateValue: dup.reduce((n, i) => n + i.total, 0), duplicateCount: dup.length,
    autoClean, hoursSaved: round1((autoClean * IMPACT_ASSUMPTIONS.manualMinutesPerInvoice) / 60),
    exceptionsWithCause: withCause.length, exceptionsTotal: exc.length,
    heldValue: exc.filter((i) => !isDone(i) && i.verdict === "block").reduce((n, i) => n + i.total, 0),
    totalInvoices: s.invoices.length,
  };
}

export interface RoleValue { headline: string; lines: string[] }

export function clerkValue(s: AppState): RoleValue {
  const m = buildImpact(s);
  const open = s.invoices.filter((i) => !isDone(i) && i.verdict && i.verdict !== "approve").length;
  return {
    headline: "Stop chasing mismatches by hand.",
    lines: [
      `${m.autoClean} invoices matched clean on the first pass, about ${m.hoursSaved} clerk hours saved (assumes ${IMPACT_ASSUMPTIONS.manualMinutesPerInvoice} minutes per manual check).`,
      `${m.exceptionsWithCause} of ${m.exceptionsTotal} exceptions arrived with a named root cause and owner; ${open} are open for you now.`,
    ],
  };
}

export function approverValue(s: AppState, level: "L1" | "L2"): RoleValue {
  const waiting = s.invoices.filter((i) => i.status === "pending_approval" && i.verdict === "approve")
    .filter((i) => { const b = bandFor(i.total); return b === "L1" || (b === "L2" && level === "L2"); });
  const value = waiting.reduce((n, i) => n + i.total, 0);
  const oldest = waiting.reduce((n, i) => Math.max(n, age(i)), 0);
  return {
    headline: "See exactly what needs your sign-off.",
    lines: [
      `${waiting.length} ${waiting.length === 1 ? "item awaits" : "items await"} your approval, worth ₹${value.toLocaleString("en-IN")}${waiting.length ? `; the oldest has waited ${oldest} ${oldest === 1 ? "day" : "days"}` : ""}.`,
      "Every item reaches you already matched clean, with its evidence on one screen, so a decision takes minutes, not a chase.",
    ],
  };
}

export function supplierValue(s: AppState, vendorId: string | undefined, username: string | undefined): RoleValue {
  const mine = s.invoices.filter((i) => i.vendorId === vendorId || i.submittedBy === username);
  const open = mine.filter((i) => !isDone(i));
  const clear = open.filter((i) => i.verdict === "approve").length;
  const onHold = open.filter((i) => i.verdict && i.verdict !== "approve").length;
  const avg = open.length ? round1(open.reduce((n, i) => n + age(i), 0) / open.length) : 0;
  return {
    headline: "Know where your payment is.",
    lines: [
      `${open.length} open ${open.length === 1 ? "invoice" : "invoices"}: ${clear} cleared for approval, ${onHold} with a named owner working on it. Average age ${avg} days.`,
      `Ask the payment assistant below and get the answer now, instead of waiting an assumed ${IMPACT_ASSUMPTIONS.manualSupplierReplyDays} working days for an email reply.`,
    ],
  };
}

/** Before and after PlantPay, for the impact panel. Rows marked `assumed` rest on IMPACT_ASSUMPTIONS. */
export function beforeAfter(m: Impact): { what: string; before: string; after: string; assumed: boolean }[] {
  return [
    { what: "Checking invoice, PO and goods receipt", before: `${IMPACT_ASSUMPTIONS.manualMinutesPerInvoice} minutes by hand, per invoice`, after: "Automatic, on submission", assumed: true },
    { what: "Finding why an invoice does not match", before: `About ${IMPACT_ASSUMPTIONS.manualDaysToFindRootCause} days of email chasing`, after: "Root cause, owner and fix shown at match time", assumed: true },
    { what: "Possible duplicate payments", before: "Found after payment, if at all", after: `${m.duplicateCount} held for review, ₹${m.duplicateValue.toLocaleString("en-IN")}`, assumed: false },
    { what: "Who approved, and at what limit", before: "Emails and spreadsheets", after: "Role-checked, hash-chained audit trail", assumed: false },
    { what: "Supplier asking where payment is", before: `${IMPACT_ASSUMPTIONS.manualSupplierReplyDays} working days for a reply`, after: "Instant answer from live records", assumed: true },
  ];
}
