"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import type { Decision } from "@/lib/workflow";
import { decideAction } from "../../actions";
import s from "../../Approver.module.css";

export function DecisionForm({ invoiceId, canApprove, blockedReason }: { invoiceId: string; canApprove: boolean; blockedReason?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(d: Decision) {
    setError(null);
    if (d !== "approve" && reason.trim().length < 8) return setError("Give a reason of at least a few words. It is saved in the audit trail.");
    setBusy(true);
    const r = await decideAction(invoiceId, d, reason).catch(() => ({ ok: false as const, error: "The decision could not be saved." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); router.refresh(); return; }
    toast.show(d === "approve" ? "Approved. Marked ready for payment." : d === "reject" ? "Rejected" : "Sent back to the AP clerk");
    router.push("/approver");
    router.refresh();
  }

  return (
    <form className={s.form} onSubmit={(e) => e.preventDefault()}>
      {!canApprove && blockedReason && <p className={s.err} role="note">You cannot approve this invoice: {blockedReason}</p>}
      <label htmlFor="reason" className={s.label}>Reason (required to reject or send back; optional note when approving)</label>
      <textarea id="reason" className={s.textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: price evidence is not attached, ask the buyer to confirm" />
      {error && <p role="alert" className={s.err}>{error}</p>}
      <div className={s.btns}>
        <Button variant="primary" type="button" disabled={busy || !canApprove} onClick={() => go("approve")}>Approve</Button>
        <Button type="button" disabled={busy} onClick={() => go("send_back")}>Send back</Button>
        <Button type="button" disabled={busy} onClick={() => go("reject")}>Reject</Button>
      </div>
      {toast.node}
    </form>
  );
}
