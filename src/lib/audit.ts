// Append-only, hash-chained audit log. Each event's hash = sha256(its own fields + the previous event's hash),
// so changing, deleting or reordering any record breaks every hash after it.
// Pure (no server-only import): the tamper script and the tests use it too.
import crypto from "node:crypto";
import type { AppState, AuditEvent } from "./types";
import { findUser } from "./users";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  actor: string;
  /** Defaults to the actor's role from the demo accounts, or "system". */
  role?: string;
  action: string;
  invoiceId?: string;
  detail: string;
  before?: string;
  after?: string;
  reason?: string;
}

type Hashed = Omit<AuditEvent, "hash">;

/** The hash of one event. Events written before role/before/after/reason existed hash the same way as they always did. */
export function eventHash(e: Hashed): string {
  const fields: (string | number)[] = [e.seq, e.at, e.actor, e.action, e.invoiceId ?? "", e.detail, e.prevHash];
  if (e.role !== undefined || e.before !== undefined || e.after !== undefined || e.reason !== undefined) {
    fields.push(e.role ?? "", e.before ?? "", e.after ?? "", e.reason ?? "");
  }
  return crypto.createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function appendAudit(s: AppState, e: AuditInput, at = new Date().toISOString()): AuditEvent {
  const prev = s.auditEvents[s.auditEvents.length - 1];
  const base: Hashed = {
    seq: (prev?.seq ?? 0) + 1,
    at,
    actor: e.actor,
    role: e.role ?? (e.actor === "system" ? "system" : findUser(e.actor)?.role ?? "unknown"),
    action: e.action,
    invoiceId: e.invoiceId,
    detail: e.detail,
    ...(e.before !== undefined ? { before: e.before } : {}),
    ...(e.after !== undefined ? { after: e.after } : {}),
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
    prevHash: prev?.hash ?? GENESIS_HASH,
  };
  const event: AuditEvent = { ...base, hash: eventHash(base) };
  s.auditEvents.push(event);
  return event;
}

export type ChainResult =
  | { ok: true; count: number }
  | { ok: false; count: number; brokenSeq: number; reason: string };

/** Recompute every hash from the first record. Reports the first record that does not match. */
export function verifyChain(events: AuditEvent[]): ChainResult {
  let prevHash = GENESIS_HASH;
  let prevSeq = 0;
  for (const e of events) {
    if (e.seq !== prevSeq + 1) return { ok: false, count: events.length, brokenSeq: e.seq, reason: `Record ${e.seq} follows record ${prevSeq}: a record is missing or out of order.` };
    if (e.prevHash !== prevHash) return { ok: false, count: events.length, brokenSeq: e.seq, reason: `Record ${e.seq} does not link to the record before it.` };
    const { hash, ...rest } = e;
    if (eventHash(rest) !== hash) return { ok: false, count: events.length, brokenSeq: e.seq, reason: `Record ${e.seq} (${e.action}) has been changed since it was written.` };
    prevHash = hash;
    prevSeq = e.seq;
  }
  return { ok: true, count: events.length };
}
