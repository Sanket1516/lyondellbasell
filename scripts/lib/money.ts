import assert from "node:assert/strict";

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Indian digit grouping: 1062000 -> "10,62,000". Always two decimals when `dp` is 2. */
export function inr(n: number, dp = 2): string {
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toFixed(dp).split(".");
  let g = int;
  if (int.length > 3) {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    g = `${rest},${last3}`;
  }
  return `${neg ? "-" : ""}${g}${frac ? "." + frac : ""}`;
}

export interface Totals { subtotal: number; tax: number; total: number }

export function computeTotals(lines: { qty: number; unitPrice: number }[], taxRatePct: number): Totals {
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.qty * l.unitPrice), 0));
  const tax = r2((subtotal * taxRatePct) / 100);
  return { subtotal, tax, total: r2(subtotal + tax) };
}

/** Throws if the numbers drift: lines x price + GST must equal the total. */
export function assertTotals(label: string, lines: { qty: number; unitPrice: number; amount?: number }[], taxRatePct: number, t: Totals) {
  for (const l of lines) if (l.amount !== undefined) assert.equal(l.amount, r2(l.qty * l.unitPrice), `${label}: line amount`);
  const c = computeTotals(lines, taxRatePct);
  assert.equal(t.subtotal, c.subtotal, `${label}: subtotal`);
  assert.equal(t.tax, c.tax, `${label}: tax`);
  assert.equal(t.total, c.total, `${label}: total`);
  assert.equal(r2(t.subtotal + t.tax), t.total, `${label}: subtotal + tax = total`);
}
