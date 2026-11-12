// Matching rules that can be tuned. Assumptions, labelled as such in the UI.
// Change a value here and the verdicts change (see match.test.ts).
import { TOLERANCE } from "../lib/constants";

export interface EngineConfig {
  /** Invoice price may differ from the PO price by this much (percent, either way). */
  pricePct: number;
  /** Invoice quantity may exceed cumulative goods receipts by this much (percent). */
  qtyPct: number;
  /** Duplicate check: invoice dates this close (days) count as the same window. */
  duplicateDays: number;
  /** Duplicate check: totals this close (rupees) count as the same amount. */
  duplicateAmountInr: number;
  /** Arithmetic check: allowed rounding difference in rupees. */
  arithmeticInr: number;
  /** With no delivery note, goods are expected this many days after the PO date. */
  deliveryLeadDays: number;
}

export const ENGINE_CONFIG: EngineConfig = {
  pricePct: TOLERANCE.pricePct,
  qtyPct: TOLERANCE.qtyPct,
  duplicateDays: 30,
  duplicateAmountInr: 1,
  arithmeticInr: 1,
  deliveryLeadDays: 7,
};
