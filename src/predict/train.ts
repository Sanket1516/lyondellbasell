// Trains and evaluates the four Stage 6 models on the synthetic history and writes them (with metrics) to data/ml/.
//   A  exception        will this invoice need an exception resolved?        binary    logistic vs random forest vs gradient boosting
//   B  cause            which root cause, given an exception?                multiclass (7 causes)
//   C  delay            will payment go past the due date?                   binary
//   D  supplierRisk     will this supplier disrupt supply in 90 days?        binary    (split by supplier)
// Protocol: chronological 60 / 20 / 20 split (supplier-grouped for D). Each algorithm is fitted on the training part, the best one
// is chosen on validation log-loss, and the reported metrics are on the untouched test part. Boosting's number of rounds is chosen
// on validation too. Nothing is hard-coded: every probability the app shows comes from these fitted models.
import fs from "node:fs";
import path from "node:path";
import { Rng, boostProba, forestProba, logisticProba, predictProba, round, trainBoosting, trainForest, trainLogistic, type AnyModel, type BoostModel, type ModelKind } from "../ml/core";
import { bestThreshold, binaryMetrics, calibration, logLoss, median, multiclassMetrics, permutationImportance, type BinaryMetrics, type MulticlassMetrics } from "../ml/eval";
import { CAUSES, DELAY_FEATURES, INVOICE_FEATURES, SUPPLIER_FEATURES, vectorOf } from "./features";
import { generateHistory, type History } from "./history";

export const MODEL_VERSION = 1;
export const ML_DIR = process.env.PLANTPAY_ML_DIR ?? path.join(process.cwd(), "data", "ml");
export const MODELS_FILE = (dir = ML_DIR) => path.join(dir, "models.json");
export type TaskId = "exception" | "cause" | "delay" | "supplierRisk";
export interface Comparison { algorithm: ModelKind; validation: { logLoss: number; auc?: number; accuracy: number }; test: BinaryMetrics | MulticlassMetrics; chosen: boolean; note?: string }
export interface BinStat { feature: string; bins: { label: string; n: number; share: number[] }[] }
export interface TaskArtifact {
  task: TaskId; title: string; question: string; features: string[]; classes: string[]; chosen: ModelKind; model: AnyModel; baseline: number[];
  comparison: Comparison[]; test: BinaryMetrics | MulticlassMetrics; calibration?: ReturnType<typeof calibration>; importance: { feature: string; importance: number }[];
  data: { rows: number; train: number; validation: number; test: number; positives?: number; from?: string; to?: string; split: string }; history: BinStat[];
}
export interface ModelBundle { version: number; seed: number; description: string; invoicesInHistory: number; suppliersInHistory: number; supplierMonths: number; tasks: Record<TaskId, TaskArtifact> }

const ALGOS: ModelKind[] = ["logistic", "forest", "boosting"];
type Row = { x: number[]; y: number };

function fitAll(train: Row[], val: Row[], classes: number, seed: number, quick: boolean): Record<ModelKind, AnyModel> {
  const X = train.map((r) => r.x), y = train.map((r) => r.y);
  const boost = trainBoosting(X, y, classes, { rounds: quick ? 60 : 160, lr: 0.08, maxDepth: 3, minLeaf: 15, seed });
  // early stopping: keep the number of rounds with the best validation log-loss
  let best = boost.rounds.length, bestLoss = Infinity;
  for (let r = 10; r <= boost.rounds.length; r += 10) { const l = logLoss(val.map((v) => boostProba(boost, v.x, r)), val.map((v) => v.y)); if (l < bestLoss) { bestLoss = l; best = r; } }
  const trimmed: BoostModel = { ...boost, rounds: boost.rounds.slice(0, best) };
  return { logistic: trainLogistic(X, y, classes, { iters: quick ? 150 : 300 }), forest: trainForest(X, y, classes, { trees: quick ? 30 : 70, maxDepth: 9, minLeaf: 10, seed }), boosting: trimmed };
}

