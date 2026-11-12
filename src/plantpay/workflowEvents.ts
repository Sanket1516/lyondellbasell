// Stage 2: workflow_events. The business history of every invoice (received, department assigned, review started/completed,
// exception raised/resolved, approval requested/granted, payment status changed). Each event is also written into the
// hash-chained audit trail, carrying a SHA-256 of the event's canonical JSON. So:
//   - editing or reordering the audit trail is caught by the chain (verify_chain, first broken link reported), and
//   - editing or deleting a workflow_events row is caught by comparing it with the hash its audit entry recorded.
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { appendAudit, readAudit, verifyAudit } from "./integration";

export const WORKFLOW_EVENT_TYPES = [
  "invoice_received", "department_assigned", "review_started", "review_completed", "exception_raised", "exception_resolved",
  "approval_requested", "approval_granted", "payment_status_changed",
] as const;
export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];

export const WORKFLOW_DDL = `
CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (${WORKFLOW_EVENT_TYPES.map((t) => `'${t}'`).join(",")})),
  actor TEXT NOT NULL, department TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload)),
  content_hash TEXT NOT NULL, audit_seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_invoice ON workflow_events (invoice_id, id);
CREATE INDEX IF NOT EXISTS idx_wf_type ON workflow_events (event_type);
`;

export interface WorkflowEvent { id: number; invoiceId: string; type: WorkflowEventType; actor: string; department: string; at: string; payload: Record<string, unknown>; auditSeq: number }
export interface WorkflowEventInput { invoiceId: string; type: WorkflowEventType; actor: string; department: string; at?: string; payload?: Record<string, unknown> }

/** JSON with keys sorted at every level, so the same event always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const eventContentHash = (e: { invoiceId: string; type: string; actor: string; department: string; at: string; payload: unknown }) =>
  crypto.createHash("sha256").update(canonicalJson({ invoiceId: e.invoiceId, type: e.type, actor: e.actor, department: e.department, at: e.at, payload: e.payload })).digest("hex");

type Row = { id: number; invoice_id: string; event_type: WorkflowEventType; actor: string; department: string; at: string; payload: string; content_hash: string; audit_seq: number };
const toEvent = (r: Row): WorkflowEvent => ({ id: r.id, invoiceId: r.invoice_id, type: r.event_type, actor: r.actor, department: r.department, at: r.at, payload: JSON.parse(r.payload), auditSeq: r.audit_seq });

/** Record one event and append its audit entry, atomically. */
export function recordWorkflowEvent(db: Database.Database, e: WorkflowEventInput): WorkflowEvent {
  const at = e.at ?? new Date().toISOString();
  const payload = e.payload ?? {};
  return db.transaction(() => {
    const hash = eventContentHash({ ...e, at, payload });
    const audit = appendAudit(db, { actor: e.actor, role: e.department, action: `wf_${e.type}`, invoiceId: e.invoiceId, detail: `${e.department}: ${summarisePayload(payload)} [event sha256 ${hash}]` }, at);
    const id = Number(db.prepare("INSERT INTO workflow_events (invoice_id, event_type, actor, department, at, payload, content_hash, audit_seq) VALUES (?,?,?,?,?,?,?,?)").run(e.invoiceId, e.type, e.actor, e.department, at, JSON.stringify(payload), hash, audit.seq).lastInsertRowid);
    return { id, invoiceId: e.invoiceId, type: e.type, actor: e.actor, department: e.department, at, payload, auditSeq: audit.seq };
  })();
}
const summarisePayload = (p: Record<string, unknown>) => Object.entries(p).map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v)}`).join("; ") || "no detail";

export const workflowEventsFor = (db: Database.Database, invoiceId: string): WorkflowEvent[] =>
  (db.prepare("SELECT * FROM workflow_events WHERE invoice_id = ? ORDER BY at, id").all(invoiceId) as Row[]).map(toEvent);

/** Every event, grouped by invoice and in time order. Used by the process-mining twin. */
export function allWorkflowEventsByInvoice(db: Database.Database): Map<string, WorkflowEvent[]> {
  const m = new Map<string, WorkflowEvent[]>();
  for (const r of db.prepare("SELECT * FROM workflow_events ORDER BY at, id").all() as Row[]) { const e = toEvent(r); (m.get(e.invoiceId) ?? m.set(e.invoiceId, []).get(e.invoiceId)!).push(e); }
  return m;
}

export function listWorkflowEvents(db: Database.Database, f: { type?: string; invoiceId?: string; limit?: number; offset?: number } = {}): { total: number; events: WorkflowEvent[] } {
  const where: string[] = []; const args: unknown[] = [];
  if (f.type) { where.push("event_type = ?"); args.push(f.type); }
  if (f.invoiceId) { where.push("invoice_id = ?"); args.push(f.invoiceId); }
  const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM workflow_events${w}`).get(...args) as { n: number }).n;
  const events = (db.prepare(`SELECT * FROM workflow_events${w} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(f.limit ?? 100, 1000), f.offset ?? 0) as Row[]).map(toEvent);
  return { total, events };
}
export const workflowEventCounts = (db: Database.Database): Record<string, number> =>
  Object.fromEntries((db.prepare("SELECT event_type t, COUNT(*) n FROM workflow_events GROUP BY event_type").all() as { t: string; n: number }[]).map((r) => [r.t, r.n]));

// ---------------------------------------------------------------- integrity
export type IntegrityReport =
  | { ok: true; auditEntries: number; workflowEvents: number }
  | { ok: false; kind: "audit_chain" | "workflow_event"; position: number; reason: string; auditEntries: number; workflowEvents: number };

/**
 * verify_chain for the whole system. First the audit hash chain (reports the first broken link by position), then every workflow
 * event row against the hash its audit entry recorded (reports an edited row, or an event whose row was deleted).
 */
export function verifyIntegrity(db: Database.Database): IntegrityReport {
  const chain = verifyAudit(db);
  const wfCount = (db.prepare("SELECT COUNT(*) n FROM workflow_events").get() as { n: number }).n;
  if (!chain.ok) return { ok: false, kind: "audit_chain", position: chain.brokenSeq, reason: chain.reason, auditEntries: chain.count, workflowEvents: wfCount };
  const rows = db.prepare("SELECT * FROM workflow_events ORDER BY id").all() as Row[];
  const bySeq = new Map(rows.map((r) => [r.audit_seq, r]));
  const audit = readAudit(db);
  for (const a of audit) {
    if (!a.action.startsWith("wf_")) continue;
    const row = bySeq.get(a.seq);
    const recorded = /\[event sha256 ([0-9a-f]{64})\]/.exec(a.detail)?.[1];
    if (!row) return { ok: false, kind: "workflow_event", position: a.seq, reason: `Audit record ${a.seq} says a workflow event happened (${a.action.slice(3)} on ${a.invoiceId}), but that event is missing from workflow_events.`, auditEntries: chain.count, workflowEvents: wfCount };
    const actual = eventContentHash({ invoiceId: row.invoice_id, type: row.event_type, actor: row.actor, department: row.department, at: row.at, payload: JSON.parse(row.payload) });
    if (actual !== recorded || row.content_hash !== recorded) return { ok: false, kind: "workflow_event", position: a.seq, reason: `Workflow event ${row.id} (${row.event_type} on ${row.invoice_id}) has been changed since it was recorded; it no longer matches audit record ${a.seq}.`, auditEntries: chain.count, workflowEvents: wfCount };
  }
  return { ok: true, auditEntries: chain.count, workflowEvents: wfCount };
}
