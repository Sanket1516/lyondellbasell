// Builds the Stage 1 foundation database (data/foundation.db): schema, ~30 vendors, ~500 POs, ~600 invoices, planted cases,
// the demo document set, then runs the three-way match on every invoice. Deterministic. Run: npm run seed:foundation
import { DEMO_TODAY } from "../src/lib/constants";
import { FOUNDATION_DB_FILE, loadDataset, openFoundationDb } from "../src/foundation/db";
import { buildDataset } from "../src/foundation/generate";
import { runMatchAll } from "../src/foundation/threeWay";

const ds = buildDataset();
const db = openFoundationDb();
loadDataset(db, ds);
const results = runMatchAll(db, DEMO_TODAY);
const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
console.log(`Foundation DB written to ${FOUNDATION_DB_FILE}`);
console.log({ vendors: count("vendors"), purchase_orders: count("purchase_orders"), goods_receipts: count("goods_receipts"), invoices: count("invoices"), planted_cases: count("planted_cases"), demo_documents: count("demo_documents") });
const by = results.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log("Match results:", by);
db.close();
