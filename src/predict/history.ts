// Synthetic labelled history for training the four models (Stage 6B). Several thousand invoices from ~200 fictional suppliers,
// 2025-01 to 2026-10, with realistic correlations: a hidden "management quality" factor makes the same suppliers late, reject-prone
// and dispute-prone; amended contract prices, partial deliveries, unit conversions and invoices that arrive before the goods receipt
// raise the chance of an exception and shape *which* exception; exceptions, approval level and month-end raise the chance of a late
// payment; and supplier disruption follows delivery, quality, dispute and payment trends.
// Labels are drawn with noise from these processes. The models never see the processes: they only see the feature columns and the
// labels, and must learn the relationships from the rows. Deterministic for a seed. Synthetic data only; fictional suppliers.
import { Rng, sigmoid, softmax } from "../ml/core";
import { CAUSES, type FeatureRecord } from "./features";

export interface HistoryInvoice { id: string; date: string; supplierId: string; features: FeatureRecord; exception: 0 | 1; cause: number; delayed: 0 | 1; delayDays: number }
export interface HistorySupplierRow { supplierId: string; month: string; features: FeatureRecord; disruption: 0 | 1 }
export interface History { seed: number; invoices: HistoryInvoice[]; supplierRows: HistorySupplierRow[]; suppliers: number }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const poisson = (r: Rng, lam: number) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r.next(); } while (p > L); return k - 1; };
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const START = Date.UTC(2025, 0, 1), END = Date.UTC(2026, 9, 31);

interface Latent { id: string; z: number; onTime: number; reject: number; dispute: number; payLate: number; tenure0: number; crit: number; alt: number; dependency: number; redFlags: number; amendments: number; terms: number; discount: number; spendShare: number; leadMean: number; leadSd: number }

function makeSuppliers(r: Rng, n: number): Latent[] {
  return Array.from({ length: n }, (_, i) => {
    const z = r.normal();
    const alt = r.weighted([0.3, 0.25, 0.25, 0.2]);
    const crit = clamp(0.15 + 0.85 * Math.pow(r.next(), 1.3), 0, 1);
    const onTime = sigmoid(2.4 + 1.0 * z + 0.3 * r.normal());
    return {
      id: `H-${String(i + 1).padStart(4, "0")}`, z, onTime, reject: clamp(0.02 * Math.exp(-0.8 * z + 0.5 * r.normal()), 0.0005, 0.25),
      dispute: sigmoid(-2.0 - 0.7 * z + 0.4 * r.normal()), payLate: sigmoid(-3.1 - 0.3 * z + 0.5 * r.normal()), tenure0: 2 + Math.min(70, -Math.log(1 - r.next()) * 28), crit, alt: alt / 3,
      dependency: clamp((1 / (1 + alt)) * (0.7 + 0.6 * r.next()), 0, 1), redFlags: poisson(r, 0.3), amendments: poisson(r, 0.6 + 1.5 * crit), terms: r.pick([30, 45, 60]), discount: r.bool(0.5) ? 1 : 0,
      spendShare: clamp(Math.exp(-4.2 + 0.9 * r.normal()), 0.001, 0.2), leadMean: 5 + 22 * r.next(), leadSd: 1 + 6 * (1 - onTime) + 0.25 * r.next() * 20,  // usual lead time depends on the material and route, not on reliability
    };
  });
}

