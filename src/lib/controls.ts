// Controls report for auditors. Every figure is counted from the invoice records and the audit trail.
// Pure: the page, the print view and the tests all call this.
import { verifyChain, type ChainResult } from "./audit";
import { fmtDateTime } from "./format";
import { THRESHOLDS, TOLERANCE } from "./constants";
import { buildDashboard } from "./dashboard";
import { bandFor } from "./routing";
import type { AppState, Invoice } from "./types";

export interface ControlLine {
  id: string;
  control: string;
  /** What was counted, in one sentence. */
  result: string;
  /** pass: nothing failed. attention: a figure the auditor should read. info: context only. */
  status: "pass" | "attention" | "info";
  detail?: string;
}

export interface ControlsReport {
  generatedAt: string;
  chain: ChainResult;
  lines: ControlLine[];
  exceptions: { open: number; blockedValue: number; topCause?: { cause: string; cases: number }; byType: { label: string; findings: number }[]; resolved: number };
  evidence: { label: string; invoiceId: string; why: string }[];
  scope: { invoices: number; matched: number; approvedOrPaid: number; auditRecords: number };
}

const plural = (n: number, w: string, pl = `${w}s`) => `${n} ${n === 1 ? w : pl}`;
const isDone = (i: Invoice) => i.status === "approved" || i.status === "paid";

