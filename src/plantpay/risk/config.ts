// Tunable settings and weights for the four Stage 5 detectors. Everything a reviewer might ask "why this number?" about is here.
import { THRESHOLDS } from "../../lib/constants";

export const RISK_CONFIG = {
  /** Approval threshold in INR. Default Rs 1 lakh (the clerk limit); change it here or pass an override. */
  approvalThreshold: THRESHOLDS.clerkMax as number,
  /** An invoice counts as "just under" the threshold when it is at least this share of it (85% = Rs 85,000 of Rs 1,00,000). */
  nearThresholdShare: 0.85,
  /** Invoices from one supplier this many days apart or less are considered together for splitting. */
  splitWindowDays: 7,
  /** Splitting needs at least this many near-threshold invoices that are related (same PO, or the same items). */
  splitMinInvoices: 2,
  /** Duplicate fingerprint: flag at or above this score (0 to 100). */
  duplicateFlagScore: 70,
  /** Bank or address change within this many days before the invoice date is highlighted. */
  changeLookbackDays: 90,
} as const;
export type RiskConfig = { -readonly [K in keyof typeof RISK_CONFIG]: number };
export const defaultRiskConfig = (): RiskConfig => ({ ...RISK_CONFIG });

/** Duplicate fingerprint weights. They add to 100. */
export const DUPLICATE_WEIGHTS = {
  amount: 22, // total equal (full) or within 1% (half)
  poNumber: 14, // same PO reference
  lineItems: 18, // overlap of item codes and quantities
  quantities: 6,
  tax: 6,
  date: 8, // invoice dates within 7 days (full) or 30 days (half)
  invoiceNumber: 16, // normalised number similarity: INV-1001 vs INV-1001A
  textSimilarity: 10, // description wording
} as const;
