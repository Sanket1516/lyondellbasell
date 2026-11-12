// PlantPay matching extensions and risk detectors. Pure and deterministic: canonical bundle in, findings out.
//   - Quality cross-check: billed quantity vs quantity ACCEPTED at inspection (rejected goods should not be paid for).
//   - Logistics cross-check: weighbridge net weight vs GRN quantity vs invoice quantity (for goods bought by weight).
//   - Risk detectors (interim, behind the RiskDetector interface until the Stage 5 module replaces them): bank-detail change,
//     shared bank account, threshold splitting. They are WARNINGS for human review, never accusations.
import { uomFactor } from "../engine/match";
import { ENGINE_CONFIG } from "../engine/config";
import { THRESHOLDS } from "../lib/constants";
import { fmtInr } from "../lib/format";
import type { CanonicalBundle } from "./canonical";

export const PLANTPAY_CONFIG = {
  /** Weighbridge net weight may differ from the GRN weight by this much (percent). Assumption, tunable. */
  weighbridgePct: 1,
  /** A bank account change within this many days of the invoice date is highlighted. */
  bankChangeLookbackDays: 90,
  /** Invoices on one PO within this many days of each other are checked for threshold splitting. */
  splitWindowDays: 1,
} as const;

export interface CrossFinding {
  check: "quality" | "weighbridge" | "contract" | "inventory";
  lineNo?: number;
  message: string;
  expected: string;
  actual: string;
  rootCause: string;
  owner: string;
  smallestFix: string;
  evidence: string[];
}

const q = (n: number) => (Number.isInteger(n) ? fmtInr(n, 0) : fmtInr(Math.round(n * 1000) / 1000, 3).replace(/0+$/, "").replace(/\.$/, ""));
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

export interface QualityOutcome { findings: CrossFinding[]; note: string; evaluated: boolean }

/** Billed quantity against accepted quantity, per PO line, in the PO unit. */
export function qualityCheck(b: CanonicalBundle): QualityOutcome {
  const po = b.po;
  if (!po) return { findings: [], note: "No PO to compare against.", evaluated: false };
  if (b.goodsReceipts.length === 0) return { findings: [], note: "Nothing has been received yet, so there is nothing to inspect.", evaluated: true };
  const findings: CrossFinding[] = [];
  for (const line of b.invoice.lines) {
    const pl = po.lines.find((p) => (line.itemCode ? p.itemCode === line.itemCode : p.description.toLowerCase() === line.description.toLowerCase()));
    if (!pl) continue;
    const conv = uomFactor(b.uomRules, pl.itemCode, line.uom, pl.uom);
    const billed = line.qty * (conv?.factor ?? 1);
    const received = b.goodsReceipts.flatMap((g) => g.lines.filter((l) => l.lineNo === pl.lineNo)).reduce((a, l) => a + l.qtyReceived, 0);
    const insp = b.inspections.flatMap((i) => i.lines.filter((l) => l.poLineNo === pl.lineNo).map((l) => ({ i, l })));
    const inspected = insp.reduce((a, x) => a + x.l.qtyInspected, 0);
    if (received > 0 && inspected < received) {
      findings.push({
        check: "quality", lineNo: line.lineNo,
        message: `${q(received - inspected)} ${pl.uom} of the ${q(received)} ${pl.uom} received on ${pl.itemCode} has no inspection result yet.`,
        expected: "An inspection result for everything received", actual: `${q(inspected)} of ${q(received)} ${pl.uom} inspected`,
        rootCause: "Inspection not completed", owner: "Quality",
        smallestFix: "Passes once Quality records the inspection result for the receipt.",
        evidence: b.goodsReceipts.map((g) => `Goods receipt ${g.id} (${g.receivedOn}): ${g.lines.filter((l) => l.lineNo === pl.lineNo).map((l) => `${q(l.qtyReceived)} ${l.uom}`).join(", ") || "no line for this item"}`),
      });
      continue;
    }
    const accepted = insp.reduce((a, x) => a + x.l.qtyAccepted, 0);
    const rejected = insp.reduce((a, x) => a + x.l.qtyRejected, 0);
    // Only the part of the bill that was actually received can be rejected; billing more than was received is the quantity check's concern.
    if (Math.min(billed, received) > accepted * (1 + ENGINE_CONFIG.qtyPct / 100) + 1e-9) {
      const reasons = [...new Set(insp.map((x) => x.l.reason).filter(Boolean))].join("; ");
      findings.push({
        check: "quality", lineNo: line.lineNo,
        message: `Billed ${q(Math.min(billed, received))} ${pl.uom} of ${pl.itemCode} (received), but only ${q(accepted)} ${pl.uom} passed inspection (${q(rejected)} ${pl.uom} rejected${reasons ? `: ${reasons}` : ""}).`,
        expected: `${q(accepted)} ${pl.uom} accepted`, actual: `${q(billed)} ${pl.uom} billed`,
        rootCause: "Rejected goods included in the invoice", owner: "Quality",
        smallestFix: `Passes if the supplier credits the ${q(rejected)} ${pl.uom} rejected (corrected invoice or credit note), or Quality records a documented concession accepting them.`,
        evidence: insp.map((x) => `Inspection ${x.i.id} (${x.i.inspectedOn}, ${x.i.inspector}): ${q(x.l.qtyAccepted)} accepted, ${q(x.l.qtyRejected)} rejected of ${q(x.l.qtyInspected)} ${x.l.uom}${x.l.reason ? `, ${x.l.reason}` : ""}`),
      });
    }
  }
  const total = b.inspections.reduce((a, i) => a + i.lines.reduce((x, l) => x + l.qtyRejected, 0), 0);
  return { findings, evaluated: true, note: findings.length ? findings.map((f) => f.message).join(" ") : b.inspections.length ? `Inspection accepted the billed quantity (${q(total)} rejected in total on this PO).` : "No inspection records are required yet." };
}