export function generateHistory(seed = 20261112, nInvoices = 8000, nSuppliers = 200): History {
  const r = new Rng(seed);
  const sup = makeSuppliers(r, nSuppliers);

  // ---------------------------------------------------------------- invoices
  const invoices: HistoryInvoice[] = [];
  const dates = Array.from({ length: nInvoices }, () => START + Math.floor(r.next() * (END - START))).sort((a, b) => a - b);
  dates.forEach((ms, idx) => {
    const s = sup[r.int(sup.length)];
    const tenure = s.tenure0 + (ms - START) / (86400000 * 30.4);
    const onTimeObs = clamp(s.onTime + 0.06 * r.normal(), 0.2, 1), rejectObs = clamp(s.reject * Math.exp(0.3 * r.normal()), 0, 0.3), excObs = clamp(s.dispute + 0.05 * r.normal(), 0, 0.9);
    const lineCount = clamp(1 + poisson(r, 0.45), 1, 6);
    const logValue = clamp(Math.log(150000) + 1.1 * r.normal(), Math.log(3000), Math.log(3000000));
    const poAge = clamp(Math.round(4 + -Math.log(1 - r.next()) * 10), 1, 120);
    const early = r.bool(0.1 + 0.25 * (1 - onTimeObs));                          // invoice reached AP before the goods receipt was posted
    const noReceipt = early && r.bool(0.55);
    const hasReceipt = noReceipt ? 0 : 1;
    const lag = noReceipt ? 0 : early ? -Math.round(1 + r.next() * 6) : clamp(Math.round(3 + 3.5 * r.normal()), 0, 30);
    const partial = hasReceipt && r.bool(0.1 + 0.25 * (1 - onTimeObs)) ? 1 : 0;
    const coverage = !hasReceipt ? 0 : partial ? 0.4 + 0.57 * r.next() : r.bool(0.1) ? 1.2 : 1;
    const hasContract = r.bool(0.93) ? 1 : 0;
    const amended = hasContract && r.bool(clamp(0.02 + 0.045 * s.amendments + 0.004 * poAge, 0, 0.5)) ? 1 : 0;
    const unit = r.bool(0.05) ? 1 : 0;
    const poChanges = poisson(r, 0.15 + 0.3 * (1 - s.onTime));
    const monthEnd = r.bool(0.2) ? 1 : 0;
    const crit = clamp(s.crit + 0.1 * r.normal(), 0, 1);
    const approvalLevel = Math.exp(logValue) <= 100000 ? 0 : Math.exp(logValue) <= 1500000 ? 1 : 2;
    const approvalPending = r.bool(0.2) ? 1 : 0;
    const receivedLag = 1 + r.int(3);
    const daysToDue = s.terms - receivedLag;
    const features: FeatureRecord = {
      logValue, lineCount, supplierExceptionRate: excObs, supplierOnTimeRate: onTimeObs, supplierRejectRate: rejectObs, supplierTenureMonths: tenure, supplierRedFlags: s.redFlags,
      poAgeDays: poAge, hasReceipt, receiptLagDays: lag, receiptCoverage: coverage, partialDelivery: partial, poHasContract: hasContract, amendedAfterPo: amended,
      unitConversion: unit, poChangeCount: poChanges, materialCriticality: crit, monthEnd, paymentTermsDays: s.terms,
      approvalLevel, approvalPending, daysToDue, supplierPayLateRate: clamp(s.payLate + 0.03 * r.normal(), 0, 1), hasDiscount: s.discount,
    };
    // ---- exception: does the invoice need a human to resolve something?
    const arrivedEarly = !hasReceipt || lag < 0 ? 1 : 0;
    const xl = -3.35 + 4.0 * (excObs - 0.14) + 5 * rejectObs + 1.5 * amended + 1.5 * arrivedEarly + 1.4 * partial + 1.8 * unit + 0.4 * poChanges + 0.3 * (logValue - 11.5) + 0.2 * (lineCount - 1) + 0.015 * (poAge - 14) + 0.4 * monthEnd + 0.3 * s.redFlags + 0.8 * (1 - onTimeObs) + 0.7 * r.normal();
    const exception = r.bool(sigmoid(xl)) ? 1 : 0;
    // ---- root cause given an exception
    let cause = -1;
    if (exception) {
      const logits = [
        0.1 + 2.6 * amended + 0.5 * hasContract - 0.8 * (1 - hasContract),             // price_mismatch
        0.1 + 2.4 * partial + 0.3 * (lineCount - 1),                                  // quantity_mismatch
        -0.6 + 3.0 * arrivedEarly,                                                    // missing_receipt
        -1.3 + 3.2 * unit,                                                            // unit_mismatch
        -0.9 + 0.15 * (lineCount - 1),                                                // tax_error
        -1.7 + 0.5 * monthEnd + 2.0 * (excObs - 0.14),                                // duplicate_invoice
        -1.4 + 22 * (rejectObs - 0.03),                                               // quality_rejection
      ];
      cause = r.weighted(softmax(logits));
    }
    // ---- payment delay
    const dl = -2.9 + 1.9 * exception + 0.8 * approvalLevel + 0.9 * approvalPending - 0.035 * (daysToDue - 44) + 3.0 * s.payLate + 0.5 * monthEnd + 0.3 * (logValue - 11.5) - 0.6 * s.discount + 0.5 * r.normal();
    const delayed = r.bool(sigmoid(dl)) ? 1 : 0;
    invoices.push({ id: `H${String(idx + 1).padStart(5, "0")}`, date: ymd(ms), supplierId: s.id, features, exception: exception as 0 | 1, cause, delayed: delayed as 0 | 1, delayDays: delayed ? Math.round(1 + -Math.log(1 - r.next()) * (4 + 4 * exception)) : 0 });
  });

  // ---------------------------------------------------------------- supplier-month snapshots (disruption in the next 90 days)
  const supplierRows: HistorySupplierRow[] = [];
  for (const s of sup) {
    for (let m = 0; m < 12; m++) {
      const drift = 0.08 * r.normal();
      const onTimeObs = clamp(s.onTime - 0.5 * drift + 0.05 * r.normal(), 0.2, 1), rejectObs = clamp(s.reject * Math.exp(0.3 * r.normal() + drift * 3), 0, 0.3), disputeObs = clamp(s.dispute + drift + 0.04 * r.normal(), 0, 0.9);
      const payLateObs = clamp(s.payLate + 0.03 * r.normal(), 0, 1), tenure = s.tenure0 + m * 1.5;
      const trend = clamp(drift + 0.03 * r.normal(), -0.3, 0.3);
      const l = -3.3 + 4.2 * (1 - onTimeObs) + 9 * rejectObs + 2.4 * disputeObs + 1.8 * payLateObs + 0.4 * s.redFlags + 2.5 * trend - 0.015 * tenure + 0.1 * s.amendments + 0.05 * (s.leadSd - 5) + 0.6 * r.normal();
      supplierRows.push({
        supplierId: s.id, month: `2025-${String(m + 1).padStart(2, "0")}`, disruption: r.bool(sigmoid(l)) ? 1 : 0,
        features: { onTimeRate: onTimeObs, rejectRate: rejectObs, disputeRate: disputeObs, payLateRate: payLateObs, tenureMonths: tenure, alternativeAvailability: s.alt, dependency: s.dependency, materialCriticality: s.crit, spendShare: s.spendShare, exceptionTrend: trend, redFlags: s.redFlags, amendmentCount: s.amendments, leadDaysSd: clamp(s.leadSd + 0.5 * r.normal(), 0.5, 30), avgLeadDays: clamp(s.leadMean + 0.7 * r.normal(), 3, 40) },
      });
    }
  }
  return { seed, invoices, supplierRows, suppliers: sup.length };
}
export { CAUSES };