function binStats(rows: { x: number[]; share: number[] }[], names: readonly string[], K: number): BinStat[] {
  return names.map((feature, f) => {
    const vals = rows.map((r) => r.x[f]); const uniq = [...new Set(vals)];
    let groups: { label: string; test: (v: number) => boolean }[];
    if (uniq.length <= 2) groups = [...uniq].sort((a, b) => a - b).map((u) => ({ label: `= ${u}`, test: (v) => v === u }));
    else { const s = [...vals].sort((a, b) => a - b); const q = [0.25, 0.5, 0.75].map((p) => s[Math.floor(p * s.length)]); const cuts = [...new Set(q)]; groups = [{ label: `<= ${round(cuts[0], 2)}`, test: (v) => v <= cuts[0] }, ...cuts.slice(1).map((c, i) => ({ label: `${round(cuts[i], 2)} to ${round(c, 2)}`, test: (v: number) => v > cuts[i] && v <= c })), { label: `> ${round(cuts[cuts.length - 1], 2)}`, test: (v) => v > cuts[cuts.length - 1] }]; }
    return { feature, bins: groups.map((g) => { const m = rows.filter((r) => g.test(r.x[f])); const share = new Array(K).fill(0); for (const r of m) r.share.forEach((v, k) => (share[k] += v)); return { label: g.label, n: m.length, share: share.map((v) => round(m.length ? v / m.length : 0, 4)) }; }) };
  });
}

function runTask(o: { task: TaskId; title: string; question: string; features: readonly string[]; classes: string[]; train: Row[]; val: Row[]; test: Row[]; seed: number; quick: boolean; all: Row[]; meta: TaskArtifact["data"] }): TaskArtifact {
  const K = o.classes.length;
  const models = fitAll(o.train, o.val, K, o.seed, o.quick);
  const yv = o.val.map((r) => r.y), yt = o.test.map((r) => r.y);
  const comps: Comparison[] = ALGOS.map((a) => {
    const m = models[a]; const Pv = o.val.map((r) => predictProba(m, r.x)), Pt = o.test.map((r) => predictProba(m, r.x));
    const thr = K === 2 ? bestThreshold(Pv.map((p) => p[1]), yv) : 0.5;           // decision threshold is chosen on validation only
    const vm = K === 2 ? binaryMetrics(Pv.map((p) => p[1]), yv, thr) : multiclassMetrics(Pv, yv, o.classes);
    return { algorithm: a, validation: { logLoss: round(logLoss(Pv, yv), 4), auc: K === 2 ? (vm as BinaryMetrics).auc : undefined, accuracy: vm.accuracy }, test: K === 2 ? binaryMetrics(Pt.map((p) => p[1]), yt, thr) : multiclassMetrics(Pt, yt, o.classes), chosen: false, note: a === "boosting" ? `${(m as BoostModel).rounds.length} rounds (early stopping on validation)` : undefined };
  });
  const bestIdx = comps.reduce((b, c, i) => (c.validation.logLoss < comps[b].validation.logLoss ? i : b), 0);
  comps[bestIdx].chosen = true;
  const chosen = ALGOS[bestIdx], model = models[chosen];
  const Xt = o.test.map((r) => r.x);
  const baseline = o.features.map((_, f) => round(median(o.train.map((r) => r.x[f])), 4));
  const P1 = K === 2 ? Xt.map((x) => predictProba(model, x)[1]) : undefined;
  return {
    task: o.task, title: o.title, question: o.question, features: [...o.features], classes: o.classes, chosen, model, baseline, comparison: comps, test: comps[bestIdx].test,
    calibration: P1 ? calibration(P1, yt) : undefined, importance: permutationImportance(model, Xt, yt, [...o.features], o.seed).map((i) => ({ ...i })), data: o.meta,
    history: binStats(o.all.map((r) => ({ x: r.x, share: Array.from({ length: K }, (_, k) => (r.y === k ? 1 : 0)) })), o.features, K),
  };
}

