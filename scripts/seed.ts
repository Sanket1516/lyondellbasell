// Restores data/state.json from data/seed/. Run: npm run reset
import fs from "node:fs";
import path from "node:path";

const SEED = path.join(process.cwd(), "data", "seed");
const OUT = path.join(process.cwd(), "data", "state.json");
const keys = [
  "vendors", "purchaseOrders", "goodsReceipts", "contracts", "deliveryNotes",
  "uomRules", "invoices", "findings", "tasks", "auditEvents",
];

const state: Record<string, unknown> = { version: 1 };
for (const k of keys) {
  const f = path.join(SEED, `${k}.json`);
  state[k] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
}
fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
console.log("Demo data reset ->", OUT);
