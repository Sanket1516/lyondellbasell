// Detector 1: multi-signal duplicate fingerprint.
// Compares one invoice with the same supplier's earlier invoices on eight signals, each with a fixed weight (config.ts).
// A high score is a prompt to compare the two documents, not a finding that anyone did anything wrong.
import type { Invoice, PurchaseOrder } from "../../lib/types";
import { fmtInr } from "../../lib/format";
import { DUPLICATE_WEIGHTS as W, type RiskConfig } from "./config";
import { makeSignal, type DetectorOutcome, type RiskSignal } from "./types";

const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digitsOf = (s: string) => s.replace(/\D/g, "");
// Suffixes people add when they re-issue a bill: INV-1001A, INV-1001/R, INV-1001-DUP, INV-1001 COPY.
const SUFFIX = /(?:[-/ ]?(?:R|A|B|C|DUP|COPY|REV|REISSUE|RE))$/;

/** 1 when the numbers are the same, 0.95 for the same number plus a re-issue suffix or punctuation, else 0. Sequential numbers (INV-1001 / INV-1002) score 0 on purpose. */
export function invoiceNumberSimilarity(a: string, b: string): number {
  const x = a.toUpperCase().trim(), y = b.toUpperCase().trim();
  if (x === y) return 1;
  if (norm(x) === norm(y)) return 0.95;
  const core = (s: string) => norm(s.replace(SUFFIX, ""));
  if (core(x) === core(y) && core(x).length >= 3) return 0.95;
  // Same digits, different prefix wording ("1001" vs "INV-1001").
  const dx = digitsOf(x), dy = digitsOf(y);
  if (dx.length >= 4 && dx === dy) return 0.8;
  return 0;
}

const tokens = (inv: Invoice) => new Set(inv.lines.flatMap((l) => l.description.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)));
export function textSimilarity(a: Invoice, b: Invoice): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Per matched item (same code): min/max of the quantities, averaged over the longer invoice. */
export function lineOverlap(a: Invoice, b: Invoice): { items: number; qtyEqual: boolean } {
  const key = (l: Invoice["lines"][number]) => l.itemCode ?? l.description.toLowerCase();
  const bm = new Map(b.lines.map((l) => [key(l), l.qty]));
  let credit = 0;
  let allEqual = a.lines.length === b.lines.length && a.lines.length > 0;
  for (const l of a.lines) {
    const q = bm.get(key(l));
    if (q === undefined) { allEqual = false; continue; }
    credit += Math.min(l.qty, q) / Math.max(l.qty, q, 1e-9);
    if (Math.abs(l.qty - q) > 1e-9) allEqual = false;
  }
  return { items: credit / Math.max(a.lines.length, b.lines.length, 1), qtyEqual: allEqual };
}

export interface DuplicateMatch { other: Invoice; score: number; parts: { signal: string; points: number; text: string }[] }

/** True when the PO is big enough for both invoices on every line: two bills on one PO that add up to no more than the order are normal staged billing. */
export function poCoversBoth(inv: Invoice, other: Invoice, po?: PurchaseOrder): boolean {
  if (!po || !inv.poId || inv.poId !== other.poId) return false;
  return inv.lines.every((l) => {
    const pl = po.lines.find((p) => (l.itemCode ? p.itemCode === l.itemCode : p.description.toLowerCase() === l.description.toLowerCase()));
    const ol = other.lines.find((x) => (l.itemCode ? x.itemCode === l.itemCode : x.description.toLowerCase() === l.description.toLowerCase()));
    return !!pl && !!ol && pl.uom === l.uom && l.uom === ol.uom && l.qty + ol.qty <= pl.qty * 1.01 + 1e-9;
  });
}

