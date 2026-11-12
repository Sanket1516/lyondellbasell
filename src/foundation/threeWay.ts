// Structured three-way match (invoice vs PO vs goods receipt) for the foundation database.
// The financial rules live in src/engine/match.ts (deterministic: unit normalisation, tolerances, contract price on the
// delivery date, cumulative receipts, duplicate fingerprint). This module loads relational data, runs that engine and
// reshapes its findings as {status, per-check pass/fail, discrepancies}. No ML or AI is involved.
import type Database from "better-sqlite3";
import { ENGINE_CONFIG } from "../engine/config";
import { matchInvoice, type MatchData } from "../engine/match";
import type { Finding, FindingKind, Invoice, Verdict } from "../lib/types";
import { loadInvoices, loadMatchData } from "./db";

export type MatchStatus = "pass" | "review" | "block";
export type CheckId = "vendor" | "purchase_order" | "duplicate" | "price" | "quantity" | "unit_of_measure" | "tax" | "arithmetic";

export interface CheckResult { check: CheckId; label: string; passed: boolean; detail: string }
export interface Discrepancy {
  check: CheckId; lineNo?: number; severity: Verdict; message: string; expected?: string; actual?: string; deltaPct?: number;
  /** A root cause is a prediction until evidence backs it; findings with evidence rows are "supported by evidence". */
  rootCause: string; rootCauseStatus: "supported_by_evidence" | "unverified_prediction"; evidence: string[]; suggestedFix: string; owner: string;
}
export interface ThreeWayResult {
  invoiceId: string; status: MatchStatus; summary: string; checks: CheckResult[]; discrepancies: Discrepancy[];
  tolerances: { pricePct: number; qtyPct: number }; matchedAt: string;
}

export const CHECKS: { id: CheckId; label: string; passText: string }[] = [
  { id: "vendor", label: "Vendor on master and active", passText: "Vendor is on the master and active." },
  { id: "purchase_order", label: "PO exists, belongs to vendor, lines on PO", passText: "PO found and all invoice lines are on it." },
  { id: "duplicate", label: "No earlier look-alike invoice", passText: "No earlier invoice with the same fingerprint." },
  { id: "price", label: `Price within ${ENGINE_CONFIG.pricePct}% of PO (and contract)`, passText: "Prices agree with the PO." },
  { id: "quantity", label: `Quantity within ${ENGINE_CONFIG.qtyPct}% of cumulative goods receipts`, passText: "Billed quantity is covered by goods receipts." },
  { id: "unit_of_measure", label: "Units convertible to the PO unit", passText: "Units agree with the PO." },
  { id: "tax", label: "Tax rate equals PO tax code", passText: "Tax rate agrees with the PO." },
  { id: "arithmetic", label: "Line, subtotal, tax and total arithmetic", passText: "Arithmetic is consistent." },
];
export const KIND_TO_CHECK: Record<FindingKind, CheckId> = {
  unknown_vendor: "vendor", missing_po: "purchase_order", not_on_po: "purchase_order", duplicate: "duplicate", price: "price",
  quantity: "quantity", missing_receipt: "quantity", uom: "unit_of_measure", tax: "tax", arithmetic: "arithmetic",
};
const STATUS: Record<Verdict, MatchStatus> = { approve: "pass", flag: "review", block: "block" };

/**
 * Duplicate checks look only at invoices received earlier (or the same day with a smaller number), so the original of a
 * duplicate pair is not blamed for the copy that came after it.
 */
export function earlierThan(inv: Invoice, all: Invoice[]): Invoice[] {
  return all.filter((o) => o.receivedOn < inv.receivedOn || (o.receivedOn === inv.receivedOn && o.id < inv.id));
}

export function reshape(inv: Invoice, findings: Finding[], verdict: Verdict, summary: string, matchedAt: string): ThreeWayResult {
  const checks: CheckResult[] = CHECKS.map((c) => {
    const mine = findings.filter((f) => KIND_TO_CHECK[f.kind] === c.id);
    const failing = mine.filter((f) => f.verdict !== "approve");
    if (failing.length) return { check: c.id, label: c.label, passed: false, detail: failing.map((f) => f.message).join(" ") };
    const note = mine.find((f) => f.verdict === "approve");
    return { check: c.id, label: c.label, passed: true, detail: note ? note.message : c.passText };
  });
  const discrepancies: Discrepancy[] = findings.filter((f) => f.verdict !== "approve").map((f) => ({
    check: KIND_TO_CHECK[f.kind], lineNo: f.lineNo, severity: f.verdict, message: f.message, expected: f.expected, actual: f.actual, deltaPct: f.deltaPct,
    rootCause: f.rootCause, rootCauseStatus: f.evidence && f.evidence.length > 0 ? "supported_by_evidence" : "unverified_prediction",
    evidence: (f.evidence ?? []).map((e) => e.text), suggestedFix: f.smallestFix, owner: f.owner,
  }));
  return { invoiceId: inv.id, status: STATUS[verdict], summary, checks, discrepancies, tolerances: { pricePct: ENGINE_CONFIG.pricePct, qtyPct: ENGINE_CONFIG.qtyPct }, matchedAt };
}

export function matchOne(data: MatchData, inv: Invoice, today: string): ThreeWayResult {
  const scoped: MatchData = { ...data, invoices: earlierThan(inv, data.invoices) };
  const r = matchInvoice(inv, scoped, today);
  return reshape(inv, r.findings, r.verdict, r.summary, today);
}

export function runMatch(db: Database.Database, invoiceId: string, today: string): ThreeWayResult | undefined {
  const invoices = loadInvoices(db);
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv) return undefined;
  const res = matchOne(loadMatchData(db, invoices), inv, today);
  store(db, res);
  return res;
}

/** Match every invoice (one data load) and store the results. */
export function runMatchAll(db: Database.Database, today: string): ThreeWayResult[] {
  const invoices = loadInvoices(db);
  const data = loadMatchData(db, invoices);
  const out = invoices.map((inv) => matchOne(data, inv, today));
  db.transaction(() => out.forEach((r) => store(db, r)))();
  return out;
}

function store(db: Database.Database, r: ThreeWayResult) {
  db.prepare("INSERT INTO match_results (invoice_id, matched_at, status, summary, result_json) VALUES (?,?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET matched_at=excluded.matched_at, status=excluded.status, summary=excluded.summary, result_json=excluded.result_json")
    .run(r.invoiceId, r.matchedAt, r.status, r.summary, JSON.stringify(r));
}

export function getResult(db: Database.Database, invoiceId: string): ThreeWayResult | undefined {
  const row = db.prepare("SELECT result_json FROM match_results WHERE invoice_id = ?").get(invoiceId) as { result_json: string } | undefined;
  return row ? (JSON.parse(row.result_json) as ThreeWayResult) : undefined;
}
