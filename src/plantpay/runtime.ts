// Process-wide wiring for the Next.js app: integration DB, connectors, engine. Seeds itself on first use when the files are missing,
// so a fresh checkout shows data instead of an error.
import fs from "node:fs";
import { DEMO_TODAY } from "../lib/constants";
import { buildDataset } from "../foundation/generate";
import { Connectors } from "./connectors";
import { announceInvoiceReceived } from "./sources/writers";
import { PlantPayEngine } from "./engine";
import { createPredictor } from "../predict/predictor";
import { ensureModels } from "../predict/train";
import { seedWorkflowHistories } from "./history";
import { INTEGRATION_DB_FILE, openIntegrationDb } from "./integration";
import { SOURCES_DIR, buildSourceDatabases, sourceFile } from "./sources/build";
import { SOURCE_IDS } from "./sources/schemas";

const g = globalThis as unknown as { __plantpay?: PlantPayEngine };

/** Rebuild all six source databases and the integration state, evaluate every invoice, and replay invoice_received for the demo documents. */
/** `predictions: true` attaches the trained Stage 6 models, so every stored evaluation carries its four headline predictions. Tests leave it off. */
export function seedPlantPay(opts: { dir?: string; integrationFile?: string; today?: string; predictions?: boolean } = {}): PlantPayEngine {
  const dir = opts.dir ?? SOURCES_DIR;
  const file = opts.integrationFile ?? INTEGRATION_DB_FILE;
  const ds = buildDataset();
  buildSourceDatabases(ds, dir);
  if (file !== ":memory:") for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  const integration = openIntegrationDb(file);
  const conns = new Connectors(integration, dir);
  const today = opts.today ?? DEMO_TODAY;
  if (opts.predictions) ensureModels();
  const engine = new PlantPayEngine(integration, conns, { today, predictor: opts.predictions ? createPredictor(conns, today) : undefined });
  engine.evaluateAll();
  const insDemo = integration.prepare("INSERT OR REPLACE INTO demo_invoices VALUES (?,?,?,?)");
  for (const d of ds.demoDocs) insDemo.run(d.invoiceId, d.file, d.purpose, d.plantpayStatus ?? d.expectedStatus);
  seedWorkflowHistories(engine);
  // The demo documents arrive as events, like a live feed from Finance.
  for (const d of ds.demoDocs) announceInvoiceReceived({ integration, dir }, d.invoiceId);
  engine.processEvents();
  return engine;
}

export function plantpay(): PlantPayEngine {
  if (!g.__plantpay) {
    if (SOURCE_IDS.some((id) => !fs.existsSync(sourceFile(id))) || !fs.existsSync(INTEGRATION_DB_FILE)) g.__plantpay = seedPlantPay({ predictions: true });
    else { const integration = openIntegrationDb(); const conns = new Connectors(integration); g.__plantpay = new PlantPayEngine(integration, conns, { predictor: createPredictor(conns, DEMO_TODAY) }); }
  }
  return g.__plantpay;
}
