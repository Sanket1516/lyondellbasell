// Runs the engine against the app state and records the outcome.
// matchInState works on a state object (callers persist); rematch() is the entry point T4 uses after PO/GR changes.
import { matchInvoice } from "../engine/match";
import { appendAudit } from "./audit";
import { DEMO_TODAY } from "./constants";
import { updateState } from "./store";
import type { AppState, Finding, InvoiceStatus, Verdict } from "./types";

/** Status an invoice takes after matching. Approved and paid invoices are never moved backwards. */
export const STATUS_AFTER_MATCH: Record<Verdict, InvoiceStatus> = {
  approve: "pending_approval", // clean: waiting for release or approval (T4)
  flag: "pending_owner",
  block: "blocked",
};
const MOVABLE: InvoiceStatus[] = ["received", "matched", "pending_owner", "pending_approval", "blocked"];

const signature = (fs: Finding[]) => JSON.stringify(fs.map(({ id: _id, ...rest }) => rest));

/** Recompute findings, verdict and status for one invoice. Idempotent: an unchanged result writes no event. */
export function matchInState(s: AppState, invoiceId: string, actor = "system"): { verdict: Verdict; changed: boolean } | undefined {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return undefined;
  const result = matchInvoice(inv, s, DEMO_TODAY);
  const before = s.findings.filter((f) => f.invoiceId === invoiceId);
  const first = inv.verdict === undefined && before.length === 0;
  const changed = first || inv.verdict !== result.verdict || signature(before) !== signature(result.findings);

  s.findings = s.findings.filter((f) => f.invoiceId !== invoiceId).concat(result.findings);
  inv.verdict = result.verdict;
  if (MOVABLE.includes(inv.status)) inv.status = STATUS_AFTER_MATCH[result.verdict];

  if (changed) {
    appendAudit(s, {
      actor,
      action: first ? "match_run" : "rematch",
      invoiceId,
      detail: `${first ? "Matched" : "Re-matched"} against PO, receipts, contract and delivery note: ${result.summary}`,
    });
  }
  return { verdict: result.verdict, changed };
}

/** Recompute after any change to PO, receipt, contract or delivery-note data (T4 calls this). */
export function rematch(invoiceId: string, actor = "system") {
  return updateState((s) => matchInState(s, invoiceId, actor));
}

export type DecisionResult = { ok: true } | { ok: false; error: string };

/** A clerk's call on a possible duplicate. A reason is always required. */
export function applyDuplicateDecision(
  s: AppState, invoiceId: string, decision: "duplicate" | "not_duplicate", reason: string, actor: string, at = new Date().toISOString(),
): DecisionResult {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return { ok: false, error: "That invoice was not found." };
  const dup = s.findings.find((f) => f.invoiceId === invoiceId && f.kind === "duplicate");
  if (!dup?.matchedInvoiceId) return { ok: false, error: "This invoice has no duplicate finding to decide on." };
  const why = reason.trim();
  if (why.length < 8) return { ok: false, error: "Give a reason of at least a few words. It is saved in the audit trail." };
  inv.duplicateDecision = { decision, matchedInvoiceId: dup.matchedInvoiceId, by: actor, reason: why.slice(0, 400), at };
  appendAudit(s, {
    actor, action: decision === "duplicate" ? "duplicate_confirmed" : "duplicate_dismissed", invoiceId,
    detail: `${decision === "duplicate" ? "Confirmed duplicate of" : "Not a duplicate of"} ${dup.matchedInvoiceId}. Reason: ${why.slice(0, 400)}`,
  }, at);
  matchInState(s, invoiceId, actor);
  return { ok: true };
}
