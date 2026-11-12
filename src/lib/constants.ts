// Shared constants. No server-only import: seed scripts and tests use this file too.

/** The demo "today". Fixed so seeded ages and rehearsals are reproducible. */
export const DEMO_TODAY = "2026-11-12";

export const PLANT = {
  name: "Plant X Polymers Pvt. Ltd.",
  gstin: "27FICTX0001P1Z0",
  address: "Plot 14, MIDC Taloja, Navi Mumbai 410208",
} as const;

/** Tolerances (assumptions, labelled as such in the UI by T3). */
export const TOLERANCE = { pricePct: 2, qtyPct: 5 } as const;

/** Approval thresholds in rupees. */
export const THRESHOLDS = { clerkMax: 100000, l1Max: 1500000 } as const;

/** Payment terms when a vendor has none on file, in days from the invoice date [ASSUMPTION]. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 45;

/** Days from today that a requested owner task is due [ASSUMPTION]. */
export const TASK_DUE_DAYS = 2;

/** Shortest reason accepted for a rejection, send-back, reopening or duplicate decision. */
export const MIN_REASON_CHARS = 8;
