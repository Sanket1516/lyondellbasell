// Feature definitions shared by the training history and the live invoices, so the models see the same columns in both.
// Every invoice feature is something known when the invoice arrives; none is the outcome of the deterministic matching rules
// (the rules decide; the models only estimate what is likely to happen and why).
import type { CanonicalBundle } from "../plantpay/canonical";
import type { SupplierFacts } from "./supplier";
import { criticalityOf } from "./materials";

export const INVOICE_FEATURES = [
  "logValue", "lineCount", "supplierExceptionRate", "supplierOnTimeRate", "supplierRejectRate", "supplierTenureMonths", "supplierRedFlags",
  "poAgeDays", "hasReceipt", "receiptLagDays", "receiptCoverage", "partialDelivery", "poHasContract", "amendedAfterPo",
  "unitConversion", "poChangeCount", "materialCriticality", "monthEnd", "paymentTermsDays",
] as const;
export const DELAY_EXTRA = ["approvalLevel", "approvalPending", "daysToDue", "supplierPayLateRate", "hasDiscount"] as const;
export const DELAY_FEATURES = [...INVOICE_FEATURES, ...DELAY_EXTRA] as const;
export const SUPPLIER_FEATURES = [
  "onTimeRate", "rejectRate", "disputeRate", "payLateRate", "tenureMonths", "alternativeAvailability", "dependency", "materialCriticality", "spendShare", "exceptionTrend", "redFlags", "amendmentCount", "leadDaysSd", "avgLeadDays",
] as const;
export const CAUSES = ["price_mismatch", "quantity_mismatch", "missing_receipt", "unit_mismatch", "tax_error", "duplicate_invoice", "quality_rejection"] as const;
export type Cause = (typeof CAUSES)[number];
export const CAUSE_LABEL: Record<Cause, string> = {
  price_mismatch: "Price differs from the PO or contract", quantity_mismatch: "Quantity billed differs from quantity received", missing_receipt: "Goods receipt not posted when the invoice arrived",
  unit_mismatch: "Unit of measure differs between invoice and PO", tax_error: "Tax rate or tax amount differs", duplicate_invoice: "Possible duplicate of an earlier invoice", quality_rejection: "Goods rejected at inspection",
};

export type FeatureRecord = Record<string, number>;
export const vectorOf = (names: readonly string[], rec: FeatureRecord): number[] => names.map((n) => rec[n] ?? 0);

