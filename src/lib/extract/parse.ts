// Rule-based invoice parser. Input: positioned text items. Output: fields with confidence and bounding boxes.
// Pure and deterministic; no AI. Used for PDF text layers and for OCR words alike.
import type {
  BBox, Check, Confidence, ExtractedInvoice, ExtractedLine, Field, PageSize, TextItem,
} from "./types";

export interface ParseOptions {
  /** Known vendors, used to confirm the vendor name and GSTIN. */
  vendors?: { id: string; name: string; gstin: string }[];
  /** The buying plant's GSTIN, which must not be mistaken for the supplier's. */
  buyerGstin?: string;
  /** Items closer than this many text heights are joined into one token. */
  mergeGap?: number;
  /** Highest confidence allowed (OCR results never reach "high"). */
  cap?: Confidence;
}

interface Tok { text: string; x: number; y: number; w: number; h: number; base: number; page: number; row: number }

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const capConf = (c: Confidence, cap: Confidence): Confidence => (RANK[c] > RANK[cap] ? cap : c);
const none = <T,>(): Field<T> => ({ value: null, confidence: "low" });

// ------------------------------------------------------------------ tokens and rows
function tokenise(items: TextItem[], mergeGap: number): Tok[] {
  const clean = items.filter((i) => i.str.trim().length > 0);
  // group into rows by baseline
  const sorted = [...clean].sort((a, b) => a.page - b.page || a.base - b.base || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref.page === it.page && Math.abs(ref.base - it.base) <= 0.45 * Math.min(ref.h, it.h)) row.push(it);
    else rows.push([it]);
  }
  const toks: Tok[] = [];
  rows.forEach((row, ri) => {
    row.sort((a, b) => a.x - b.x);
    let cur: Tok | undefined;
    for (const it of row) {
      if (cur && it.x - (cur.x + cur.w) < mergeGap * Math.max(cur.h, it.h)) {
        const gap = it.x - (cur.x + cur.w);
        const needSpace = !cur.text.endsWith(" ") && !it.str.startsWith(" ") && gap > 0.12 * cur.h;
        cur.text += (needSpace ? " " : "") + it.str;
        const right = Math.max(cur.x + cur.w, it.x + it.w);
        const top = Math.min(cur.y, it.y);
        const bottom = Math.max(cur.y + cur.h, it.y + it.h);
        cur.w = right - cur.x; cur.y = top; cur.h = bottom - top;
      } else {
        if (cur) toks.push(cur);
        cur = { text: it.str, x: it.x, y: it.y, w: it.w, h: it.h, base: it.base, page: it.page, row: ri };
      }
    }
    if (cur) toks.push(cur);
  });
  for (const t of toks) t.text = t.text.replace(/\s+/g, " ").trim();
  return toks.filter((t) => t.text.length > 0);
}

function bbox(t: Tok, pages: PageSize[], from = 0, to = t.text.length): BBox {
  const p = pages[t.page] ?? pages[0];
  const len = Math.max(1, t.text.length);
  const x = t.x + (t.w * from) / len;
  const w = (t.w * (to - from)) / len;
  const pad = t.h * 0.12;
  return { page: t.page, x: Math.max(0, (x - 1) / p.w), y: Math.max(0, (t.y - pad) / p.h), w: Math.min(1, (w + 2) / p.w), h: Math.min(1, (t.h + 2 * pad) / p.h) };
}

function union(boxes: BBox[]): BBox | undefined {
  if (!boxes.length) return undefined;
  const page = boxes[0].page;
  const bs = boxes.filter((b) => b.page === page);
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w));
  const bt = Math.max(...bs.map((b) => b.y + b.h));
  return { page, x, y, w: r - x, h: bt - y };
}

// ------------------------------------------------------------------ value parsers
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDate(s: string): string | null {
  const t = s.trim();
  let m: RegExpMatchArray | null;
  const iso = (y: number, mo: number, d: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return iso(+m[3], +m[2], +m[1]);
  if ((m = t.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-,]+(\d{4})$/))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return mo ? iso(+m[3], mo, +m[1]) : null;
  }
  return null;
}

