// Restores the demo data from data/seed/ into the database (data/plantx.db) and data/state.json. Run: npm run reset
// Stop the app first, or click "Reset demo data" inside the app instead.
import fs from "node:fs";
import path from "node:path";
import { KEYS, openDb, replaceAll, rowCounts } from "../src/lib/db";
import type { AppState } from "../src/lib/types";

const SEED = path.join(process.cwd(), "data", "seed");
const OUT = path.join(process.cwd(), "data", "state.json");

const state = { version: 1 } as Record<string, unknown>;
for (const k of KEYS) {
  const f = path.join(SEED, `${k}.json`);
  state[k] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
}
fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
const db = openDb();
replaceAll(db, state as unknown as AppState, "seed");
console.log("Demo data reset -> data/plantx.db and", OUT);
console.log(rowCounts(db));
db.close();