export interface LogisticsOutcome { findings: CrossFinding[]; note: string; evaluated: boolean }

/** Weighbridge net weight against GRN weight and billed weight, for lines bought by weight (kg or MT). */
export function weighbridgeCheck(b: CanonicalBundle): LogisticsOutcome {
  const po = b.po;
  if (!po) return { findings: [], note: "No PO to compare against.", evaluated: false };
  const wb = b.weighbridge;
  if (wb.length === 0) return { findings: [], evaluated: true, note: "No weighbridge record for this delivery (goods are counted, not weighed)." };
  const findings: CrossFinding[] = [];
  const weighLines = po.lines.filter((l) => l.uom === "kg");
  if (weighLines.length === 0) return { findings, evaluated: true, note: "Weighbridge record exists but the PO lines are not bought by weight." };
  const grnKg = b.goodsReceipts.reduce((a, g) => a + g.lines.filter((l) => weighLines.some((w) => w.lineNo === l.lineNo)).reduce((x, l) => x + l.qtyReceived, 0), 0);
  const netKg = wb.reduce((a, w) => a + w.netKg, 0);
  let billedKg = 0;
  for (const l of b.invoice.lines) {
    const pl = weighLines.find((p) => p.itemCode === l.itemCode);
    if (pl) billedKg += l.qty * (uomFactor(b.uomRules, pl.itemCode, l.uom, "kg")?.factor ?? 1);
  }
  const tol = PLANTPAY_CONFIG.weighbridgePct;
  const grnGap = grnKg > 0 ? ((grnKg - netKg) / grnKg) * 100 : 0;
  const billedOver = netKg > 0 ? ((billedKg - netKg) / netKg) * 100 : 0;
  const evidence = [
    ...wb.map((w) => `Weighbridge ${w.id} (${w.weighedOn}): gross ${q(w.grossKg)} kg, tare ${q(w.tareKg)} kg, net ${q(w.netKg)} kg`),
    ...b.goodsReceipts.map((g) => `Goods receipt ${g.id}: ${q(g.lines.filter((l) => weighLines.some((w) => w.lineNo === l.lineNo)).reduce((x, l) => x + l.qtyReceived, 0))} kg`),
  ];
  if (Math.abs(grnGap) > tol + 1e-9 || billedOver > tol + 1e-9) {
    findings.push({
      check: "weighbridge",
      message: `Weighbridge net weight is ${q(netKg)} kg; the goods receipt says ${q(grnKg)} kg and the invoice bills ${q(billedKg)} kg (${Math.abs(grnGap).toFixed(1)}% ${grnGap >= 0 ? "below" : "above"} the GRN).`,
      expected: `${q(grnKg)} kg per GRN (within ${tol}%)`, actual: `${q(netKg)} kg weighed`,
      rootCause: "Quantity received or billed exceeds the weight that crossed the weighbridge", owner: "Logistics",
      smallestFix: `Passes if Logistics confirms a re-weigh or the GRN and invoice are corrected to about ${q(netKg)} kg.`,
      evidence,
    });
  }
  return { findings, evaluated: true, note: findings.length ? findings[0].message : `Weighbridge net ${q(netKg)} kg agrees with the GRN (${q(grnKg)} kg) within ${tol}%.` };
}

// ---------------------------------------------------------------- risk detectors (interface + interim implementations)
export interface RiskWarning {
  kind: "bank_change" | "shared_bank_account" | "threshold_splitting" | "address_change" | "tax_id_conflict" | "duplicate_risk" | "graph_link";
  /** "review" needs a person; "info" is shown but does not hold the invoice. */
  severity: "review" | "info";
  message: string;
  evidence: string[];
  /** Always set for bank-detail changes: payment must wait for verification through a known contact. */
  requiresIndependentVerification?: boolean;
  department: string;
  /** Task title for the owning department when it differs from the message (Stage 5 bank-change verification). */
  taskTitle?: string;
}
export interface RiskDetector { readonly name: string; detect(bundle: CanonicalBundle): RiskWarning[] }

