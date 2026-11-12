"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { verifyAuditChain } from "./actions";
import s from "./Audit.module.css";

export function VerifyChain() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    const r = await verifyAuditChain().catch(() => ({ ok: false as const, error: "The check could not run." }));
    setBusy(false);
    if ("error" in r) setMsg({ ok: false, text: r.error });
    else if (r.ok) setMsg({ ok: true, text: `Chain intact. ${r.count} records checked, each linked to the one before it.` });
    else setMsg({ ok: false, text: `Chain broken at record #${r.brokenSeq}. ${r.reason}` });
  }

  return (
    <div className={s.verify}>
      <Button variant="primary" onClick={run} disabled={busy}>{busy ? "Checking…" : "Verify chain"}</Button>
      {msg && <p role="status" className={msg.ok ? s.intact : s.broken}>{msg.text}</p>}
    </div>
  );
}
