// SQLite database for all app data. Used by src/lib/store.ts (the app) and by scripts/ (reset, tamper).
// No "server-only" import here so the tsx scripts can use it too; the app reaches it only through store.ts.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { USERS } from "./users";
import type { AppState, AuditEvent } from "./types";

export const DB_FILE = process.env.PLANTX_DB_FILE ?? path.join(process.cwd(), "data", "plantx.db");
export const SCHEMA_VERSION = 1;

type Key = Exclude<keyof AppState, "version">;

/** App collection -> table name. Order matters for the seed file list. */
export const TABLES: Record<Key, string> = {
  vendors: "vendors",
  purchaseOrders: "purchase_orders",
  goodsReceipts: "goods_receipts",
  contracts: "contracts",
  deliveryNotes: "delivery_notes",
  uomRules: "uom_rules",
  invoices: "invoices",
  findings: "findings",
  tasks: "tasks",
  auditEvents: "audit_events",
};
export const KEYS = Object.keys(TABLES) as Key[];

/** Primary key of one record. Most records have an id; audit events have a seq; UoM rules are keyed by item and units. */
export function rowKey(key: Key, r: Record<string, unknown>): string {
  if (key === "auditEvents") return String(r.seq);
  if (key === "uomRules") return `${r.itemCode}|${r.fromUom}|${r.toUom}`;
  return String(r.id);
}

const AUDIT_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;`;

function schemaSql(): string {
  const tables = KEYS.filter((k) => k !== "auditEvents").map((k) => `
CREATE TABLE IF NOT EXISTS ${TABLES[k]} (
  pk   TEXT PRIMARY KEY,
  pos  INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);`).join("\n");
  return `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  role          TEXT NOT NULL,
  vendor_id     TEXT,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
