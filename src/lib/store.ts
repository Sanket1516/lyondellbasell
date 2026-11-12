import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { AppState } from "./types";

const ROOT = process.cwd();
export const STATE_FILE = path.join(ROOT, "data", "state.json");
export const SEED_DIR = path.join(ROOT, "data", "seed");

const COLLECTIONS = [
  "vendors", "purchaseOrders", "goodsReceipts", "contracts", "deliveryNotes",
  "uomRules", "invoices", "findings", "tasks", "auditEvents",
] as const;

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

let cache: AppState | undefined;

function persist(state: AppState) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** In-memory state, persisted to data/state.json. The first read falls back to the seed. */
export function getState(): AppState {
  if (cache) return cache;
  if (fs.existsSync(STATE_FILE)) {
    cache = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as AppState;
  } else {
    cache = loadSeed();
    persist(cache);
  }
  return cache;
}

/** Mutate state through a function, then save. */
export function updateState<T>(fn: (s: AppState) => T): T {
  const s = getState();
  const result = fn(s);
  persist(s);
  return result;
}

export function resetState(): AppState {
  cache = loadSeed();
  persist(cache);
  return cache;
}
