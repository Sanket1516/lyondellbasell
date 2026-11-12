// Small, dependency-free machine-learning core (TypeScript): seeded RNG, quantile binning, CART trees, logistic regression,
// random forest and gradient boosting. Everything is deterministic for a given seed, so a model trained twice is identical.
// Written in-repo (instead of pulling scikit-learn) because the project stack is TypeScript and every member must be able to
// explain the code. Models serialise to plain JSON.

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  normal(): number { const u = Math.max(this.next(), 1e-12), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  bool(p: number): boolean { return this.next() < p; }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]; }
  /** Sample an index from unnormalised non-negative weights. */
  weighted(ws: number[]): number { const t = ws.reduce((a, b) => a + b, 0); let r = this.next() * t; for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return i; } return ws.length - 1; }
  shuffle<T>(xs: T[]): T[] { for (let i = xs.length - 1; i > 0; i--) { const j = this.int(i + 1); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; }
}
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
export function softmax(z: number[]): number[] { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); }
export const round = (x: number, d = 5) => { const f = 10 ** d; return Math.round(x * f) / f; };

// ---------------------------------------------------------------- binning
export interface Binner { edges: number[][] }
/** Quantile bin edges per feature (at most `maxBins` bins). A value v lands in bin = number of edges below v. */
export function fitBinner(X: number[][], maxBins = 32): Binner {
  const p = X[0].length;
  const edges: number[][] = [];
  for (let f = 0; f < p; f++) {
    const vals = X.map((r) => r[f]).sort((a, b) => a - b);
    const uniq = [...new Set(vals)];
    if (uniq.length <= maxBins) { edges.push(uniq.slice(0, -1).map((v, i) => (v + uniq[i + 1]) / 2)); continue; }
    const e = new Set<number>();
    for (let b = 1; b < maxBins; b++) { const pos = Math.floor((b * vals.length) / maxBins); e.add(vals[pos - 1] === vals[pos] ? vals[pos] : (vals[pos - 1] + vals[pos]) / 2); }
    // the top value can never be an edge (nothing would fall to its right)
    edges.push([...e].sort((a, b) => a - b).filter((v) => v < vals[vals.length - 1]));
  }
  return { edges };
}
const binOf = (edges: number[], v: number) => { let lo = 0, hi = edges.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v > edges[m]) lo = m + 1; else hi = m; } return lo; };
export function binRows(X: number[][], b: Binner): Uint8Array {
  const p = b.edges.length; const out = new Uint8Array(X.length * p);
  for (let i = 0; i < X.length; i++) for (let f = 0; f < p; f++) out[i * p + f] = binOf(b.edges[f], X[i][f]);
  return out;
}

// ---------------------------------------------------------------- CART regression tree (multi-output)
export interface Tree { feature: number[]; threshold: number[]; left: number[]; right: number[]; value: number[][] }
export interface TreeParams { maxDepth: number; minLeaf: number; mtry: number; lambda?: number }
/** Grow one tree on binned data. `Y[i]` is the target vector of row i (variance reduction summed over outputs, i.e. Gini for one-hot).
 *  `leaf` overrides the leaf value (used by gradient boosting for Newton steps). */
