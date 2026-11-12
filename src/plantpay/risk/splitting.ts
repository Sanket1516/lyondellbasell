// Detector 2: threshold splitting.
// Looks at one supplier's invoices in a time window. It flags when several invoices sit just under the approval threshold,
// are related (same PO or the same items), and together are over the threshold. Staged deliveries look similar, so the
// wording asks a person to confirm. Not proof of anything.
import type { Invoice } from "../../lib/types";
import { fmtInr } from "../../lib/format";
import type { RiskConfig } from "./config";
import { fingerprintScore } from "./duplicate";
import { makeSignal, type DetectorOutcome, type RiskSignal } from "./types";

const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const itemKeys = (i: Invoice) => new Set(i.lines.map((l) => l.itemCode ?? l.description.toLowerCase()));
const sharesItems = (a: Invoice, b: Invoice) => { const kb = itemKeys(b); for (const k of itemKeys(a)) if (kb.has(k)) return true; return false; };

export function detectSplitting(inv: Invoice, history: Invoice[], cfg: RiskConfig): DetectorOutcome {
  const limit = cfg.approvalThreshold;
  const floor = limit * cfg.nearThresholdShare;
  const near = (i: Invoice) => i.total >= floor && i.total <= limit;
  const title = "Threshold splitting";
  if (!near(inv)) return { detector: "splitting", title, flag: false, score: 0, signals: [], summary: `This invoice (₹${fmtInr(inv.total)}) is not within ${Math.round((1 - cfg.nearThresholdShare) * 100)}% under the ₹${fmtInr(limit, 0)} approval threshold, so splitting is not in question.` };
  // Related near-threshold invoices from the same supplier inside the window, not copies of this one (copies are the duplicate detector's job).
  const cands = history.filter((o) => o.id !== inv.id && o.vendorId === inv.vendorId && near(o) && dayGap(o.invoiceDate, inv.invoiceDate) <= cfg.splitWindowDays && fingerprintScore(inv, o).score < cfg.duplicateFlagScore);
  // Two invoices on ONE PO are enough to ask. Linking only by similar items on different POs is weaker (regular repeat orders look like that), so it needs three.
  const poGroup = [inv, ...cands.filter((o) => !!inv.poId && o.poId === inv.poId)];
  const itemGroup = [inv, ...cands.filter((o) => (!inv.poId || o.poId !== inv.poId) && sharesItems(o, inv)), ...cands.filter((o) => !!inv.poId && o.poId === inv.poId)];
  const group = poGroup.length >= cfg.splitMinInvoices ? poGroup : itemGroup.length >= cfg.splitMinInvoices + 1 ? itemGroup : [inv];
  const combined = group.reduce((a, g) => a + g.total, 0);
  if (group.length < cfg.splitMinInvoices || combined <= limit) {
    return { detector: "splitting", title, flag: false, score: 0, signals: [], summary: `₹${fmtInr(inv.total)} is just under the threshold, but no related set of invoices from this supplier within ${cfg.splitWindowDays} days adds up to more than it, so it stands alone.` };
  }
  const samePo = group.every((g) => g.poId && g.poId === inv.poId);
  const dates = group.map((g) => g.invoiceDate).sort();
  const spanDays = dayGap(dates[0], dates[dates.length - 1]);
  // Score: how many pieces, how close to the line, one PO, how tightly in time.
  const closeness = group.reduce((a, g) => a + (g.total - floor) / (limit - floor), 0) / group.length; // 0..1
  const score = 30 + Math.min(group.length - 2, 3) * 8 + closeness * 20 + (samePo ? 20 : 8) + (spanDays <= 1 ? 16 : spanDays <= 3 ? 10 : 4);
  const signal: RiskSignal = makeSignal({
    detector: "splitting", kind: "threshold_splitting", flag: true, severity: "review", score, department: "Finance",
    reasons: [
      `${group.length} invoices from this supplier within ${Math.max(1, Math.round(spanDays))} day(s) of each other are each under the ₹${fmtInr(limit, 0)} approval threshold (₹${fmtInr(Math.min(...group.map((g) => g.total)))} to ₹${fmtInr(Math.max(...group.map((g) => g.total)))}).`,
      `Combined total ₹${fmtInr(combined)}, which is above the threshold. Approved separately, they would not need the higher approval level.`,
      samePo ? `All ${group.length} are on PO ${inv.poId}.` : "They are linked by the same items or description rather than one PO.",
    ],
    supportingRecords: group.map((g) => ({ source: "Finance", ref: `invoice ${g.id}`, text: `${g.id}: ₹${fmtInr(g.total)}, dated ${g.invoiceDate}${g.poId ? `, PO ${g.poId}` : ""}` })),
    recommendedAction: `Check whether these invoices are one staged delivery. If so, approve them together at the approval level for ₹${fmtInr(combined)}. If they are separate purchases, note why.`,
  });
  return { detector: "splitting", title, flag: true, score: signal.score, signals: [signal], summary: `${group.length} related invoices, combined ₹${fmtInr(combined)} against a ₹${fmtInr(limit, 0)} threshold.` };
}
