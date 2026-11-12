// Integration-layer state: event outbox, hash-chained audit trail, API keys, source health/outage toggles,
// workflow tasks and stored evaluations. Lives in its own SQLite file (data/plantpay-integration.db); the six source
// databases are never written here. The audit chain reuses the app's hash algorithm (src/lib/audit.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { GENESIS_HASH, eventHash, verifyChain, type AuditInput, type ChainResult } from "../lib/audit";
import type { AuditEvent } from "../lib/types";
import { SOURCE_IDS, type SourceId } from "./sources/schemas";
import { WORKFLOW_DDL } from "./workflowEvents";

export const INTEGRATION_DB_FILE = process.env.PLANTPAY_INTEGRATION_DB ?? path.join(process.cwd(), "data", "plantpay-integration.db");
/** Demo API key for the REST facade (fictional; documented in NOTES.md). Only its hash is stored. */
export const DEMO_API_KEY = "pp_demo_key_2026";

const DDL = `
CREATE TABLE IF NOT EXISTS source_state (source TEXT PRIMARY KEY, outage INTEGER NOT NULL DEFAULT 0, last_sync TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload)), at TEXT NOT NULL, processed_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events (seq INTEGER PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)), hash TEXT NOT NULL, prev_hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TABLE IF NOT EXISTS api_keys (key_hash TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, department TEXT NOT NULL, check_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, closed_at TEXT, UNIQUE (invoice_id, department, check_id));
CREATE TABLE IF NOT EXISTS duplicate_decisions (invoice_id TEXT PRIMARY KEY, matched_invoice_id TEXT NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('duplicate','not_duplicate')), decided_by TEXT NOT NULL, reason TEXT NOT NULL, decided_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_invoices (invoice_id TEXT PRIMARY KEY, file TEXT NOT NULL, purpose TEXT NOT NULL, expected TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluations (invoice_id TEXT PRIMARY KEY, evaluated_at TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT NOT NULL);
`;

export type EventType = "invoice_received" | "grn_posted" | "inspection_completed" | "bank_details_changed" | "weighbridge_recorded" | "contract_amended" | "po_amended" | "invoice_corrected" | "master_data_changed";
export interface PlantPayEvent { seq: number; type: EventType; source: SourceId; payload: Record<string, unknown>; at: string; processedAt?: string }

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function openIntegrationDb(file = INTEGRATION_DB_FILE): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(DDL);
  db.exec(WORKFLOW_DDL);
  const st = db.prepare("INSERT OR IGNORE INTO source_state (source) VALUES (?)");
  for (const id of SOURCE_IDS) st.run(id);
  db.prepare("INSERT OR IGNORE INTO api_keys (key_hash, name, created_at) VALUES (?,?,?)").run(sha(DEMO_API_KEY), "demo-key", "2026-11-12T00:00:00.000Z");
  return db;
}

// ---------------------------------------------------------------- API keys
export function verifyApiKey(db: Database.Database, key: string | null | undefined): { ok: boolean; name?: string } {
  if (!key) return { ok: false };
  const row = db.prepare("SELECT name FROM api_keys WHERE key_hash = ?").get(sha(key)) as { name: string } | undefined;
  return row ? { ok: true, name: row.name } : { ok: false };
}

// ---------------------------------------------------------------- source state
export interface SourceState { source: SourceId; outage: boolean; lastSync: string | null; lastError: string | null }
export function getSourceStates(db: Database.Database): SourceState[] {
  return (db.prepare("SELECT * FROM source_state").all() as { source: SourceId; outage: number; last_sync: string | null; last_error: string | null }[])
    .map((r) => ({ source: r.source, outage: !!r.outage, lastSync: r.last_sync, lastError: r.last_error }))
    .sort((a, b) => SOURCE_IDS.indexOf(a.source) - SOURCE_IDS.indexOf(b.source));
}
export const isOutage = (db: Database.Database, id: SourceId) => !!(db.prepare("SELECT outage FROM source_state WHERE source = ?").get(id) as { outage: number }).outage;
export function setOutage(db: Database.Database, id: SourceId, outage: boolean) {
  db.prepare("UPDATE source_state SET outage = ?, last_error = ? WHERE source = ?").run(outage ? 1 : 0, outage ? "Simulated outage (demo toggle)" : null, id);
}
export function touchSync(db: Database.Database, id: SourceId, at: string) { db.prepare("UPDATE source_state SET last_sync = ?, last_error = NULL WHERE source = ? AND outage = 0").run(at, id); }
export function recordSourceError(db: Database.Database, id: SourceId, message: string) { db.prepare("UPDATE source_state SET last_error = ? WHERE source = ?").run(message, id); }

