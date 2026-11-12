"use server";
import { revalidatePath } from "next/cache";
import { applyDuplicateDecision, matchInState } from "@/lib/matching";
import { getSessionUser } from "@/lib/session";
import { updateState } from "@/lib/store";

export type ClerkResult = { ok: true } | { ok: false; error: string };

async function clerk() {
  const u = await getSessionUser();
  return u && u.role === "clerk" ? u : undefined;
}

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
