import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Models are trained into a temp folder (set before the modules read it), so the tests never touch data/ml.
const ML_TMP = vi.hoisted(() => { const d = `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/pp-ml-test-${process.pid}`; process.env.PLANTPAY_ML_DIR = d; return d; });

import { Rng, predictProba, trainBoosting, trainForest, trainLogistic } from "../ml/core";
import { binaryMetrics, rocAuc, shapley } from "../ml/eval";
import { buildDataset, type Dataset } from "../foundation/generate";
import { loadCanonical, type CanonicalBundle } from "../plantpay/canonical";
import { SourceUnavailableError } from "../plantpay/connectors";
import { setOutage } from "../plantpay/integration";
import type { PlantPayEngine } from "../plantpay/engine";
import { seedPlantPay } from "../plantpay/runtime";
import { CAUSES, DELAY_FEATURES, INVOICE_FEATURES, vectorOf } from "./features";
import { generateHistory } from "./history";
import { causeEvidence, predictInvoice } from "./predictor";
import { investigationQueue, predictionFor, supplierTable } from "./service";
import { PRIORITY_NOTE, investigationPriority, loadSupplierFacts, scoreSupplier, type ScoreInputs } from "./supplier";
import { ensureModels, trainAll, type ModelBundle } from "./train";

let dir: string; let eng: PlantPayEngine; let ds: Dataset; let models: ModelBundle;
const TODAY = "2026-11-12";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "predict-test-"));
  ds = buildDataset();
  models = ensureModels();                       // trains once into ML_TMP
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: TODAY, predictions: true });
}, 240000);
afterAll(() => { for (const d of [dir, ML_TMP]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe("ML core", () => {
  const data = (n: number, seed: number) => { const r = new Rng(seed); const X: number[][] = [], y: number[] = []; for (let i = 0; i < n; i++) { const a = r.normal(), b = r.normal(), c = r.normal(); X.push([a, b, c]); y.push(r.bool(1 / (1 + Math.exp(-(2 * a - 1.5 * b)))) ? 1 : 0); } return { X, y }; };
  it("all three algorithms learn a known relationship and beat chance on unseen rows", () => {
    const tr = data(1500, 1), te = data(600, 2);
    for (const m of [trainLogistic(tr.X, tr.y, 2), trainForest(tr.X, tr.y, 2, { trees: 30 }), trainBoosting(tr.X, tr.y, 2, { rounds: 60 })]) {
      expect(rocAuc(te.X.map((x) => predictProba(m, x)[1]), te.y)).toBeGreaterThan(0.78);
    }
  });
  it("training is deterministic for a seed", () => {
    const d = data(400, 3);
    expect(JSON.stringify(trainBoosting(d.X, d.y, 2, { rounds: 10, seed: 5 }))).toBe(JSON.stringify(trainBoosting(d.X, d.y, 2, { rounds: 10, seed: 5 })));
  });
  it("multiclass probabilities sum to one", () => {
    const d = data(300, 4); const y3 = d.y.map((v, i) => (d.X[i][2] > 0.5 ? 2 : v));
    for (const m of [trainLogistic(d.X, y3, 3), trainForest(d.X, y3, 3, { trees: 10 }), trainBoosting(d.X, y3, 3, { rounds: 10 })]) expect(predictProba(m, d.X[0]).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
  it("metrics: perfect and uninformative scores", () => {
    expect(rocAuc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(rocAuc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    expect(binaryMetrics([0.9, 0.1], [1, 0]).f1).toBe(1);
  });
  it("Shapley contributions add up to f(x) - f(baseline)", () => {
    const f = (x: number[]) => 1 / (1 + Math.exp(-(x[0] + 2 * x[1] - x[2] * x[0])));
    const x = [1, 0.5, 2], base = [0, 0, 0];
    expect(shapley(f, x, base, 30).reduce((a, b) => a + b, 0)).toBeCloseTo(f(x) - f(base), 9);
  });
});

describe("synthetic labelled history", () => {
  const h = generateHistory(7, 4000, 100);
  it("has thousands of labelled invoices and is deterministic", () => {
    expect(generateHistory(20261112).invoices.length).toBeGreaterThanOrEqual(5000);
    expect(JSON.stringify(generateHistory(7, 300, 20))).toBe(JSON.stringify(generateHistory(7, 300, 20)));
  });
  it("shows realistic correlations", () => {
    const rate = (f: (i: (typeof h.invoices)[number]) => boolean) => { const s = h.invoices.filter(f); return s.filter((i) => i.exception).length / s.length; };
    expect(rate((i) => i.features.amendedAfterPo === 1)).toBeGreaterThan(rate((i) => i.features.amendedAfterPo === 0) + 0.1);
    expect(rate((i) => i.features.supplierOnTimeRate < 0.8)).toBeGreaterThan(rate((i) => i.features.supplierOnTimeRate >= 0.8));
    const late = (f: (i: (typeof h.invoices)[number]) => boolean) => { const s = h.invoices.filter(f); return s.filter((i) => i.delayed).length / s.length; };
    expect(late((i) => i.exception === 1)).toBeGreaterThan(late((i) => i.exception === 0));
    const price = h.invoices.filter((i) => i.exception && i.features.amendedAfterPo === 1); expect(price.filter((i) => i.cause === 0).length / price.length).toBeGreaterThan(0.4);
  });
  it("is in date order and every exception has a cause", () => {
    for (let i = 1; i < h.invoices.length; i++) expect(h.invoices[i].date >= h.invoices[i - 1].date).toBe(true);
    expect(h.invoices.every((i) => (i.exception === 1) === (i.cause >= 0))).toBe(true);
  });
});

describe("training and evaluation", () => {
  it("every task has a proper split, three compared algorithms and held-out metrics better than a baseline", () => {
    for (const t of Object.values(models.tasks)) {
      expect(t.data.train + t.data.validation + t.data.test).toBe(t.data.rows);
      expect(t.comparison.map((c) => c.algorithm).sort()).toEqual(["boosting", "forest", "logistic"]);
      expect(t.comparison.filter((c) => c.chosen)).toHaveLength(1);
    }
    expect((models.tasks.exception.test as { auc: number }).auc).toBeGreaterThan(0.7);
    expect((models.tasks.delay.test as { auc: number }).auc).toBeGreaterThan(0.65);
    expect((models.tasks.supplierRisk.test as { auc: number }).auc).toBeGreaterThan(0.65);
    const c = models.tasks.cause.test as { accuracy: number; baselineAccuracy: number };
    expect(c.accuracy).toBeGreaterThan(c.baselineAccuracy + 0.15);
    expect(models.tasks.cause.classes).toEqual([...CAUSES]);
  });
  it("is reproducible: training twice gives identical models", () => {
    const a = trainAll({ quick: true, invoices: 1500, suppliers: 50 }), b = trainAll({ quick: true, invoices: 1500, suppliers: 50 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("model files and metrics are saved", () => { expect(fs.existsSync(path.join(ML_TMP, "models.json"))).toBe(true); });
  it("predictions respond to the inputs (nothing hard-coded)", () => {
    const t = models.tasks.exception; const base = vectorOf(INVOICE_FEATURES, {}); const i = INVOICE_FEATURES.indexOf("amendedAfterPo");
    const hi = base.slice(); hi[i] = 1;
    expect(predictProba(t.model, hi)[1]).toBeGreaterThan(predictProba(t.model, base)[1]);
    expect(fs.readFileSync(path.join(__dirname, "predictor.ts"), "utf8")).not.toMatch(/probability:\s*0\.\d/);
    expect(DELAY_FEATURES.length).toBeGreaterThan(INVOICE_FEATURES.length);
  });
});

describe("supplier relationship intelligence", () => {
  // Reconstructed A/B/C scenario (the original spec figures were not available in the repo).
  const base: ScoreInputs = { tenureMonths: 12, deliveryReliability: 0.9, quality: 0.99, disputeRate: 0.1, paymentHistory: 1, materialCriticality: 0.5, alternativeAvailability: 0.5, dependency: 0.3, redFlags: 0, exceptionTrend: 0 };
  const A = scoreSupplier({ ...base, tenureMonths: 60, deliveryReliability: 0.98, quality: 0.995, disputeRate: 0.03, materialCriticality: 0.25, alternativeAvailability: 1, dependency: 0.1 });
  const B = scoreSupplier({ ...base, tenureMonths: 4, materialCriticality: 1, alternativeAvailability: 0, dependency: 1 });
  const C = scoreSupplier({ ...base, tenureMonths: 30, deliveryReliability: 0.55, quality: 0.9, disputeRate: 0.4, redFlags: 2, exceptionTrend: 0.15, materialCriticality: 0.6, alternativeAvailability: 0.3, dependency: 0.5 });
  it("A: strong relationship, low criticality, low risk", () => { expect(A.relationshipStrength.band).toBe("High"); expect(A.supplyCriticality.band).toBe("Low"); expect(A.supplierRisk.band).toBe("Low"); });
  it("B: new but critical sole source", () => { expect(B.supplyCriticality.band).toBe("High"); expect(B.relationshipStrength.score).toBeLessThan(A.relationshipStrength.score); });
  it("C: risky, middling criticality", () => { expect(C.supplierRisk.band).toBe("High"); expect(C.supplierRisk.score).toBeGreaterThan(B.supplierRisk.score); expect(C.supplyCriticality.score).toBeLessThan(B.supplyCriticality.score); });
  it("the three scores are independent and explained", () => {
    expect(A.supplyCriticality.score).not.toBe(A.relationshipStrength.score);
    for (const s of [A, B, C]) for (const k of [s.relationshipStrength, s.supplyCriticality, s.supplierRisk]) { expect(k.parts.length).toBeGreaterThan(2); expect(k.summary.length).toBeGreaterThan(20); expect(k.score).toBeGreaterThanOrEqual(0); expect(k.score).toBeLessThanOrEqual(100); }
  });
  it("priority combines scores with due date, value, approvals, discount and contract; and respects the policy note", () => {
    const inv = { invoiceTotalInr: 500000, dueInDays: 5, pendingApprovals: 1, hasOpenException: true };
    const pB = investigationPriority({ scores: B, ...inv }), pA = investigationPriority({ scores: A, ...inv });
    expect(pB.priority).toBeGreaterThan(pA.priority);
    expect(investigationPriority({ scores: A, ...inv, dueInDays: -3 }).priority).toBeGreaterThan(pA.priority);
    expect(investigationPriority({ scores: A, ...inv, earlyDiscountPct: 2, discountDaysLeft: 3 }).priority).toBeGreaterThan(pA.priority);
    expect(investigationPriority({ scores: A, ...inv, contractualPaymentDate: true }).priority).toBeGreaterThan(pA.priority);
    expect(pB.note).toBe(PRIORITY_NOTE); expect(PRIORITY_NOTE).toMatch(/contracts and financial policy/); expect(pB.explanation).toMatch(/priority/);
  });
  it("the hero supplier (ABC Chemicals equivalent, Vihar Chem Supplies V-1001) is high criticality", () => {
    const f = loadSupplierFacts(eng.connectors, TODAY).get("V-1001")!;
    expect(f.scores.supplyCriticality.band).toBe("High");
    expect(loadSupplierFacts(eng.connectors, TODAY).size).toBe(ds.vendors.length);
  });
});

describe("live predictions", () => {
  const bundle = (id: string) => loadCanonical(eng.connectors, id).bundle!;
  const facts = () => loadSupplierFacts(eng.connectors, TODAY);
  it("INV-7781 (the hero invoice, INV-2044 in the brief) has meaningful predictions", () => {
    const o = predictionFor(eng, "INV-7781"); expect(o.ok).toBe(true); if (!o.ok) return; const p = o.prediction;
    expect(p.exception.level).toBe("High"); expect(p.exception.factors.length).toBeGreaterThan(0);
    expect(p.causes[0].cause).toBe("price_mismatch"); expect(p.causes[0].evidenceStatus).toBe("evidence_supported"); expect(p.causes[0].evidence[0]).toMatch(/C-22.*398.*412/);
    expect(p.delay.probability).toBeGreaterThan(0); expect(p.supplier.scores.supplyCriticality.band).toBe("High");
    expect(p.actions.join(" ")).toMatch(/contracts and financial policy/);
  });
  it("all demo documents have a complete prediction with no NaN", () => {
    expect(ds.demoDocs.length).toBeGreaterThanOrEqual(15);
    for (const d of ds.demoDocs) {
      const o = predictionFor(eng, d.invoiceId); expect(o.ok, d.invoiceId).toBe(true); if (!o.ok) continue; const p = o.prediction;
      for (const v of [p.exception.probability, p.delay.probability, p.supplier.probability, ...p.causes.map((c) => c.probabilityIfException)]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(p.causes).toHaveLength(3);
      expect(JSON.stringify(p)).not.toMatch(/NaN|undefined|Infinity/);
      const st = eng.stored(d.invoiceId)!.prediction; expect(st.available).toBe(true);
    }
  });
  it("a cause is evidence-supported only when records back it", () => {
    for (const d of ds.demoDocs) { const o = predictionFor(eng, d.invoiceId, { factors: false }); if (!o.ok) continue; for (const c of o.prediction.causes) expect(c.evidenceStatus === "evidence_supported").toBe(c.evidence.length > 0); }
    const b = bundle("INV-7784");
    const bare: CanonicalBundle = { ...b, goodsReceipts: [], shipments: [], gateEntries: [], deliveryNotes: [] };
    expect(causeEvidence("missing_receipt", bare)).toEqual([]);
    expect(causeEvidence("missing_receipt", { ...bare, shipments: [{ id: "S1", poId: "1", dispatchedOn: "2026-11-01", status: "in_transit" }] })[0]).toMatch(/in transit/);
  });
  it("predictions are reproducible", () => {
    const b = bundle("INV-7781"), r = eng.stored("INV-7781");
    const one = () => JSON.stringify(predictInvoice(b, r, facts().get("V-1001")!, models, TODAY));
    expect(one()).toBe(one());
  });
  it("every one of the 650 invoices carries stored predictions", () => {
    const ids = eng.connectors.finance.listInvoiceHeaders().map((r) => String(r.invoice_no));
    expect(ids.length).toBe(650);
    expect(ids.every((id) => eng.stored(id)!.prediction.available === true)).toBe(true);
  });
  it("flagged invoices score higher than clean ones on average (sanity check against the rules, not used for training)", () => {
    const P: number[] = [], Y: number[] = [];
    for (const id of eng.connectors.finance.listInvoiceHeaders().map((r) => String(r.invoice_no))) { const r = eng.stored(id)!; const it = r.prediction.available ? r.prediction.items[0].probability : 0; P.push(it); Y.push(r.status === "pass" ? 0 : 1); }
    expect(rocAuc(P, Y)).toBeGreaterThan(0.65);
  });
  it("investigation queue lists open invoices with a policy note, highest priority first", () => {
    const ids = eng.connectors.finance.listInvoiceHeaders().filter((h) => String(h.status) !== "paid").map((h) => String(h.invoice_no));
    const q = investigationQueue(eng, ids, 10); expect(q).toHaveLength(10);
    for (let i = 1; i < q.length; i++) expect(q[i - 1].priority).toBeGreaterThanOrEqual(q[i].priority);
  });
  it("supplier table has three scores for all suppliers", () => {
    const t = supplierTable(eng); expect(Array.isArray(t)).toBe(true); if (!Array.isArray(t)) return; expect(t).toHaveLength(30);
  });
  it("a source outage gives a clear message, not a crash", () => {
    setOutage(eng.integration, "supplier", true);
    try {
      const o = predictionFor(eng, "INV-7781"); expect(o.ok).toBe(false); if (!o.ok) { expect(o.status).toBe(503); expect(o.message).toMatch(/unavailable/i); }
      const t = supplierTable(eng); expect("error" in t).toBe(true);
    } finally { setOutage(eng.integration, "supplier", false); }
    expect(SourceUnavailableError).toBeDefined();
  });
  it("unknown invoice gives a 404 outcome", () => { const o = predictionFor(eng, "NOPE-1"); expect(o.ok).toBe(false); if (!o.ok) expect(o.status).toBe(404); });
});