export function buildControlsReport(s: AppState, now = new Date()): ControlsReport {
  const chain = verifyChain(s.auditEvents);
  const dash = buildDashboard(s);
  const openTasks = (id: string) => s.tasks.some((t) => t.invoiceId === id && t.status === "requested");

  const matched = s.invoices.filter((i) => i.verdict);
  const unmatched = s.invoices.filter((i) => !i.verdict);
  const done = s.invoices.filter(isDone);

  // 1. No invoice is approved or paid unless its match is clean, or the exception was resolved first.
  const bad = done.filter((i) => !i.verdict || openTasks(i.id) || (i.verdict !== "approve" && !i.resolvedOn));
  const resolvedBefore = done.filter((i) => i.verdict && i.verdict !== "approve" && i.resolvedOn);
  const liveApproved = done.filter((i) => i.decision && (i.decision.outcome === "approved" || i.decision.outcome === "released"));

  // 2. Thresholds: each live decision was taken by the role the amount requires.
  const wrongBand = liveApproved.filter((i) => {
    const band = bandFor(i.total);
    const d = i.decision!;
    if (band === "clerk") return d.outcome !== "released";
    if (band === "L1") return d.outcome !== "approved" || !d.level;
    return d.outcome !== "approved" || d.level !== "L2";
  });
  const waiting = s.invoices.filter((i) => i.status === "pending_approval");
  const inBand = (b: "clerk" | "L1" | "L2") => waiting.filter((i) => bandFor(i.total) === b).length;
  const byRole = {
    clerk: liveApproved.filter((i) => i.decision!.outcome === "released").length,
    L1: liveApproved.filter((i) => i.decision!.outcome === "approved" && i.decision!.level === "L1").length,
    L2: liveApproved.filter((i) => i.decision!.outcome === "approved" && i.decision!.level === "L2").length,
  };

  // 3. Segregation of duties: nobody decided an invoice they submitted or worked on.
  const involved = liveApproved.filter((i) => {
    const d = i.decision!;
    // A clerk's release is itself a touch, so only approver decisions are checked against the people who worked on it.
    return i.submittedBy === d.by || (d.outcome === "approved" && (i.touchedBy ?? []).includes(d.by));
  });
  const refused = s.auditEvents.filter((e) => e.action === "refused");
  const sodRefused = refused.filter((e) => /worked on this invoice|rejected this invoice earlier|cannot approve/i.test(e.detail));

  // 4. Duplicates.
  const dupInvoices = s.invoices.filter((i) => s.findings.some((f) => f.invoiceId === i.id && f.kind === "duplicate") || i.duplicateDecision);
  const dupOpenBlocked = dupInvoices.filter((i) => i.status === "blocked").length;
  const dupConfirmed = s.invoices.filter((i) => i.duplicateDecision?.decision === "duplicate").length;
  const dupDismissed = s.invoices.filter((i) => i.duplicateDecision?.decision === "not_duplicate").length;
  const paidDup = dupInvoices.filter((i) => isDone(i) && i.duplicateDecision?.decision !== "not_duplicate");

  const stamp = now.toISOString();
  const lines: ControlLine[] = [
    {
      id: "match", control: "Three-way match runs on every invoice",
      result: `${matched.length} of ${s.invoices.length} invoices have a match result (invoice, PO and goods receipt, plus contract, delivery note and unit rules).`,
      status: unmatched.length ? "attention" : "pass",
      detail: unmatched.length ? `${plural(unmatched.length, "invoice")} not yet matched: ${unmatched.map((i) => i.id).join(", ")}.` : `Tolerances: price ±${TOLERANCE.pricePct}% of PO, quantity ±${TOLERANCE.qtyPct}% of cumulative receipts, tax code must equal the PO.`,
    },
    {
      id: "paid", control: "No invoice approved or paid without a match",
      result: bad.length ? `${plural(bad.length, "invoice")} approved or paid without a clean match: ${bad.map((i) => i.id).join(", ")}.` : `0 of ${done.length} approved or paid invoices lack a clean match.`,
      status: bad.length ? "attention" : "pass",
      detail: resolvedBefore.length ? `${plural(resolvedBefore.length, "invoice")} (${resolvedBefore.map((i) => i.id).join(", ")}) carry an earlier flag and were resolved before approval. They predate the audit trail, so no workflow record exists for them.` : undefined,
    },
    {
      id: "thresholds", control: "Approval thresholds applied",
      result: wrongBand.length
        ? `${plural(wrongBand.length, "decision")} taken at the wrong level: ${wrongBand.map((i) => i.id).join(", ")}.`
        : `${plural(liveApproved.length, "decision")} recorded in this system, all at the level the amount requires.`,
      status: wrongBand.length ? "attention" : "pass",
      detail: `Up to ₹${THRESHOLDS.clerkMax.toLocaleString("en-IN")}: clerk releases. Up to ₹${THRESHOLDS.l1Max.toLocaleString("en-IN")}: Approver L1. Above: Approver L2. Approvals by role: AP clerk ${byRole.clerk}, Approver L1 ${byRole.L1}, Approver L2 ${byRole.L2}. Waiting now: clerk ${inBand("clerk")}, L1 ${inBand("L1")}, L2 ${inBand("L2")}.`,
    },
    {
      id: "sod", control: "Segregation of duties",
      result: `${plural(involved.length, "approval")} by someone who submitted or worked on the invoice. ${plural(sodRefused.length, "such attempt")} refused and logged; ${plural(refused.length, "refusal")} in all (wrong role, limit or involvement).`,
      status: involved.length ? "attention" : "pass",
      detail: "A person who submitted, edited, released or raised tasks on an invoice cannot approve it. An approver who rejected it cannot approve it in the same cycle.",
    },
    {
      id: "duplicates", control: "Duplicate invoices stopped",
      result: `${plural(dupInvoices.length, "possible duplicate")} detected: ${dupOpenBlocked} blocked now, ${dupConfirmed} confirmed, ${dupDismissed} dismissed with a reason. ${paidDup.length} approved or paid without a clerk's decision.`,
      status: paidDup.length ? "attention" : "pass",
    },
    {
      id: "audit", control: "Audit trail is complete and unaltered",
      result: chain.ok ? `Chain intact: ${plural(chain.count, "record")} verified, each hashed with the one before it.` : `Chain broken at record #${chain.brokenSeq}. ${chain.reason}`,
      status: chain.ok ? "pass" : "attention",
      detail: `Verified ${fmtDateTime(stamp)} IST. Records start when this system starts; invoices seeded before that have none.`,
    },
  ];

  // Sample evidence: a few invoices with a full decision record, each linking to its audit records.
  const evidence = s.invoices
    .filter((i) => s.auditEvents.some((e) => e.invoiceId === i.id))
    .sort((a, b) => s.auditEvents.filter((e) => e.invoiceId === b.id).length - s.auditEvents.filter((e) => e.invoiceId === a.id).length)
    .slice(0, 4)
    .map((i) => ({ label: i.id, invoiceId: i.id, why: `${plural(s.auditEvents.filter((e) => e.invoiceId === i.id).length, "audit record")}, currently ${i.status.replace("_", " ")}` }));

  return {
    generatedAt: stamp, chain, lines,
    exceptions: {
      open: dash.kpi.open, blockedValue: dash.kpi.blockedValue, resolved: dash.resolvedCount,
      topCause: dash.causes[0] && { cause: dash.causes[0].cause, cases: dash.causes[0].cases },
      byType: dash.byType.map((t) => ({ label: t.label, findings: t.findings })),
    },
    evidence,
    scope: { invoices: s.invoices.length, matched: matched.length, approvedOrPaid: done.length, auditRecords: s.auditEvents.length },
  };
}
