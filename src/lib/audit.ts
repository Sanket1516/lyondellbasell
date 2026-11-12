// Minimal append-only, hash-chained audit log helper. T4 builds the viewer and extends the events.
import crypto from "node:crypto";
import type { AppState } from "./types";

const GENESIS = "0".repeat(64);

export function appendAudit(s: AppState, e: { actor: string; action: string; invoiceId?: string; detail: string }, at = new Date().toISOString()) {
  const prev = s.auditEvents[s.auditEvents.length - 1];
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS;
  const hash = crypto.createHash("sha256").update(JSON.stringify([seq, at, e.actor, e.action, e.invoiceId ?? "", e.detail, prevHash])).digest("hex");
  s.auditEvents.push({ seq, at, actor: e.actor, action: e.action, invoiceId: e.invoiceId, detail: e.detail, prevHash, hash });
}