/** Human wording for a feature value, used in "top contributing factors". */
export const FEATURE_META: Record<string, { label: string; show: (v: number) => string }> = {
  logValue: { label: "Invoice value", show: (v) => `₹${Math.round(Math.exp(v)).toLocaleString("en-IN")}` },
  lineCount: { label: "Number of invoice lines", show: (v) => `${v} line${v === 1 ? "" : "s"}` },
  supplierExceptionRate: { label: "Supplier's past exception rate", show: (v) => `${Math.round(v * 100)}% of its invoices needed an exception resolved` },
  supplierOnTimeRate: { label: "Supplier's on-time delivery", show: (v) => `${Math.round(v * 100)}% of deliveries on time` },
  supplierRejectRate: { label: "Supplier's rejected goods", show: (v) => `${(v * 100).toFixed(1)}% of inspected goods rejected` },
  supplierTenureMonths: { label: "Relationship length", show: (v) => `${Math.round(v)} months` },
  supplierRedFlags: { label: "Supplier red flags", show: (v) => `${v} warning${v === 1 ? "" : "s"} on the supplier record` },
  poAgeDays: { label: "Days from PO to invoice", show: (v) => `${Math.round(v)} days` },
  hasReceipt: { label: "Goods receipt on file", show: (v) => (v ? "receipt found" : "no goods receipt found") },
  receiptLagDays: { label: "Days between receipt and invoice", show: (v) => (v < 0 ? `receipt posted ${Math.abs(Math.round(v))} days after the invoice date` : `${Math.round(v)} days after receipt`) },
  receiptCoverage: { label: "Share of billed quantity received", show: (v) => `${Math.round(v * 100)}% of the billed quantity received` },
  partialDelivery: { label: "Partial delivery", show: (v) => (v ? "delivery is partial" : "delivery complete") },
  poHasContract: { label: "PO linked to a contract", show: (v) => (v ? "contract on file" : "no contract on file") },
  amendedAfterPo: { label: "Contract price amended after the PO", show: (v) => (v ? "the contract price changed after the PO was issued" : "no later price amendment") },
  unitConversion: { label: "Unit differs from the PO", show: (v) => (v ? "billed in a different unit than ordered" : "same unit as ordered") },
  poChangeCount: { label: "Changes made to the PO", show: (v) => `${v} change${v === 1 ? "" : "s"} on record` },
  materialCriticality: { label: "Material criticality", show: (v) => `${Math.round(v * 100)}% on the criticality scale` },
  monthEnd: { label: "Month-end invoice", show: (v) => (v ? "dated in the last days of the month" : "mid-month") },
  paymentTermsDays: { label: "Payment terms", show: (v) => `${Math.round(v)} days` },
  approvalLevel: { label: "Approval level needed", show: (v) => ["clerk", "level 1 approver", "level 2 approver"][Math.round(v)] ?? String(v) },
  approvalPending: { label: "Awaiting approval", show: (v) => (v ? "no approval recorded yet" : "approval already recorded") },
  daysToDue: { label: "Days left to the due date at receipt", show: (v) => `${Math.round(v)} days` },
  supplierPayLateRate: { label: "Past late payments to this supplier", show: (v) => `${Math.round(v * 100)}% of past payments late` },
  hasDiscount: { label: "Early-payment discount", show: (v) => (v ? "the contract offers one" : "none") },
  onTimeRate: { label: "On-time delivery rate", show: (v) => `${Math.round(v * 100)}%` },
  rejectRate: { label: "Reject rate", show: (v) => `${(v * 100).toFixed(1)}%` },
  disputeRate: { label: "Invoice dispute rate", show: (v) => `${Math.round(v * 100)}%` },
  payLateRate: { label: "Late payments by the plant", show: (v) => `${Math.round(v * 100)}%` },
  tenureMonths: { label: "Relationship length", show: (v) => `${Math.round(v)} months` },
  alternativeAvailability: { label: "Alternative suppliers", show: (v) => `${Math.round(v * 100)}% availability` },
  dependency: { label: "Plant dependency", show: (v) => `${Math.round(v * 100)}%` },
  spendShare: { label: "Share of plant spend", show: (v) => `${(v * 100).toFixed(1)}%` },
  exceptionTrend: { label: "Exception trend", show: (v) => (v > 0 ? `rising by ${Math.round(v * 100)} points` : v < 0 ? `falling by ${Math.round(-v * 100)} points` : "flat") },
  redFlags: { label: "Red flags on record", show: (v) => `${v}` },
  amendmentCount: { label: "Contract price amendments", show: (v) => `${v}` },
  leadDaysSd: { label: "Lead-time variability", show: (v) => `${v.toFixed(1)} days` },
  avgLeadDays: { label: "Average lead time", show: (v) => `${v.toFixed(1)} days` },
};

const D = (s: string) => Date.parse(s.slice(0, 10) + "T00:00:00Z");
const days = (a: string, b: string) => Math.round((D(b) - D(a)) / 86400000);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Convert a billed quantity into the PO unit using the unit rules in the bundle. Returns undefined when no rule covers the pair. */
function toPoUnit(b: CanonicalBundle, itemCode: string | undefined, qty: number, from: string, to: string): number | undefined {
  if (from === to) return qty;
  const r = b.uomRules.find((u) => u.itemCode === itemCode && u.fromUom === from && u.toUom === to);
  if (r) return qty * r.factor;
  const inv = b.uomRules.find((u) => u.itemCode === itemCode && u.fromUom === to && u.toUom === from);
  return inv ? qty / inv.factor : undefined;
}