export function growTree(bins: Uint8Array, p: number, binner: Binner, rows: number[], Y: number[][], prm: TreeParams, rng: Rng, leaf?: (idx: number[]) => number[]): Tree {
  const K = Y[0].length;
  const t: Tree = { feature: [], threshold: [], left: [], right: [], value: [] };
  const mean = (idx: number[]) => { const s = new Array(K).fill(0); for (const i of idx) for (let k = 0; k < K; k++) s[k] += Y[i][k]; return s.map((v) => v / idx.length); };
  const build = (idx: number[], depth: number): number => {
    const id = t.feature.length;
    t.feature.push(-1); t.threshold.push(0); t.left.push(-1); t.right.push(-1); t.value.push(leaf ? leaf(idx) : mean(idx).map((v) => round(v, 6)));
    if (depth >= prm.maxDepth || idx.length < 2 * prm.minLeaf) return id;
    const total = new Array(K).fill(0); for (const i of idx) for (let k = 0; k < K; k++) total[k] += Y[i][k];
    const n = idx.length;
    let base = 0; for (let k = 0; k < K; k++) base += (total[k] * total[k]) / n;
    // choose mtry random features
    const feats = rng.shuffle(Array.from({ length: p }, (_, i) => i)).slice(0, prm.mtry);
    let bestGain = 1e-9, bf = -1, bb = -1;
    for (const f of feats) {
      const nb = binner.edges[f].length + 1; if (nb < 2) continue;
      const cnt = new Float64Array(nb), sum = new Float64Array(nb * K);
      for (const i of idx) { const b = bins[i * p + f]; cnt[b]++; for (let k = 0; k < K; k++) sum[b * K + k] += Y[i][k]; }
      const sl = new Array(K).fill(0); let nl = 0;
      for (let b = 0; b < nb - 1; b++) {
        nl += cnt[b]; for (let k = 0; k < K; k++) sl[k] += sum[b * K + k];
        const nr = n - nl; if (nl < prm.minLeaf || nr < prm.minLeaf) continue;
        let g = -base; for (let k = 0; k < K; k++) { const sr = total[k] - sl[k]; g += (sl[k] * sl[k]) / nl + (sr * sr) / nr; }
        if (g > bestGain) { bestGain = g; bf = f; bb = b; }
      }
    }
    if (bf < 0) return id;
    const L: number[] = [], R: number[] = [];
    for (const i of idx) (bins[i * p + bf] <= bb ? L : R).push(i);
    t.feature[id] = bf; t.threshold[id] = round(binner.edges[bf][bb], 6);
    t.left[id] = build(L, depth + 1); t.right[id] = build(R, depth + 1);
    return id;
  };
  build(rows, 0);
  for (let i = 0; i < t.feature.length; i++) if (t.feature[i] >= 0) t.value[i] = []; // only leaves predict; keeps saved models small
  return t;
}
export function treeValue(t: Tree, x: number[]): number[] { let n = 0; while (t.feature[n] >= 0) n = x[t.feature[n]] <= t.threshold[n] ? t.left[n] : t.right[n]; return t.value[n]; }

// ---------------------------------------------------------------- models
export type ModelKind = "logistic" | "forest" | "boosting";
export interface Classifier { kind: ModelKind; classes: number; proba(x: number[]): number[] }

/** Multinomial logistic regression on standardised features, L2-regularised, trained by full-batch gradient descent with momentum. */
export interface LogisticModel { kind: "logistic"; classes: number; mean: number[]; sd: number[]; W: number[][]; b: number[] }
export function trainLogistic(X: number[][], y: number[], classes: number, o: { l2?: number; iters?: number; lr?: number } = {}): LogisticModel {
  const n = X.length, p = X[0].length, l2 = o.l2 ?? 1e-3, iters = o.iters ?? 400, lr = o.lr ?? 0.4;
  const mean = new Array(p).fill(0), sd = new Array(p).fill(0);
  for (const r of X) for (let f = 0; f < p; f++) mean[f] += r[f] / n;
  for (const r of X) for (let f = 0; f < p; f++) sd[f] += (r[f] - mean[f]) ** 2 / n;
  for (let f = 0; f < p; f++) sd[f] = Math.sqrt(sd[f]) || 1;
  const Z = X.map((r) => r.map((v, f) => (v - mean[f]) / sd[f]));
  const W = Array.from({ length: classes }, () => new Array(p).fill(0)), b = new Array(classes).fill(0);
  const vW = Array.from({ length: classes }, () => new Array(p).fill(0)), vb = new Array(classes).fill(0);
  for (let it = 0; it < iters; it++) {
    const gW = Array.from({ length: classes }, () => new Array(p).fill(0)), gb = new Array(classes).fill(0);
    for (let i = 0; i < n; i++) {
      const pr = softmax(W.map((w, k) => b[k] + w.reduce((a, wv, f) => a + wv * Z[i][f], 0)));
      for (let k = 0; k < classes; k++) { const e = pr[k] - (y[i] === k ? 1 : 0); gb[k] += e / n; for (let f = 0; f < p; f++) gW[k][f] += (e * Z[i][f]) / n; }
    }
    for (let k = 0; k < classes; k++) {
      vb[k] = 0.9 * vb[k] - lr * gb[k]; b[k] += vb[k];
      for (let f = 0; f < p; f++) { vW[k][f] = 0.9 * vW[k][f] - lr * (gW[k][f] + l2 * W[k][f]); W[k][f] += vW[k][f]; }
    }
  }
  return { kind: "logistic", classes, mean, sd, W: W.map((r) => r.map((v) => round(v, 6))), b: b.map((v) => round(v, 6)) };
}
export function logisticProba(m: LogisticModel, x: number[]): number[] {
  return softmax(m.W.map((w, k) => m.b[k] + w.reduce((a, wv, f) => a + (wv * (x[f] - m.mean[f])) / m.sd[f], 0)));
}

