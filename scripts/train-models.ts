// Stage 6B: generate the synthetic labelled history, train and evaluate the four models, print and save the metrics.
// Deterministic: running it twice gives identical files. Run: npm run train:models
import fs from "node:fs";
import path from "node:path";
import { ML_DIR, formatMetrics, saveModels, trainAll } from "../src/predict/train";
import { generateHistory } from "../src/predict/history";

const t0 = Date.now();
const history = generateHistory();
const bundle = trainAll({ history });
saveModels(bundle);
const report = formatMetrics(bundle);
console.log(report);
const summary = Object.fromEntries(Object.entries(bundle.tasks).map(([k, t]) => [k, { title: t.title, chosen: t.chosen, data: t.data, test: t.test, comparison: t.comparison.map((c) => ({ algorithm: c.algorithm, chosen: c.chosen, validation: c.validation, test: c.test })), calibration: t.calibration, importance: t.importance }]));
fs.writeFileSync(path.join(ML_DIR, "metrics.json"), JSON.stringify({ seed: bundle.seed, invoicesInHistory: bundle.invoicesInHistory, suppliersInHistory: bundle.suppliersInHistory, tasks: summary }, null, 2));
fs.writeFileSync(path.join(ML_DIR, "metrics.txt"), report + "\n");
// the labelled history itself, so anyone can inspect or re-train on it
const cols = Object.keys(history.invoices[0].features);
fs.writeFileSync(path.join(ML_DIR, "history_invoices.csv"), ["id,date,supplier,exception,cause,delayed,delay_days," + cols.join(","), ...history.invoices.map((i) => [i.id, i.date, i.supplierId, i.exception, i.cause >= 0 ? ["price_mismatch", "quantity_mismatch", "missing_receipt", "unit_mismatch", "tax_error", "duplicate_invoice", "quality_rejection"][i.cause] : "", i.delayed, i.delayDays, ...cols.map((c) => +i.features[c].toFixed(4))].join(","))].join("\n"));
const scols = Object.keys(history.supplierRows[0].features);
fs.writeFileSync(path.join(ML_DIR, "history_suppliers.csv"), ["supplier,month,disruption," + scols.join(","), ...history.supplierRows.map((r) => [r.supplierId, r.month, r.disruption, ...scols.map((c) => +r.features[c].toFixed(4))].join(","))].join("\n"));
console.log(`\nSaved models, metrics and history to ${ML_DIR} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
