// Evaluation and explanation helpers: metrics, calibration, permutation importance, and sampled Shapley values.
import { Rng, type AnyModel, predictProba, round } from "./core";

export function rocAuc(scores: number[], y: number[]): number {
  const idx = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0, pos = 0;
  for (let i = 0; i < idx.length;) {
    let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (i + j + 1) / 2; // average 1-based rank for ties
    for (let k = i; k < j; k++) if (y[idx[k][1]] === 1) { rankSum += avg; pos++; }
    i = j;
  }
  const neg = y.length - pos; return pos === 0 || neg === 0 ? NaN : (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}
export const logLoss = (P: number[][], y: number[]) => -P.reduce((a, p, i) => a + Math.log(Math.max(p[y[i]], 1e-12)), 0) / y.length;
export const brier = (p1: number[], y: number[]) => p1.reduce((a, p, i) => a + (p - y[i]) ** 2, 0) / y.length;
export const accuracy = (pred: number[], y: number[]) => pred.reduce((a, p, i) => a + (p === y[i] ? 1 : 0), 0) / y.length;

export interface BinaryMetrics { threshold: number; n: number; positiveRate: number; auc: number; accuracy: number; precision: number; recall: number; f1: number; logLoss: number; brier: number; baselineAccuracy: number }
export function binaryMetrics(p1: number[], y: number[], threshold = 0.5): BinaryMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  p1.forEach((p, i) => { const pr = p >= threshold ? 1 : 0; if (pr && y[i]) tp++; else if (pr && !y[i]) fp++; else if (!pr && y[i]) fn++; else tn++; });
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  const pos = y.reduce((a, b) => a + b, 0) / y.length;
  return { threshold: round(threshold, 3), n: y.length, positiveRate: round(pos, 4), auc: round(rocAuc(p1, y), 4), accuracy: round((tp + tn) / y.length, 4), precision: round(precision, 4), recall: round(recall, 4), f1: round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0, 4), logLoss: round(logLoss(p1.map((p) => [1 - p, p]), y), 4), brier: round(brier(p1, y), 4), baselineAccuracy: round(Math.max(pos, 1 - pos), 4) };
}
export interface MulticlassMetrics { n: number; accuracy: number; macroF1: number; top2Accuracy: number; logLoss: number; baselineAccuracy: number; perClass: { class: string; precision: number; recall: number; f1: number; support: number }[]; confusion: number[][] }
export function multiclassMetrics(P: number[][], y: number[], names: string[]): MulticlassMetrics {
  const K = names.length; const conf = Array.from({ length: K }, () => new Array(K).fill(0));
  let top2 = 0;
  P.forEach((p, i) => { const order = p.map((v, k) => [v, k] as const).sort((a, b) => b[0] - a[0]); conf[y[i]][order[0][1]]++; if (order[0][1] === y[i] || order[1][1] === y[i]) top2++; });
  const per = names.map((c, k) => { const tp = conf[k][k]; const fp = conf.reduce((a, r, j) => a + (j === k ? 0 : r[k]), 0); const fn = conf[k].reduce((a, v, j) => a + (j === k ? 0 : v), 0); const pr = tp + fp ? tp / (tp + fp) : 0, rc = tp + fn ? tp / (tp + fn) : 0; return { class: c, precision: round(pr, 4), recall: round(rc, 4), f1: round(pr + rc ? (2 * pr * rc) / (pr + rc) : 0, 4), support: tp + fn }; });
  const counts = names.map((_, k) => y.filter((v) => v === k).length);
  return { n: y.length, accuracy: round(conf.reduce((a, r, k) => a + r[k], 0) / y.length, 4), macroF1: round(per.reduce((a, c) => a + c.f1, 0) / K, 4), top2Accuracy: round(top2 / y.length, 4), logLoss: round(logLoss(P, y), 4), baselineAccuracy: round(Math.max(...counts) / y.length, 4), perClass: per, confusion: conf };
}
/** Reliability table: predicted probability bucket vs observed rate. */
export function calibration(p1: number[], y: number[], bins = 5): { range: string; n: number; predicted: number; observed: number }[] {
  const out: { n: number; sp: number; sy: number }[] = Array.from({ length: bins }, () => ({ n: 0, sp: 0, sy: 0 }));
  p1.forEach((p, i) => { const b = Math.min(bins - 1, Math.floor(p * bins)); out[b].n++; out[b].sp += p; out[b].sy += y[i]; });
  return out.map((o, b) => ({ range: `${Math.round((b * 100) / bins)}-${Math.round(((b + 1) * 100) / bins)}%`, n: o.n, predicted: o.n ? round(o.sp / o.n, 3) : 0, observed: o.n ? round(o.sy / o.n, 3) : 0 }));
}

export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/** Permutation importance on held-out data: how much the loss rises when one feature's values are shuffled. Larger is more important. */
export function permutationImportance(model: AnyModel, X: number[][], y: number[], names: string[], seed = 7, repeats = 3): { feature: string; importance: number }[] {
  const rng = new Rng(seed);
  const loss = (rows: number[][]) => -rows.reduce((a, r, i) => a + Math.log(Math.max(predictProba(model, r)[y[i]], 1e-12)), 0) / rows.length;
  const base = loss(X);
  return names.map((feature, f) => {
    let d = 0;
    for (let r = 0; r < repeats; r++) { const col = rng.shuffle(X.map((row) => row[f])); d += loss(X.map((row, i) => { const c = row.slice(); c[f] = col[i]; return c; })) - base; }
    return { feature, importance: round(d / repeats, 5) };
  }).sort((a, b) => b.importance - a.importance);
}

/** Sampled Shapley values (SHAP-style) in probability points against a baseline row (typically the training median).
 *  Per permutation the feature contributions add up exactly to f(x) - f(baseline). Deterministic for a given seed. */
export function shapley(f: (x: number[]) => number, x: number[], baseline: number[], permutations = 24, seed = 11): number[] {
  const rng = new Rng(seed); const p = x.length; const phi = new Array(p).fill(0);
  const order = Array.from({ length: p }, (_, i) => i);
  for (let r = 0; r < permutations; r++) {
    rng.shuffle(order); const z = baseline.slice(); let prev = f(z);
    for (const j of order) { if (z[j] === x[j]) continue; z[j] = x[j]; const cur = f(z); phi[j] += cur - prev; prev = cur; }
  }
  return phi.map((v) => v / permutations);
}

/** The probability threshold that maximises F1 on a validation set (chosen there, then applied unchanged to the test set). */
export function bestThreshold(p1: number[], y: number[]): number {
  let best = 0.5, bestF = -1;
  for (let t = 0.05; t <= 0.8001; t += 0.01) { const f = binaryMetrics(p1, y, t).f1; if (f > bestF + 1e-9) { bestF = f; best = t; } }
  return Math.round(best * 100) / 100;
}