export const bankChangeDetector: RiskDetector = {
  name: "bank-detail change (interim, Stage 5 will replace)",
  detect(b) {
    if (!b.vendor || !b.remit) return [];
    const inv = b.invoice;
    const accounts = b.vendor.bankAccounts;
    const matching = accounts.find((a) => a.accountNo === b.remit!.accountNo);
    // Warn when the invoice names an account that is unknown, not yet verified, or already closed on the invoice date.
    // An account that was valid on the invoice date and closed later is normal history, not a warning.
    const unverified = matching && matching.status === "pending_verification" ? matching : undefined;
    const closedBefore = matching && matching.status === "closed" && matching.validTo && matching.validTo < inv.invoiceDate ? matching : undefined;
    const notOnFile = !matching;
    if (!unverified && !notOnFile && !closedBefore) return [];
    const ev = [
      `Remittance account on the invoice: ${b.remit.accountNo} (${b.remit.ifsc})`,
      ...accounts.map((a) => `Supplier master: ${a.accountNo} at ${a.bankName}, ${a.status}${a.validTo ? `, closed ${a.validTo}` : `, from ${a.validFrom}`}${a.note ? `. ${a.note}` : ""}`),
    ];
    return [{
      kind: "bank_change", severity: "review", requiresIndependentVerification: true, department: "Supplier master data", evidence: ev,
      message: `Bank details changed: ${notOnFile ? "the invoice names an account that is not on the supplier master" : unverified ? "the account on the invoice is new and still pending verification" : `the invoice names an account that was closed on ${closedBefore!.validTo}`}. Do not pay until the change is verified independently, by calling a contact already on file (not the number or e-mail on the invoice or the change request).`,
    }];
  },
};

export const sharedAccountDetector: RiskDetector = {
  name: "shared bank account (interim, Stage 5 will replace)",
  detect(b) {
    if (!b.remit || b.accountHolders.length === 0) return [];
    const own = b.vendor?.bankAccounts.find((a) => a.accountNo === b.remit!.accountNo);
    const confirmed = !!own?.note && /confirmed legitimate/i.test(own.note);
    // A long-standing shared account is background; one added recently is worth a look.
    const recent = !!own && dayDiff(own.validFrom, b.invoice.invoiceDate) <= PLANTPAY_CONFIG.bankChangeLookbackDays && own.validFrom <= b.invoice.invoiceDate;
    const others = b.accountHolders.map((h) => `${h.name} (${h.vendorId})`).join(", ");
    return [{
      kind: "shared_bank_account", severity: !confirmed && recent ? "review" : "info", department: "Supplier master data",
      message: confirmed
        ? `The remittance account is also held by ${others}. This sharing was confirmed as legitimate when the supplier was onboarded; no action needed.`
        : !recent ? `The remittance account is also held by ${others}. The account has been on the supplier master for some time; noted for information.`
        : `The remittance account is also held by ${others}. Shared accounts can be legitimate (for example group companies), so this is a prompt for a person to check the relationship, not a finding of wrongdoing.`,
      evidence: [`Account ${b.remit.accountNo} appears on ${b.accountHolders.length + 1} supplier records`, ...(own?.note ? [own.note] : [])],
    }];
  },
};

export const splittingDetector: RiskDetector = {
  name: "threshold splitting (interim, Stage 5 will replace)",
  detect(b) {
    const inv = b.invoice;
    if (!inv.poId) return [];
    const limit = THRESHOLDS.clerkMax;
    const group = [inv, ...b.relatedInvoices.filter((o) => o.poId === inv.poId && dayDiff(o.invoiceDate, inv.invoiceDate) <= PLANTPAY_CONFIG.splitWindowDays)];
    if (group.length < 2 || !group.every((g) => g.total <= limit)) return [];
    const sum = group.reduce((a, g) => a + g.total, 0);
    if (sum <= limit) return [];
    return [{
      kind: "threshold_splitting", severity: "review", department: "Finance",
      message: `${group.length} invoices on PO ${inv.poId} dated within ${PLANTPAY_CONFIG.splitWindowDays} day(s) of each other are each under ₹${fmtInr(limit, 0)}, but together come to ₹${fmtInr(sum)}, which is above the clerk approval limit. Please review whether they should be approved as one. This can be a normal staged delivery.`,
      evidence: group.map((g) => `${g.id}: ₹${fmtInr(g.total)} dated ${g.invoiceDate}`),
    }];
  },
};

export const DEFAULT_DETECTORS: RiskDetector[] = [bankChangeDetector, sharedAccountDetector, splittingDetector];
