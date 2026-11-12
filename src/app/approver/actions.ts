"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { updateState } from "@/lib/store";
import { decideApproval, type Decision } from "@/lib/workflow";

/** Approve, reject or send back. Any signed-in user may call this; the service layer enforces role, limit and segregation of duties. */
export async function decideAction(invoiceId: string, decision: Decision, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await getSessionUser();
  if (!u) return { ok: false, error: "Please sign in." };
  const r = updateState((s) => decideApproval(s, { username: u.username, role: u.role, approverLevel: u.approverLevel }, String(invoiceId), decision, String(reason ?? "")));
  revalidatePath("/", "layout");
  return r;
}