export interface ForestModel { kind: "forest"; classes: number; trees: Tree[] }
export function trainForest(X: number[][], y: number[], classes: number, o: { trees?: number; maxDepth?: number; minLeaf?: number; seed?: number } = {}): ForestModel {
  const n = X.length, p = X[0].length, rng = new Rng(o.seed ?? 1);
  const binner = fitBinner(X); const bins = binRows(X, binner);
  const Y = y.map((c) => Array.from({ length: classes }, (_, k) => (k === c ? 1 : 0)));
  const trees: Tree[] = [];
  for (let i = 0; i < (o.trees ?? 80); i++) {
    const rows = Array.from({ length: n }, () => rng.int(n));
    trees.push(growTree(bins, p, binner, rows, Y, { maxDepth: o.maxDepth ?? 10, minLeaf: o.minLeaf ?? 8, mtry: Math.max(2, Math.round(Math.sqrt(p))) }, rng));
  }
  return { kind: "forest", classes, trees };
}
export function forestProba(m: ForestModel, x: number[]): number[] {
  const s = new Array(m.classes).fill(0);
  for (const t of m.trees) { const v = treeValue(t, x); for (let k = 0; k < m.classes; k++) s[k] += v[k]; }
  const tot = s.reduce((a, b) => a + b, 0) || 1; return s.map((v) => v / tot);
}

/** Gradient boosting with the log-loss (binary) or softmax cross-entropy (multiclass); Newton leaf values, shrinkage and row subsampling.
 *  `rounds[k]` trees per class. The number of rounds can be cut afterwards (early stopping on a validation set). */
export interface BoostModel { kind: "boosting"; classes: number; init: number[]; lr: number; rounds: Tree[][] }
export function trainBoosting(X: number[][], y: number[], classes: number, o: { rounds?: number; lr?: number; maxDepth?: number; minLeaf?: number; subsample?: number; lambda?: number; seed?: number } = {}): BoostModel {
  const n = X.length, p = X[0].length, rng = new Rng(o.seed ?? 1), lr = o.lr ?? 0.1, lambda = o.lambda ?? 1;
  const binner = fitBinner(X); const bins = binRows(X, binner);
  const K = classes === 2 ? 1 : classes;                        // binary: one score for class 1
  const prior = new Array(classes).fill(0); for (const c of y) prior[c] += 1 / n;
  const init = K === 1 ? [Math.log((prior[1] + 1e-6) / (prior[0] + 1e-6))] : prior.map((v) => Math.log(v + 1e-6));
  const F = Array.from({ length: n }, () => init.slice());
  const rounds: Tree[][] = [];
  for (let r = 0; r < (o.rounds ?? 120); r++) {
    const P = F.map((f) => (K === 1 ? [sigmoid(f[0])] : softmax(f)));
    const sub = Array.from({ length: n }, (_, i) => i).filter(() => rng.next() < (o.subsample ?? 0.8));
    const trees: Tree[] = [];
    for (let k = 0; k < K; k++) {
      const g = new Array(n), h = new Array(n);
      for (let i = 0; i < n; i++) { const t = K === 1 ? (y[i] === 1 ? 1 : 0) : (y[i] === k ? 1 : 0); g[i] = t - P[i][k]; h[i] = Math.max(P[i][k] * (1 - P[i][k]), 1e-6); }
      const Y = g.map((v) => [v]);
      const scale = K === 1 ? 1 : (K - 1) / K;
      const tree = growTree(bins, p, binner, sub, Y, { maxDepth: o.maxDepth ?? 3, minLeaf: o.minLeaf ?? 10, mtry: p }, rng, (idx) => { let sg = 0, sh = 0; for (const i of idx) { sg += g[i]; sh += h[i]; } return [round((scale * sg) / (sh + lambda), 6)]; });
      trees.push(tree);
      for (let i = 0; i < n; i++) F[i][k] += lr * treeValue(tree, X[i])[0];
    }
    rounds.push(trees);
  }
  return { kind: "boosting", classes, init: init.map((v) => round(v, 6)), lr, rounds };
}
export function boostProba(m: BoostModel, x: number[], upTo = m.rounds.length): number[] {
  const f = m.init.slice();
  for (let r = 0; r < Math.min(upTo, m.rounds.length); r++) for (let k = 0; k < f.length; k++) f[k] += m.lr * treeValue(m.rounds[r][k], x)[0];
  return f.length === 1 ? [1 - sigmoid(f[0]), sigmoid(f[0])] : softmax(f);
}

export type AnyModel = LogisticModel | ForestModel | BoostModel;
export function predictProba(m: AnyModel, x: number[]): number[] { return m.kind === "logistic" ? logisticProba(m, x) : m.kind === "forest" ? forestProba(m, x) : boostProba(m, x); }