const split = <T,>(rows: T[]): [T[], T[], T[]] => { const a = Math.floor(rows.length * 0.6), b = Math.floor(rows.length * 0.8); return [rows.slice(0, a), rows.slice(a, b), rows.slice(b)]; };

export function trainAll(o: { seed?: number; invoices?: number; suppliers?: number; quick?: boolean; history?: History } = {}): ModelBundle {
  const seed = o.seed ?? 20261112, quick = !!o.quick;
  const h = o.history ?? generateHistory(seed, o.invoices ?? 8000, o.suppliers ?? 200);
  const inv = h.invoices; // already in date order
  const desc = (n: number, from: string, to: string) => `chronological split by invoice date: oldest 60% train, next 20% validation, newest 20% test (${from} to ${to}; ${n} rows)`;

  // A: exception
  const rowsA: Row[] = inv.map((i) => ({ x: vectorOf(INVOICE_FEATURES, i.features), y: i.exception }));
  const [aT, aV, aE] = split(rowsA);
  const A = runTask({ task: "exception", title: "Invoice exception probability", question: "Will this invoice need an exception resolved by a person?", features: INVOICE_FEATURES, classes: ["no exception", "exception"], train: aT, val: aV, test: aE, all: rowsA, seed, quick,
    meta: { rows: rowsA.length, train: aT.length, validation: aV.length, test: aE.length, positives: inv.filter((i) => i.exception).length, from: inv[0].date, to: inv[inv.length - 1].date, split: desc(rowsA.length, inv[0].date, inv[inv.length - 1].date) } });

  // B: root cause (only invoices that had an exception)
  const ex = inv.filter((i) => i.exception);
  const rowsB: Row[] = ex.map((i) => ({ x: vectorOf(INVOICE_FEATURES, i.features), y: i.cause }));
  const [bT, bV, bE] = split(rowsB);
  const B = runTask({ task: "cause", title: "Likely root cause", question: "If this invoice has an exception, what is the most likely cause?", features: INVOICE_FEATURES, classes: [...CAUSES], train: bT, val: bV, test: bE, all: rowsB, seed, quick,
    meta: { rows: rowsB.length, train: bT.length, validation: bV.length, test: bE.length, from: ex[0].date, to: ex[ex.length - 1].date, split: desc(rowsB.length, ex[0].date, ex[ex.length - 1].date) + "; trained on exception invoices only" } });

  // C: payment delay
  const rowsC: Row[] = inv.map((i) => ({ x: vectorOf(DELAY_FEATURES, i.features), y: i.delayed }));
  const [cT, cV, cE] = split(rowsC);
  const C = runTask({ task: "delay", title: "Payment delay risk", question: "Will payment be made after the due date?", features: DELAY_FEATURES, classes: ["on time", "late"], train: cT, val: cV, test: cE, all: rowsC, seed, quick,
    meta: { rows: rowsC.length, train: cT.length, validation: cV.length, test: cE.length, positives: inv.filter((i) => i.delayed).length, from: inv[0].date, to: inv[inv.length - 1].date, split: desc(rowsC.length, inv[0].date, inv[inv.length - 1].date) } });

  // D: supplier disruption, split by supplier so a supplier never appears in two parts
  const ids = [...new Set(h.supplierRows.map((r) => r.supplierId))].sort();
  const order = new Rng(seed + 4).shuffle([...ids]);
  const part = new Map<string, number>(); order.forEach((id, i) => part.set(id, i < order.length * 0.6 ? 0 : i < order.length * 0.8 ? 1 : 2));
  const rowsD = h.supplierRows.map((r) => ({ x: vectorOf(SUPPLIER_FEATURES, r.features), y: r.disruption, p: part.get(r.supplierId)! }));
  const pick = (k: number): Row[] => rowsD.filter((r) => r.p === k).map(({ x, y }) => ({ x, y }));
  const D = runTask({ task: "supplierRisk", title: "Supplier disruption risk", question: "Will this supplier disrupt supply (late or failed deliveries) within 90 days?", features: SUPPLIER_FEATURES, classes: ["no disruption", "disruption"], train: pick(0), val: pick(1), test: pick(2), all: rowsD.map(({ x, y }) => ({ x, y })), seed, quick,
    meta: { rows: rowsD.length, train: pick(0).length, validation: pick(1).length, test: pick(2).length, positives: rowsD.filter((r) => r.y).length, split: `grouped by supplier: 60% of suppliers train, 20% validation, 20% test (${ids.length} suppliers x 12 monthly snapshots); no supplier is in two parts` } });

  return {
    version: MODEL_VERSION, seed, invoicesInHistory: inv.length, suppliersInHistory: h.suppliers, supplierMonths: h.supplierRows.length,
    description: "Trained on synthetic, fictional history only (see src/predict/history.ts). Probabilities are model outputs; none are hard-coded.", tasks: { exception: A, cause: B, delay: C, supplierRisk: D },
  };
}