export function fingerprintScore(inv: Invoice, other: Invoice, po?: PurchaseOrder): DuplicateMatch {
  const parts: DuplicateMatch["parts"] = [];
  const add = (signal: keyof typeof W, factor: number, text: string) => { if (factor > 0) parts.push({ signal, points: factor * W[signal], text }); };
  const amtGap = Math.abs(inv.total - other.total);
  if (amtGap < 1) add("amount", 1, `same total ₹${fmtInr(inv.total)}`);
  else if (amtGap / Math.max(inv.total, other.total, 1) <= 0.01) add("amount", 0.5, `totals within 1% (₹${fmtInr(inv.total)} and ₹${fmtInr(other.total)})`);
  if (inv.poId && inv.poId === other.poId) add("poNumber", 1, `same PO ${inv.poId}`);
  const lo = lineOverlap(inv, other);
  if (lo.items > 0) add("lineItems", lo.items, `${Math.round(lo.items * 100)}% of line items and quantities overlap`);
  if (lo.qtyEqual) add("quantities", 1, "identical quantities on every line");
  if (inv.tax > 0 && Math.abs(inv.tax - other.tax) < 1) add("tax", 1, `same tax ₹${fmtInr(inv.tax)}`);
  const gap = dayGap(inv.invoiceDate, other.invoiceDate);
  if (gap <= 7) add("date", 1, gap === 0 ? "same invoice date" : `invoice dates ${Math.round(gap)} day(s) apart`);
  else if (gap <= 30) add("date", 0.5, `invoice dates ${Math.round(gap)} days apart`);
  const ns = invoiceNumberSimilarity(inv.id, other.id);
  if (ns > 0) add("invoiceNumber", ns, ns >= 0.95 ? `invoice numbers ${inv.id} and ${other.id} differ only by a re-issue marker` : `invoice numbers ${inv.id} and ${other.id} share the same digits`);
  const ts = textSimilarity(inv, other);
  if (ts >= 0.5) add("textSimilarity", ts, `${Math.round(ts * 100)}% of the description wording is the same`);
  // Staged billing: the PO holds enough for both invoices, so a second similar bill is expected. Lowers the score (and says so).
  if (poCoversBoth(inv, other, po)) parts.push({ signal: "stagedDelivery", points: -45, text: "the PO quantity covers both invoices, which is consistent with staged billing" });
  return { other, score: Math.max(0, parts.reduce((a, p) => a + p.points, 0)), parts };
}

/** "Earlier" means received before this one (ties broken by invoice date, then number), so only the later document of a pair is flagged. */
const earlier = (o: Invoice, inv: Invoice) => (o.receivedOn !== inv.receivedOn ? o.receivedOn < inv.receivedOn : o.invoiceDate !== inv.invoiceDate ? o.invoiceDate < inv.invoiceDate : o.id < inv.id);

export function detectDuplicate(inv: Invoice, history: Invoice[], cfg: RiskConfig, po?: PurchaseOrder): DetectorOutcome {
  const matches = history.filter((o) => o.id !== inv.id && earlier(o, inv)).map((o) => fingerprintScore(inv, o, po)).sort((a, b) => b.score - a.score);
  const best = matches[0];
  const signals: RiskSignal[] = [];
  // Needs the total to agree, or the lines to agree almost completely: a similar-looking date or tax alone is not enough.
  // A sound match also needs a document link: the same PO or a near-identical invoice number. Same amount and lines on a different PO with an unrelated number is a normal repeat order.
  const linked = (m: DuplicateMatch) => m.parts.some((p) => p.signal === "poNumber" || (p.signal === "invoiceNumber" && p.points >= 0.95 * W.invoiceNumber));
  const strong = !!best && best.score >= cfg.duplicateFlagScore && linked(best) && (best.parts.some((p) => p.signal === "amount") || (best.parts.find((p) => p.signal === "lineItems")?.points ?? 0) >= 0.8 * W.lineItems);
  if (best && strong) {
    const top = matches.filter((m) => m.score >= cfg.duplicateFlagScore && linked(m)).slice(0, 3);
    signals.push(makeSignal({
      detector: "duplicate", kind: "duplicate_fingerprint", flag: true, severity: "review", score: best.score, department: "Finance",
      reasons: best.parts.map((p) => `${p.text} (+${Math.round(p.points)})`),
      supportingRecords: top.map((m) => ({ source: "Finance", ref: `invoice ${m.other.id}`, text: `${m.other.id}: ₹${fmtInr(m.other.total)}, dated ${m.other.invoiceDate}${m.other.poId ? `, PO ${m.other.poId}` : ""}, ${m.other.status}; similarity ${Math.round(m.score)} of 100` })),
      recommendedAction: `Compare this invoice with ${best.other.id} side by side. If it is a second bill for the same delivery, reject it; if it is a genuine separate bill, record the reason so the decision is on file.`,
    }));
  }
  return {
    detector: "duplicate", title: "Duplicate fingerprint", flag: signals.length > 0, score: signals[0]?.score ?? Math.round(best?.score ?? 0), signals,
    summary: signals.length ? `Closest earlier invoice: ${best!.other.id}, similarity ${Math.round(best!.score)} of 100.` : best ? `No earlier invoice from this supplier is close enough (highest similarity ${Math.round(best.score)} of 100; flagged from ${cfg.duplicateFlagScore}).` : "No earlier invoices from this supplier to compare with.",
  };
}