${tables}
CREATE TABLE IF NOT EXISTS audit_events (
  pk        TEXT PRIMARY KEY,
  pos       INTEGER NOT NULL,
  seq       INTEGER NOT NULL UNIQUE,
  hash      TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  data      TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (json_extract(data, '$.status'));
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices (json_extract(data, '$.vendorId'));
CREATE INDEX IF NOT EXISTS idx_invoices_po     ON invoices (json_extract(data, '$.poId'));
CREATE INDEX IF NOT EXISTS idx_findings_invoice ON findings (json_extract(data, '$.invoiceId'));
CREATE INDEX IF NOT EXISTS idx_tasks_invoice    ON tasks (json_extract(data, '$.invoiceId'));
${AUDIT_TRIGGERS}`;
}

export function openDb(file = DB_FILE): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 3000");
  db.exec(schemaSql());
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?), ('revision', '0')").run(String(SCHEMA_VERSION));
  seedUsers(db);
  return db;
}

export function getRevision(db: Database.Database): number {
  return Number((db.prepare("SELECT value FROM meta WHERE key = 'revision'").get() as { value: string }).value);
}

function bumpRevision(db: Database.Database): number {
  db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'").run();
  return getRevision(db);
}

export function isEmpty(db: Database.Database): boolean {
  return (db.prepare("SELECT value FROM meta WHERE key = 'seeded_at'").get() as unknown) === undefined;
}

export function loadAll(db: Database.Database): AppState {
  const state = { version: 1 } as AppState;
  for (const k of KEYS) {
    const rows = db.prepare(`SELECT data FROM ${TABLES[k]} ORDER BY pos`).all() as { data: string }[];
    (state[k] as unknown[]) = rows.map((r) => JSON.parse(r.data));
  }
  return state;
}

export function loadAuditEvents(db: Database.Database): AuditEvent[] {
  return (db.prepare("SELECT data FROM audit_events ORDER BY seq").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

function insertAudit(db: Database.Database, e: AuditEvent, pos: number) {
  db.prepare("INSERT INTO audit_events (pk, pos, seq, hash, prev_hash, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(String(e.seq), pos, e.seq, e.hash, e.prevHash, JSON.stringify(e));
}

/**
 * Write the rows of `state` that differ from the database, in one transaction. Returns the new revision.
 * Audit events are only ever inserted (the triggers forbid anything else), so a saved record cannot be rewritten by the app.
 */
export function saveChanges(db: Database.Database, state: AppState): number {
  return db.transaction(() => {
    for (const k of KEYS) {
      const table = TABLES[k];
      const records = state[k] as unknown as Record<string, unknown>[];
      if (k === "auditEvents") {
        const have = new Set((db.prepare("SELECT pk FROM audit_events").all() as { pk: string }[]).map((r) => r.pk));
        records.forEach((e, i) => { if (!have.has(rowKey(k, e))) insertAudit(db, e as unknown as AuditEvent, i); });
        continue;
      }
      const existing = new Map((db.prepare(`SELECT pk, pos, data FROM ${table}`).all() as { pk: string; pos: number; data: string }[]).map((r) => [r.pk, r]));
      const upsert = db.prepare(`INSERT INTO ${table} (pk, pos, data) VALUES (?, ?, ?) ON CONFLICT(pk) DO UPDATE SET pos = excluded.pos, data = excluded.data`);
      const seen = new Set<string>();
      records.forEach((r, i) => {
        const pk = rowKey(k, r);
        const data = JSON.stringify(r);
        seen.add(pk);
        const old = existing.get(pk);
        if (!old || old.data !== data || old.pos !== i) upsert.run(pk, i, data);
      });
      const del = db.prepare(`DELETE FROM ${table} WHERE pk = ?`);
      for (const pk of existing.keys()) if (!seen.has(pk)) del.run(pk);
    }
    return bumpRevision(db);
  })();
}

/** Replace all data with `state` (seed or import). The only path allowed to clear the audit log. */
export function replaceAll(db: Database.Database, state: AppState, source: string): number {
  return db.transaction(() => {
    db.exec("DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;");
    for (const k of KEYS) db.exec(`DELETE FROM ${TABLES[k]}`);
    db.exec(AUDIT_TRIGGERS);
    for (const k of KEYS) {
      const records = state[k] as unknown as Record<string, unknown>[];
      if (k === "auditEvents") { records.forEach((e, i) => insertAudit(db, e as unknown as AuditEvent, i)); continue; }
      const ins = db.prepare(`INSERT INTO ${TABLES[k]} (pk, pos, data) VALUES (?, ?, ?)`);
      records.forEach((r, i) => ins.run(rowKey(k, r), i, JSON.stringify(r)));
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_at', ?), ('seed_source', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(new Date().toISOString(), source);
    return bumpRevision(db);
  })();
}

export function rowCounts(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of KEYS) out[TABLES[k]] = (db.prepare(`SELECT COUNT(*) n FROM ${TABLES[k]}`).get() as { n: number }).n;
  return out;
}

// ---------- Users (login credentials) ----------

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return ["scrypt", salt.toString("base64"), scryptSync(password, salt, 32).toString("base64")].join("$");
}

/** Store the demo accounts with scrypt-hashed passwords. Runs once; existing users are left as they are. */
function seedUsers(db: Database.Database) {
  const ins = db.prepare("INSERT OR IGNORE INTO users (username, role, vendor_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?)");
  const have = new Set((db.prepare("SELECT username FROM users").all() as { username: string }[]).map((r) => r.username));
  const now = new Date().toISOString();
  db.transaction(() => { for (const u of USERS) if (!have.has(u.username)) ins.run(u.username, u.role, u.vendorId ?? null, hashPassword(u.password), now); })();
}

/** True when the username exists in the database and the password matches its hash. */
export function checkPassword(db: Database.Database, username: string, password: string): boolean {
  const row = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(username) as { password_hash: string } | undefined;
  if (!row) return false;
  const [, saltB64, hashB64] = row.password_hash.split("$");
  const expected = Buffer.from(hashB64, "base64");
  const given = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(given, expected);
}