/** Features for one live invoice. `facts` is the supplier's profile (Supplier Relationship Intelligence). */
export function extractInvoiceFeatures(b: CanonicalBundle, facts: SupplierFacts): FeatureRecord {
  const inv = b.invoice, po = b.po;
  const grLines = b.goodsReceipts.flatMap((g) => g.lines);
  const firstGr = b.goodsReceipts.map((g) => g.receivedOn).sort()[0];
  let coverage = b.goodsReceipts.length ? 1.2 : 0;
  if (po && b.goodsReceipts.length) {
    for (const l of inv.lines) {
      const pl = po.lines.find((x) => x.itemCode === l.itemCode); if (!pl) continue;
      const billed = toPoUnit(b, l.itemCode, l.qty, l.uom, pl.uom); if (!billed || billed <= 0) continue;
      const got = grLines.filter((g) => g.lineNo === pl.lineNo).reduce((a, g) => a + g.qtyReceived, 0);
      coverage = Math.min(coverage, got / billed);
    }
  }
  coverage = clamp(coverage, 0, 1.2);
  const codes = new Set(inv.lines.map((l) => l.itemCode).filter(Boolean) as string[]);
  const am = b.amendments.filter((a) => codes.has(a.materialCode));
  const issued = po?.issuedOn ?? inv.invoiceDate;
  const amendedAfterPo = am.some((a) => a.effectiveFrom > issued && a.effectiveFrom <= inv.invoiceDate) ? 1 : 0;
  const total = inv.lines.reduce((a, l) => a + l.amount, 0) || 1;
  const unitDiff = inv.lines.some((l) => { const pl = po?.lines.find((x) => x.itemCode === l.itemCode); return !!pl && pl.uom !== l.uom; });
  const day = Number(inv.invoiceDate.slice(8, 10));
  const terms = facts.paymentTermsDays;
  const approvalLevel = inv.total <= 100000 ? 0 : inv.total <= 1500000 ? 1 : 2;
  return {
    logValue: Math.log(Math.max(inv.total, 1)), lineCount: inv.lines.length,
    supplierExceptionRate: facts.disputeRate, supplierOnTimeRate: facts.onTimeRate, supplierRejectRate: facts.rejectRate, supplierTenureMonths: facts.tenureMonths, supplierRedFlags: facts.redFlags,
    poAgeDays: clamp(days(issued, inv.invoiceDate), 0, 120), hasReceipt: b.goodsReceipts.length ? 1 : 0, receiptLagDays: firstGr ? clamp(days(firstGr, inv.invoiceDate), -30, 60) : 0,
    receiptCoverage: coverage, partialDelivery: coverage > 0 && coverage < 0.98 ? 1 : 0, // a delivery split over several receipts that covers the bill is not partial poHasContract: b.contract ? 1 : 0,
    amendedAfterPo, unitConversion: unitDiff ? 1 : 0, poChangeCount: b.poChanges.length,
    materialCriticality: inv.lines.reduce((a, l) => a + criticalityOf(l.itemCode ?? "") * (l.amount / total), 0), monthEnd: day >= 26 ? 1 : 0, paymentTermsDays: terms,
    approvalLevel, approvalPending: inv.status !== "paid" && b.approvals.length === 0 ? 1 : 0, daysToDue: terms - days(inv.invoiceDate, inv.receivedOn),
    supplierPayLateRate: 1 - facts.payOnTimeRate, hasDiscount: facts.contractTerms && facts.contractTerms.earlyPayDiscountPct > 0 ? 1 : 0,
  };
}

export function extractSupplierFeatures(f: SupplierFacts): FeatureRecord {
  return {
    onTimeRate: f.onTimeRate, rejectRate: f.rejectRate, disputeRate: f.disputeRate, payLateRate: 1 - f.payOnTimeRate, tenureMonths: f.tenureMonths, alternativeAvailability: f.alternativeAvailability,
    dependency: f.dependency, materialCriticality: f.materialCriticality, spendShare: f.spendShare, exceptionTrend: f.inputs.exceptionTrend, redFlags: f.redFlags, amendmentCount: f.amendmentCount, leadDaysSd: f.leadDaysSd, avgLeadDays: f.avgLeadDays,
  };
}
