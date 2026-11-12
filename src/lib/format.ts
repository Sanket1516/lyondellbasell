// Display formatting shared by every screen. Indian digit grouping, DD-MMM-YYYY dates.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1062000 -> "10,62,000.00". */
export function fmtInr(n: number, dp = 2): string {
  const [int, frac] = Math.abs(n).toFixed(dp).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const g = rest ? `${rest},${last3}` : last3;
  return `${n < 0 ? "-" : ""}${g}${frac ? "." + frac : ""}`;
}

/** "2026-11-10" -> "10-Nov-2026". Returns the input unchanged if it is not an ISO date. */
export function fmtDate(iso: string | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}` : (iso ?? "");
}

/** Whole rupees without decimals, otherwise two decimals: 1062000 -> "₹10,62,000". */
export function fmtRupees(n: number): string {
  return `₹${fmtInr(n, Number.isInteger(n) ? 0 : 2)}`;
}

/** ISO date plus n days. */
export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** "2026-11-12T09:41:07.000Z" -> "12-Nov-2026 15:11" (India Standard Time). */
export function fmtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const ist = new Date(t + 5.5 * 3600000).toISOString();
  return `${fmtDate(ist.slice(0, 10))} ${ist.slice(11, 16)}`;
}
