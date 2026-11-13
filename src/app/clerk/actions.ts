"use server";
import { revalidatePath } from "next/cache";
import { applyDuplicateDecision, matchInState } from "@/lib/matching";
import { getSessionUser } from "@/lib/session";
import { updateState } from "@/lib/store";
import { releaseInvoice, reopenInvoice, requestFix, simulateErpUpdate, type Actor } from "@/lib/workflow";

export type ClerkResult = { ok: true } | { ok: false; error: string };

async function clerk() {
  const u = await getSessionUser();
  return u && u.role === "clerk" ? u : undefined;
}

/** Workflow actions accept any signed-in user and let the service layer refuse (and log) the wrong role. */
async function actor(): Promise<Actor | undefined> {
  const u = await getSessionUser();
  return u ? { username: u.username, role: u.role, approverLevel: u.approverLevel } : undefined;
}
const SIGN_IN = { ok: false as const, error: "Please sign in." };

/** Confirm or dismiss a possible duplicate. A reason is required and goes into the audit trail. */
export async function decideDuplicate(invoiceId: string, decision: "duplicate" | "not_duplicate", reason: string): Promise<ClerkResult> {
  const u = await clerk();
  if (!u) return { ok: false, error: "Please sign in as an AP clerk." };
  if (decision !== "duplicate" && decision !== "not_duplicate") return { ok: false, error: "Choose Confirm duplicate or Not a duplicate." };
  const r = updateState((s) => applyDuplicateDecision(s, String(invoiceId), decision, String(reason ?? ""), u.username));
  if (r.ok) revalidatePath("/clerk", "layout");
  return r;
}

/** Recompute the findings from the current PO, receipt and contract data. */
export async function rerunMatch(invoiceId: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const u = await clerk();
  if (!u) return { ok: false, error: "Please sign in as an AP clerk." };
  const r = updateState((s) => matchInState(s, String(invoiceId), u.username));
  if (!r) return { ok: false, error: "That invoice was not found." };
  revalidatePath("/clerk", "layout");
  return { ok: true, changed: r.changed };
}

/** Ask the owner named on a finding to fix it. */
export async function requestFixAction(invoiceId: string, findingId: string): Promise<ClerkResult> {
  const a = await actor();
  if (!a) return SIGN_IN;
  const r = updateState((s) => requestFix(s, a, String(invoiceId), String(findingId)));
  revalidatePath("/", "layout");
  return r.ok ? { ok: true } : r;
}

/** Send a finding back to the supplier with a note. The supplier corrects the invoice and uploads it again. */
export async function sendToSupplierAction(invoiceId: string, findingId: string, note: string): Promise<ClerkResult> {
  const a = await actor();
  if (!a) return SIGN_IN;
  const r = updateState((s) => requestFix(s, a, String(invoiceId), String(findingId), undefined, { toSupplier: true, note: String(note ?? "") }));
  revalidatePath("/", "layout");
  return r.ok ? { ok: true } : r;
}

/** Demo control: apply the owner's fix to the seed data, then re-match. */
export async function simulateErpAction(taskId: string): Promise<{ ok: true; summary: string; verdict: string } | { ok: false; error: string }> {
  const a = await actor();
  if (!a) return SIGN_IN;
  const r = updateState((s) => simulateErpUpdate(s, a, String(taskId)));
  revalidatePath("/", "layout");
  return r;
}

export async function releaseAction(invoiceId: string): Promise<ClerkResult> {
  const a = await actor();
  if (!a) return SIGN_IN;
  const r = updateState((s) => releaseInvoice(s, a, String(invoiceId)));
  revalidatePath("/", "layout");
  return r;
}

export async function reopenAction(invoiceId: string, reason: string): Promise<ClerkResult> {
  const a = await actor();
  if (!a) return SIGN_IN;
  const r = updateState((s) => reopenInvoice(s, a, String(invoiceId), String(reason ?? "")));
  revalidatePath("/", "layout");
  return r;
}
