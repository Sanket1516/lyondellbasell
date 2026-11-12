import "server-only";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AppState, AuditEvent } from "./types";
import { checkPassword, getRevision, isEmpty, loadAll, loadAuditEvents, openDb, replaceAll, saveChanges } from "./db";

const ROOT = process.cwd();
/** Legacy JSON store. Used when PLANTX_STORE=json, and imported once into the database on first run. */
export const STATE_FILE = path.join(ROOT, "data", "state.json");
export const SEED_DIR = path.join(ROOT, "data", "seed");

const COLLECTIONS = [
  "vendors", "purchaseOrders", "goodsReceipts", "contracts", "deliveryNotes",
  "uomRules", "invoices", "findings", "tasks", "auditEvents",
] as const;

/** "sqlite" (default) or "json" (the original file store, kept as a fallback). */
const DRIVER = process.env.PLANTX_STORE === "json" ? "json" : "sqlite";

export function emptyState(): AppState {
  return {
    version: 1,
    vendors: [], purchaseOrders: [], goodsReceipts: [], contracts: [], deliveryNotes: [],
    uomRules: [], invoices: [], findings: [], tasks: [], auditEvents: [],
  };
}

/** Build state from data/seed/<collection>.json. A missing file means an empty collection. */
export function loadSeed(dir = SEED_DIR): AppState {
  const state = emptyState();
  for (const key of COLLECTIONS) {
    const file = path.join(dir, `${key}.json`);
    if (fs.existsSync(file)) (state[key] as unknown[]) = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return state;
}

// Next.js bundles server actions, route handlers and pages separately, so a module-level variable would be
// one copy per bundle and a page could miss a change made by an action. globalThis is shared by all of them.
const g = globalThis as unknown as { __plantXState?: AppState; __plantXDb?: Database.Database; __plantXRev?: number };

// ---------- SQLite ----------

function db(): Database.Database {
  if (!g.__plantXDb) {
    g.__plantXDb = openDb();
    if (isEmpty(g.__plantXDb)) {
      // First run: carry over the current demo state if there is one, so nothing is lost by switching stores.
      const fromFile = fs.existsSync(STATE_FILE);
      replaceAll(g.__plantXDb, fromFile ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AppState) : loadSeed(),
        fromFile ? "import:data/state.json" : "seed");
    }
  }
  return g.__plantXDb;
}

// ---------- JSON fallback ----------

function persistJson(state: AppState) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------- Public API (unchanged for every caller) ----------

/** Current state. With SQLite, an in-process copy is reused until another process changes the database. */
export function getState(): AppState {
  if (DRIVER === "json") {
    if (g.__plantXState) return g.__plantXState;
    if (fs.existsSync(STATE_FILE)) g.__plantXState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AppState;
    else { g.__plantXState = loadSeed(); persistJson(g.__plantXState); }
    return g.__plantXState;
  }
  const d = db();
  const rev = getRevision(d);
  if (!g.__plantXState || g.__plantXRev !== rev) {
    g.__plantXState = loadAll(d);
    g.__plantXRev = rev;
  }
  return g.__plantXState;
}

/** Mutate state through a function, then save. With SQLite, only changed rows are written, in one transaction. */
export function updateState<T>(fn: (s: AppState) => T): T {
  const s = getState();
  let result: T;
  try {
    result = fn(s);
  } catch (err) {
    if (DRIVER === "sqlite") g.__plantXState = undefined; // drop the half-changed copy; the next read reloads from the DB
    throw err;
  }
  if (DRIVER === "json") persistJson(s);
  else {
    try {
      g.__plantXRev = saveChanges(db(), s);
    } catch (err) {
      g.__plantXState = undefined;
      throw err;
    }
  }
  return result;
}

export function resetState(): AppState {
  const seed = loadSeed();
  if (DRIVER === "json") { g.__plantXState = seed; persistJson(seed); return seed; }
  g.__plantXRev = replaceAll(db(), seed, "seed");
  g.__plantXState = seed;
  return seed;
}

/** The audit records as saved (database or file), for "Verify chain". Reading storage, not memory, is what catches an edited record. */
export function readSavedAuditEvents(): AuditEvent[] {
  if (DRIVER === "sqlite") return loadAuditEvents(db());
  if (!fs.existsSync(STATE_FILE)) return getState().auditEvents;
  return (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AppState).auditEvents;
}

/** Login check. SQLite: against the scrypt hash in the users table. JSON fallback: against the demo account list. */
export function verifyLogin(username: string, password: string, plainPassword: string | undefined): boolean {
  if (DRIVER === "sqlite") return checkPassword(db(), username, password);
  return plainPassword !== undefined && plainPassword === password;
}

export function storeDriver(): "sqlite" | "json" { return DRIVER; }
export function database(): Database.Database | undefined { return DRIVER === "sqlite" ? db() : undefined; }
