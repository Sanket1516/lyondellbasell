"use server";
import { verifyChain, type ChainResult } from "@/lib/audit";
import { getSessionUser } from "@/lib/session";
import { readSavedAuditEvents } from "@/lib/store";

/** Recompute every hash in the saved audit log and report the first broken record. */
export async function verifyAuditChain(): Promise<ChainResult | { ok: false; error: string }> {
  const u = await getSessionUser();
  if (!u || (u.role !== "clerk" && u.role !== "approver")) return { ok: false, error: "Only the AP clerk and approvers can verify the audit trail." };
  return verifyChain(readSavedAuditEvents());
}