// ---------------------------------------------------------------- audit trail (hash-chained)
export function appendAudit(db: Database.Database, e: AuditInput, at = new Date().toISOString()): AuditEvent {
  return db.transaction(() => {
    const prev = db.prepare("SELECT data FROM audit_events ORDER BY seq DESC LIMIT 1").get() as { data: string } | undefined;
    const prevEvt = prev ? (JSON.parse(prev.data) as AuditEvent) : undefined;
    const base: Omit<AuditEvent, "hash"> = {
      seq: (prevEvt?.seq ?? 0) + 1, at, actor: e.actor, role: e.role ?? (e.actor === "system" ? "system" : "unknown"), action: e.action, invoiceId: e.invoiceId, detail: e.detail,
      ...(e.before !== undefined ? { before: e.before } : {}), ...(e.after !== undefined ? { after: e.after } : {}), ...(e.reason !== undefined ? { reason: e.reason } : {}),
      prevHash: prevEvt?.hash ?? GENESIS_HASH,
    };
    const evt: AuditEvent = { ...base, hash: eventHash(base) };
    db.prepare("INSERT INTO audit_events (seq, data, hash, prev_hash) VALUES (?,?,?,?)").run(evt.seq, JSON.stringify(evt), evt.hash, evt.prevHash);
    return evt;
  })();
}
export const readAudit = (db: Database.Database, limit?: number): AuditEvent[] =>
  (db.prepare(`SELECT data FROM audit_events ORDER BY seq ${limit ? "DESC LIMIT " + Math.floor(limit) : ""}`).all() as { data: string }[]).map((r) => JSON.parse(r.data) as AuditEvent);
/** Alias with the name used in the brief: recompute the whole chain and report the first broken link. */
export const verify_chain = (events: AuditEvent[]): ChainResult => verifyChain(events);
export const verifyAudit = (db: Database.Database): ChainResult => verifyChain((db.prepare("SELECT data FROM audit_events ORDER BY seq").all() as { data: string }[]).map((r) => JSON.parse(r.data) as AuditEvent));

// ---------------------------------------------------------------- event stream (SQLite outbox)
export function emitEvent(db: Database.Database, type: EventType, source: SourceId, payload: Record<string, unknown>, at = new Date().toISOString()): number {
  const seq = Number(db.prepare("INSERT INTO outbox (type, source, payload, at) VALUES (?,?,?,?)").run(type, source, JSON.stringify(payload), at).lastInsertRowid);
  appendAudit(db, { actor: "system", role: "system", action: `event_${type}`, invoiceId: typeof payload.invoiceId === "string" ? payload.invoiceId : undefined, detail: `${source}: ${JSON.stringify(payload)}` }, at);
  return seq;
}
const rowToEvent = (r: { seq: number; type: EventType; source: SourceId; payload: string; at: string; processed_at: string | null }): PlantPayEvent =>
  ({ seq: r.seq, type: r.type, source: r.source, payload: JSON.parse(r.payload), at: r.at, processedAt: r.processed_at ?? undefined });
export const pendingEvents = (db: Database.Database): PlantPayEvent[] => (db.prepare("SELECT * FROM outbox WHERE processed_at IS NULL ORDER BY seq").all() as never[]).map(rowToEvent);
export const recentEvents = (db: Database.Database, limit = 30): PlantPayEvent[] => (db.prepare("SELECT * FROM outbox ORDER BY seq DESC LIMIT ?").all(limit) as never[]).map(rowToEvent);
export const markProcessed = (db: Database.Database, seq: number, at: string) => { db.prepare("UPDATE outbox SET processed_at = ? WHERE seq = ?").run(at, seq); };

// ---------------------------------------------------------------- tasks
export interface WorkflowTask { id: number; invoiceId: string; department: string; checkId: string; title: string; status: "open" | "done"; createdAt: string; closedAt?: string }
const rowToTask = (r: { id: number; invoice_id: string; department: string; check_id: string; title: string; status: "open" | "done"; created_at: string; closed_at: string | null }): WorkflowTask =>
  ({ id: r.id, invoiceId: r.invoice_id, department: r.department, checkId: r.check_id, title: r.title, status: r.status, createdAt: r.created_at, closedAt: r.closed_at ?? undefined });
export function tasksFor(db: Database.Database, invoiceId?: string): WorkflowTask[] {
  const rows = (invoiceId ? db.prepare("SELECT * FROM workflow_tasks WHERE invoice_id = ? ORDER BY id").all(invoiceId) : db.prepare("SELECT * FROM workflow_tasks ORDER BY id DESC LIMIT 200").all()) as never[];
  return rows.map(rowToTask);
}
export function openTaskCounts(db: Database.Database): Record<string, number> {
  const o: Record<string, number> = {};
  for (const r of db.prepare("SELECT department, COUNT(*) n FROM workflow_tasks WHERE status = 'open' GROUP BY department").all() as { department: string; n: number }[]) o[r.department] = r.n;
  return o;
}

// ---------------------------------------------------------------- evaluations
export const saveEvaluation = (db: Database.Database, invoiceId: string, status: string, at: string, json: string) => {
  db.prepare("INSERT INTO evaluations (invoice_id, evaluated_at, status, result_json) VALUES (?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET evaluated_at=excluded.evaluated_at, status=excluded.status, result_json=excluded.result_json").run(invoiceId, at, status, json);
};
export const getStoredEvaluation = (db: Database.Database, invoiceId: string): string | undefined => (db.prepare("SELECT result_json FROM evaluations WHERE invoice_id = ?").get(invoiceId) as { result_json: string } | undefined)?.result_json;
