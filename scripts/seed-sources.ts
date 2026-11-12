// Builds the six source databases (data/sources/*.db) and the PlantPay integration state, evaluates every invoice through the
// connectors and engine, and replays invoice_received for the demo documents. Deterministic. Run: npm run seed:sources
import { DEMO_TODAY } from "../src/lib/constants";
import { seedPlantPay } from "../src/plantpay/runtime";
import { SOURCES_DIR } from "../src/plantpay/sources/build";
import { INTEGRATION_DB_FILE, verifyAudit } from "../src/plantpay/integration";

const t0 = Date.now();
const engine = seedPlantPay({ today: DEMO_TODAY, predictions: true });
const rows = engine.connectors.finance.listInvoiceHeaders().map((r) => String(r.invoice_no));
const by: Record<string, number> = {};
for (const n of rows) { const s = engine.stored(n)!.status; by[s] = (by[s] ?? 0) + 1; }
console.log(`Six source databases written to ${SOURCES_DIR}`);
console.log("Source health:", engine.connectors.health().map((h) => `${h.id}=${h.status}(${h.records})`).join(" "));
console.log(`Evaluated ${rows.length} invoices in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, by);
console.log("Audit chain:", verifyAudit(engine.integration), "->", INTEGRATION_DB_FILE);