export function saveModels(b: ModelBundle, dir = ML_DIR) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(MODELS_FILE(dir), JSON.stringify(b)); }
export function formatMetrics(b: ModelBundle): string {
  const out: string[] = [`Stage 6 model evaluation (seed ${b.seed}; ${b.invoicesInHistory} historical invoices, ${b.suppliersInHistory} suppliers, ${b.supplierMonths} supplier-months)`, ""];
  for (const t of Object.values(b.tasks)) {
    out.push(`== ${t.title}: ${t.question}`, `   data: ${t.data.rows} rows (${t.data.train} train / ${t.data.validation} validation / ${t.data.test} test)${t.data.positives != null ? `, positive rate ${(100 * t.data.positives / t.data.rows).toFixed(1)}%` : ""}`, `   split: ${t.data.split}`);
    out.push("   algorithm       val logloss   test: " + (t.classes.length === 2 ? "AUC    acc    F1     precision recall  logloss brier  threshold" : "acc    macroF1  top2   logloss"));
    for (const c of t.comparison) {
      const m = c.test as BinaryMetrics & MulticlassMetrics;
      out.push(`   ${(c.algorithm + (c.chosen ? " *" : "")).padEnd(15)} ${c.validation.logLoss.toFixed(4).padEnd(13)} ${t.classes.length === 2 ? [m.auc, m.accuracy, m.f1, m.precision, m.recall, m.logLoss, m.brier, m.threshold].map((v) => v.toFixed(3).padEnd(7)).join(" ") : [m.accuracy, m.macroF1, m.top2Accuracy, m.logLoss].map((v) => v.toFixed(3).padEnd(7)).join(" ")}${c.note ? "  " + c.note : ""}`);
    }
    const base = (t.test as BinaryMetrics & MulticlassMetrics).baselineAccuracy;
    out.push(`   (* = chosen on validation log-loss; decision threshold chosen on validation to maximise F1; majority-class baseline accuracy on test = ${base})`);
    out.push(`   top features (permutation importance): ${t.importance.slice(0, 5).map((i) => `${i.feature} ${i.importance.toFixed(3)}`).join(", ")}`, "");
  }
  return out.join("\n");
}
export function loadModels(dir = ML_DIR): ModelBundle | undefined {
  try { const b = JSON.parse(fs.readFileSync(MODELS_FILE(dir), "utf8")) as ModelBundle; return b.version === MODEL_VERSION ? b : undefined; } catch { return undefined; }
}
/** Load the saved models, training (and saving) them first if they are missing, so a fresh checkout still works. */
let cached: ModelBundle | undefined;
export function ensureModels(dir = ML_DIR): ModelBundle {
  if (dir === ML_DIR && cached) return cached;
  let b = loadModels(dir);
  if (!b) { b = trainAll(); try { saveModels(b, dir); } catch { /* read-only disk: keep in memory */ } }
  if (dir === ML_DIR) cached = b;
  return b;
}
export { boostProba, forestProba, logisticProba };
