// Glue for the pages and the REST facade: predictions for one invoice, the supplier table, model metrics, and the investigation queue.
import { loadCanonical } from "../plantpay/canonical";
import { SourceUnavailableError } from "../plantpay/connectors";
import type { PlantPayEngine } from "../plantpay/engine";
import { predictInvoice, type InvoicePrediction } from "./predictor";
import { loadSupplierFacts, type SupplierFacts } from "./supplier";
import { ensureModels, type ModelBundle } from "./train";

export type PredictionOutcome = { ok: true; prediction: InvoicePrediction } | { ok: false; status: 404 | 503; message: string };

/** Full prediction (with contributing factors) for one invoice, evaluated against the live sources. Never throws for an unavailable source. */
export function predictionFor(engine: PlantPayEngine, invoiceNo: string, opts: { factors?: boolean } = {}): PredictionOutcome {
  try {
    const canon = loadCanonical(engine.connectors, invoiceNo);
    if (!canon.bundle) return canon.unavailable.length ? { ok: false, status: 503, message: `A source system is unavailable (${canon.unavailable.join(", ")}), so no prediction can be made right now.` } : { ok: false, status: 404, message: `Invoice ${invoiceNo} was not found.` };
    const facts = loadSupplierFacts(engine.connectors, engine.today).get(canon.bundle.invoice.vendorId);
    if (!facts) return { ok: false, status: 404, message: `No supplier profile for ${canon.bundle.invoice.vendorId}.` };
    const models = ensureModels();
    return { ok: true, prediction: predictInvoice(canon.bundle, engine.stored(invoiceNo), facts, models, engine.today, opts) };
  } catch (e) {
    if (e instanceof SourceUnavailableError) return { ok: false, status: 503, message: `${e.message}. Predictions need that source, so none is shown right now.` };
    throw e;
  }
}

export function supplierTable(engine: PlantPayEngine): SupplierFacts[] | { error: string } {
  try { return [...loadSupplierFacts(engine.connectors, engine.today).values()]; } catch (e) {
    if (e instanceof SourceUnavailableError) return { error: `${e.message}. Supplier scores need it, so they are not shown right now.` };
    throw e;
  }
}

/** Open (unpaid) invoices ranked by investigation priority. This orders human review work; it does not set the payment order. */
export function investigationQueue(engine: PlantPayEngine, ids: string[], limit = 12): { invoiceId: string; supplier: string; totalInr: number; status: string; priority: number; band: string; explanation: string }[] {
  const out: ReturnType<typeof investigationQueue> = [];
  for (const id of ids) {
    const o = predictionFor(engine, id, { factors: false });
    if (!o.ok) continue;
    const r = engine.stored(id);
    out.push({ invoiceId: id, supplier: o.prediction.supplierName, totalInr: r?.meta?.totalInr ?? 0, status: o.prediction.rulesStatus, priority: o.prediction.priority.priority, band: o.prediction.priority.band, explanation: o.prediction.priority.explanation });
  }
  return out.sort((a, b) => b.priority - a.priority || a.invoiceId.localeCompare(b.invoiceId)).slice(0, limit);
}

/** The metrics block shown on the dashboard and returned by the API (no model weights). */
export function modelSummary(models: ModelBundle = ensureModels()) {
  return {
    seed: models.seed, description: models.description, invoicesInHistory: models.invoicesInHistory, suppliersInHistory: models.suppliersInHistory, supplierMonths: models.supplierMonths,
    tasks: Object.values(models.tasks).map((t) => ({ task: t.task, title: t.title, question: t.question, chosen: t.chosen, data: t.data, test: t.test, comparison: t.comparison.map((c) => ({ algorithm: c.algorithm, chosen: c.chosen, validation: c.validation, test: c.test, note: c.note })), calibration: t.calibration, importance: t.importance.slice(0, 8) })),
  };
}