export function parseNumber(s: string): number | null {
  const t = s.replace(/(?:Rs\.?|INR|₹)/gi, "").replace(/[,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g;
const validInvoiceNo = (s: string) => (/^[A-Z0-9][A-Z0-9\/\-]{2,24}$/i.test(s) && /\d/.test(s) ? s : null);
const validPo = (s: string) => (/^\d{8,12}$/.test(s) ? s : null);

// ------------------------------------------------------------------ labelled values
const LABELS = {
  invoiceNumber: String.raw`tax invoice (?:number|no|#)\.?|invoice (?:number|no|#)\.?|bill (?:number|no)\.?|inv\.? ?(?:no|#)\.?`,
  invoiceDate: String.raw`invoice date|bill date|inv\.? ?(?:date|dt)\.?|invoice dt\.?|dated|date`,
  poNumber: String.raw`po ref(?:erence)?|po (?:number|no)\.?|buyer po(?: no\.?)?|purchase order(?: (?:number|no)\.?)?|order (?:number|no)\.?|your order(?: no\.?)?`,
};

interface Hit<T> { value: T; raw: string; box: BBox; confidence: Confidence }

function findLabelled<T>(toks: Tok[], pages: PageSize[], labelSrc: string, validate: (s: string) => T | null): Hit<T> | null {
  const re = new RegExp(String.raw`^(?:${labelSrc})(?=[\s:#.\-]|$)[\s:#.\-]*(.*)$`, "i");
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const m = t.text.match(re);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest) {
      const v = validate(rest);
      if (v !== null) {
        const start = t.text.lastIndexOf(rest);
        return { value: v, raw: rest, box: bbox(t, pages, start, start + rest.length), confidence: "high" };
      }
    }
    // value in the next token(s) on the same row
    for (let j = i + 1; j < toks.length && toks[j].row === t.row; j++) {
      const v = validate(toks[j].text);
      if (v !== null) return { value: v, raw: toks[j].text, box: bbox(toks[j], pages), confidence: "high" };
      break;
    }
    // value stacked below the label
    const below = toks.filter((u) => u.page === t.page && u.row > t.row && u.row <= t.row + 2 && u.x < t.x + t.w + 40 && u.x + u.w > t.x - 8);
    for (const u of below) {
      const v = validate(u.text);
      if (v !== null) return { value: v, raw: u.text, box: bbox(u, pages), confidence: "medium" };
    }
  }
  return null;
}

function scanPattern<T>(toks: Tok[], pages: PageSize[], re: RegExp, validate: (s: string) => T | null): Hit<T> | null {
  for (const t of toks) {
    const m = t.text.match(re);
    if (!m) continue;
    const v = validate(m[0]);
    if (v !== null) return { value: v, raw: m[0], box: bbox(t, pages, m.index ?? 0, (m.index ?? 0) + m[0].length), confidence: "medium" };
  }
  return null;
}

function toField<T>(hit: Hit<T> | null): Field<T> {
  return hit ? { value: hit.value, confidence: hit.confidence, bbox: hit.box, raw: hit.raw } : none<T>();
}

// ------------------------------------------------------------------ totals
type AmountKind = "subtotal" | "total" | "tax";
const norm = (s: string) => s.replace(/\(.*?\)/g, "").replace(/[:.\s]+$/g, "").replace(/\s+/g, " ").trim();
const SUBTOTAL_RE = /^(?:sub ?-?total|taxable (?:value|amount)|total taxable(?: value)?|total before tax|net amount)$/i;
const TOTAL_RE = /^(?:grand total|total (?:amount|payable|invoice value|invoice amount)|invoice total|amount payable|net payable|total payable|total)$/i;
const TAX_RE = /^(?:[CSIU]?GST)\s*(?:@|:|-)?\s*(\d+(?:\.\d+)?)\s*%/i;

function labelKind(text: string): { kind: AmountKind; rate?: number; tail?: string } | null {
  const trailing = text.match(/^(.*?)(?:\s*[:\-]?\s*)((?:Rs\.?|INR|₹)?\s*[\d,]+(?:\.\d+)?)$/i);
  const candidates = trailing && /[A-Za-z%]/.test(trailing[1]) ? [{ label: trailing[1], tail: trailing[2] }, { label: text, tail: undefined }] : [{ label: text, tail: undefined }];
  for (const c of candidates) {
    const label = norm(c.label);
    if (SUBTOTAL_RE.test(label)) return { kind: "subtotal", tail: c.tail };
    if (TOTAL_RE.test(label)) return { kind: "total", tail: c.tail };
    const tm = c.label.trim().match(TAX_RE);
    if (tm) return { kind: "tax", rate: Number(tm[1]), tail: c.tail };
  }
  return null;
}

interface AmountHit { value: number; box: BBox; labelBox: BBox; rate?: number }

function collectAmounts(toks: Tok[], pages: PageSize[]): Record<AmountKind, AmountHit[]> {
  const out: Record<AmountKind, AmountHit[]> = { subtotal: [], total: [], tax: [] };
  toks.forEach((t, i) => {
    const k = labelKind(t.text);
    if (!k) return;
    let num: number | null = null;
    let box: BBox | undefined;
    if (k.tail) {
      num = parseNumber(k.tail);
      box = bbox(t, pages, t.text.length - k.tail.length);
    } else {
      for (let j = i + 1; j < toks.length && toks[j].row === t.row; j++) {
        num = parseNumber(toks[j].text);
        if (num !== null) { box = bbox(toks[j], pages); break; }
      }
    }
    if (num !== null && box) out[k.kind].push({ value: num, box, labelBox: bbox(t, pages), rate: k.rate });
  });
  return out;
}

// ------------------------------------------------------------------ line table
type ColKind = "sr" | "code" | "desc" | "hsn" | "qty" | "unit" | "rate" | "taxpct" | "amount";
const HEADERS: [ColKind, RegExp][] = [
  ["sr", /^(?:sr\.?|s\.? ?no\.?|sl\.?(?: no\.?)?|#)$/i],
  ["code", /^(?:item ?code|code|material(?: code)?|part no\.?)$/i],
  ["desc", /^(?:description(?: of goods)?|item(?: description)?|particulars|material description)$/i],
  ["hsn", /^(?:hsn(?:\/sac)?(?: code)?|sac)$/i],
  ["qty", /^(?:qty\.?|quantity)$/i],
  ["unit", /^(?:unit|uom|u\/m)$/i],
  ["rate", /^(?:rate|unit price|price|unit rate|rate\/unit)$/i],
  ["taxpct", /^(?:gst ?%|tax ?%|gst rate)$/i],
  ["amount", /^(?:amount|line total|value|total)$/i],
];
const headerKind = (text: string): ColKind | null => {
  const t = norm(text);
  return HEADERS.find(([, re]) => re.test(t))?.[0] ?? null;
};

interface RawLine { cells: Partial<Record<ColKind, Tok>>; ordered: boolean }

function findTable(toks: Tok[]): { cols: { kind: ColKind; tok: Tok }[]; rows: RawLine[] } | null {
  const byRow = new Map<number, Tok[]>();
  toks.forEach((t) => byRow.set(t.row, [...(byRow.get(t.row) ?? []), t]));
  for (const [rowIdx, rowToks] of byRow) {
    const cols = rowToks.map((t) => ({ kind: headerKind(t.text), tok: t })).filter((c): c is { kind: ColKind; tok: Tok } => c.kind !== null);
    const kinds = new Set(cols.map((c) => c.kind));
    if (cols.length < 4 || !kinds.has("desc") || !kinds.has("qty") || !kinds.has("amount")) continue;
    const rows: RawLine[] = [];
    const rowNums = [...byRow.keys()].filter((r) => r > rowIdx).sort((a, b) => a - b);
    for (const r of rowNums) {
      const cells = byRow.get(r)!;
      if (cells[0].page !== cols[0].tok.page) break;
      if (cells.some((c) => labelKind(c.text)) || /^(?:amount in words|bank|terms|declaration|e\.? ?& ?o\.?e)/i.test(cells[0].text)) break;
      const mapped: Partial<Record<ColKind, Tok>> = {};
      let ordered = false;
      if (cells.length === cols.length) {
        cols.forEach((c, i) => (mapped[c.kind] = cells[i]));
        ordered = true;
      } else {
        // nearest column by horizontal centre
        for (const cell of cells) {
          const cx = cell.x + cell.w / 2;
          let best = cols[0], bd = Infinity;
          for (const c of cols) {
            const d = Math.min(Math.abs(cx - (c.tok.x + c.tok.w / 2)), Math.abs(cell.x - c.tok.x), Math.abs(cell.x + cell.w - (c.tok.x + c.tok.w)));
            if (d < bd) { bd = d; best = c; }
          }
          mapped[best.kind] = mapped[best.kind] ?? cell;
        }
      }
      rows.push({ cells: mapped, ordered });
    }
    return { cols, rows };
  }
  return null;
}

// ------------------------------------------------------------------ main
const near = (a: number, b: number, tol = 0.51) => Math.abs(a - b) <= tol;

export function parseInvoice(
  items: TextItem[],
  pages: PageSize[],
  meta: { kind: "pdf" | "image"; fileName: string },
  opts: ParseOptions = {},
): ExtractedInvoice {
  const toks = tokenise(items, opts.mergeGap ?? 0.3);
  const buyer = opts.buyerGstin ?? "";
  const vendors = opts.vendors ?? [];
  const cap = opts.cap ?? "high";
  const C = (c: Confidence) => capConf(c, cap);

  // --- GSTIN (supplier's, never the plant's)
  let gstin: Hit<string> | null = null;
  for (const t of toks) {
    for (const m of t.text.matchAll(GSTIN_RE)) {
      if (m[0] === buyer) continue;
      const prefix = t.text.slice(0, m.index).toLowerCase();
      const labelled = /gstin|gst no|gst reg/.test(prefix) || /gstin|gst no/.test(toks[toks.indexOf(t) - 1]?.text.toLowerCase() ?? "");
      gstin = { value: m[0], raw: m[0], box: bbox(t, pages, m.index!, m.index! + m[0].length), confidence: labelled ? "high" : "medium" };
      break;
    }
    if (gstin) break;
  }
  const vendorByGstin = gstin ? vendors.find((v) => v.gstin === gstin!.value) : undefined;

  // --- vendor name: confirmed against the vendor master, else the largest text at the top of page 1
  let vendorName: Field<string> = none<string>();
  const canon = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const nameMatch = toks.find((t) => {
    const c = canon(t.text);
    return vendors.some((v) => c === canon(v.name) || c.startsWith(canon(v.name) + " "));
  });
  if (nameMatch) {
    const v = vendors.find((x) => canon(nameMatch.text).startsWith(canon(x.name)))!;
    vendorName = { value: v.name, confidence: C(vendorByGstin && vendorByGstin.id !== v.id ? "medium" : "high"), bbox: bbox(nameMatch, pages), raw: nameMatch.text };
  } else {
    const p0 = pages[0];
    const top = toks.filter((t) => t.page === 0 && t.y < p0.h * 0.25 && !/invoice|bill|gstin|original|duplicate|copy|tax\b/i.test(t.text));
    const big = top.sort((a, b) => b.h - a.h)[0];
    if (big) vendorName = { value: big.text, confidence: C("medium"), bbox: bbox(big, pages), raw: big.text };
  }
  const vendorGstin: Field<string> = gstin
    ? { value: gstin.value, confidence: C(vendorByGstin ? "high" : gstin.confidence), bbox: gstin.box, raw: gstin.raw }
    : none<string>();

  // --- header fields
  const invHit = findLabelled(toks, pages, LABELS.invoiceNumber, validInvoiceNo) ?? scanPattern(toks, pages, /\bINV[-\/]?[A-Z0-9]{3,}\b/i, validInvoiceNo);
  const dateHit = findLabelled(toks, pages, LABELS.invoiceDate, parseDate);
  const poHit = findLabelled(toks, pages, LABELS.poNumber, validPo) ?? scanPattern(toks, pages, /\b45\d{8}\b/, validPo);
  const invoiceNumber = toField(invHit);
  const invoiceDate = toField(dateHit);
  const poNumber = toField(poHit);
  for (const f of [invoiceNumber, invoiceDate, poNumber]) f.confidence = C(f.confidence);

  // --- totals and tax
  const amounts = collectAmounts(toks, pages);
  const subtotal: Field<number> = amounts.subtotal.length
    ? { value: amounts.subtotal[0].value, confidence: C("high"), bbox: amounts.subtotal[0].box }
    : none<number>();
  const total: Field<number> = amounts.total.length
    ? { value: amounts.total[amounts.total.length - 1].value, confidence: C("high"), bbox: amounts.total[amounts.total.length - 1].box }
    : none<number>();
  const taxHits = amounts.tax;
  const taxRatePct: Field<number> = taxHits.length
    ? { value: round(taxHits.reduce((s, h) => s + (h.rate ?? 0), 0)), confidence: C("high"), bbox: union(taxHits.map((h) => h.labelBox)) }
    : none<number>();
  const taxAmount: Field<number> = taxHits.length
    ? { value: round(taxHits.reduce((s, h) => s + h.value, 0)), confidence: C("high"), bbox: union(taxHits.map((h) => h.box)) }
    : none<number>();

  // --- line items
  const lines: ExtractedLine[] = [];
  const table = findTable(toks);
  if (table) {
    let n = 0;
    for (const r of table.rows) {
      const qty = r.cells.qty ? parseNumber(r.cells.qty.text) : null;
      const amount = r.cells.amount ? parseNumber(r.cells.amount.text) : null;
      if (qty === null && amount === null) continue;
      n++;
      const base: Confidence = C(r.ordered ? "high" : "medium");
      const text = (k: ColKind): Field<string> => (r.cells[k] ? { value: r.cells[k]!.text, confidence: base, bbox: bbox(r.cells[k]!, pages), raw: r.cells[k]!.text } : none<string>());
      const num = (k: ColKind): Field<number> => {
        const c = r.cells[k];
        if (!c) return none<number>();
        const v = parseNumber(c.text);
        return v === null ? { value: null, confidence: "low", bbox: bbox(c, pages), raw: c.text } : { value: v, confidence: base, bbox: bbox(c, pages), raw: c.text };
      };
      lines.push({ lineNo: n, itemCode: text("code"), description: text("desc"), qty: num("qty"), unit: text("unit"), unitPrice: num("rate"), amount: num("amount") });
    }
  }

  // --- sanity checks; failures lower confidence and are shown
  const checks: Check[] = [];
  const lower = (f: Field<unknown>, to: Confidence) => { if (RANK[to] < RANK[f.confidence]) f.confidence = to; };

  lines.forEach((l) => {
    if (l.qty.value !== null && l.unitPrice.value !== null && l.amount.value !== null) {
      const ok = near(l.qty.value * l.unitPrice.value, l.amount.value);
      checks.push({ id: `line-${l.lineNo}`, label: `Line ${l.lineNo}: quantity x rate = amount`, ok, detail: ok ? "Matches." : `${l.qty.value} x ${l.unitPrice.value} = ${round(l.qty.value * l.unitPrice.value)}, document shows ${l.amount.value}.` });
      if (!ok) { lower(l.amount, "low"); lower(l.qty, "medium"); lower(l.unitPrice, "medium"); }
    } else {
      checks.push({ id: `line-${l.lineNo}`, label: `Line ${l.lineNo}: quantity x rate = amount`, ok: false, detail: "A number is missing or unreadable." });
      for (const f of [l.qty, l.unitPrice, l.amount]) if (f.value === null) f.confidence = "low"; else lower(f, "medium");
    }
  });

  if (lines.length && subtotal.value !== null && lines.every((l) => l.amount.value !== null)) {
    const sum = round(lines.reduce((s, l) => s + (l.amount.value ?? 0), 0));
    const ok = near(sum, subtotal.value, 1);
    checks.push({ id: "sum", label: "Line amounts add up to the subtotal", ok, detail: ok ? "Matches." : `Lines add up to ${sum}, subtotal shows ${subtotal.value}.` });
    if (!ok) { lower(subtotal, "low"); lines.forEach((l) => lower(l.amount, "medium")); }
  } else {
    checks.push({ id: "sum", label: "Line amounts add up to the subtotal", ok: false, detail: lines.length ? "Subtotal not found." : "No line items found." });
    if (!lines.length) { /* nothing to lower */ } else lower(subtotal, "low");
  }
  if (subtotal.value !== null && taxRatePct.value !== null && taxAmount.value !== null) {
    const exp = (subtotal.value * taxRatePct.value) / 100;
    const ok = near(exp, taxAmount.value, 1);
    checks.push({ id: "tax", label: "Tax rate x subtotal = tax", ok, detail: ok ? "Matches." : `${taxRatePct.value}% of ${subtotal.value} is ${round(exp)}, document shows ${taxAmount.value}.` });
    if (!ok) { lower(taxAmount, "low"); lower(taxRatePct, "medium"); }
  } else {
    checks.push({ id: "tax", label: "Tax rate x subtotal = tax", ok: false, detail: "Tax block not found." });
    lower(taxAmount, "low");
  }
  if (subtotal.value !== null && taxAmount.value !== null && total.value !== null) {
    const ok = near(subtotal.value + taxAmount.value, total.value, 1);
    checks.push({ id: "total", label: "Subtotal + tax = total", ok, detail: ok ? "Matches." : `${subtotal.value} + ${taxAmount.value} = ${round(subtotal.value + taxAmount.value)}, total shows ${total.value}.` });
    if (!ok) lower(total, "low");
  } else {
    checks.push({ id: "total", label: "Subtotal + tax = total", ok: false, detail: "Total not found." });
    lower(total, "low");
  }

  return {
    kind: meta.kind, fileName: meta.fileName, pages,
    vendorName, vendorGstin, invoiceNumber, invoiceDate, poNumber, lines, subtotal, taxRatePct, taxAmount, total, checks, notes: [],
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Every field in an extraction, flattened, for confidence counts and tests. */
export function allFields(x: ExtractedInvoice): Field<unknown>[] {
  const head = [x.vendorName, x.vendorGstin, x.invoiceNumber, x.invoiceDate, x.poNumber, x.subtotal, x.taxRatePct, x.taxAmount, x.total];
  const lines = x.lines.flatMap((l) => [l.itemCode, l.description, l.qty, l.unit, l.unitPrice, l.amount]);
  return [...head, ...lines] as Field<unknown>[];
}
