// Procedural canvas textures: documents, chips, labels and hash blocks are drawn with the self-hosted fonts.
// No image files and no downloaded models. Row positions are exported so highlight meshes line up with what is drawn.
import { CanvasTexture, SRGBColorSpace, LinearFilter } from "three";
import { S, rs, inr, day } from "../content";

export const C = {
  ink: "#e8edf5", soft: "#8d99ab", faint: "#5b6678", line: "rgba(140,160,190,0.22)",
  accent: "#3d8bff", accentHi: "#7fb3ff", ok: "#3fb950", warn: "#e3a72f", bad: "#f85149",
  band: { inv: "#e3a72f", po: "#3d8bff", grn: "#3fb950" },
};
const SANS = '"Inter Variable", "Segoe UI", system-ui, sans-serif';
const DISP = '"Archivo Variable", "Inter Variable", "Segoe UI", sans-serif';
const MONO = '"Spline Sans Mono", Consolas, ui-monospace, monospace';

type Ctx = CanvasRenderingContext2D;
function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return [cv, cv.getContext("2d")!];
}
function tex(cv: HTMLCanvasElement) {
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}
function font(ctx: Ctx, weight: number, px: number, family: string, stretch?: string) {
  ctx.font = `${weight} ${px}px ${family}`;
  const c = ctx as Ctx & { fontStretch?: string };
  if ("fontStretch" in c) (c as { fontStretch: string }).fontStretch = stretch ?? "normal";
}
function text(ctx: Ctx, s: string, x: number, y: number, o: { w?: number; px?: number; f?: string; color?: string; align?: CanvasTextAlign; stretch?: string; ls?: number } = {}) {
  font(ctx, o.w ?? 500, o.px ?? 28, o.f ?? SANS, o.stretch);
  ctx.fillStyle = o.color ?? C.ink;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  const c = ctx as Ctx & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${o.ls ?? 0}px`;
  ctx.fillText(s, x, y);
}
function rule(ctx: Ctx, x1: number, y: number, x2: number, color = C.line, w = 2) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

// ------------------------------------------------------------------ documents (800 x 1050 px, card 1.6 x 2.1 units)
export const DOC = { w: 800, h: 1050 };
/** Row centre in card units (y up, card centred at 0), from a canvas y. */
export const rowY = (py: number, cardH = 2.1) => (0.5 - py / DOC.h) * cardH;
export const colX = (px: number, cardW = 1.6) => (px / DOC.w - 0.5) * cardW;

/** Canvas y of each table row (shared by invoice, PO and GRN). */
export const ROWS = [470, 545, 620];
export const COLS = { item: 56, qty: 470, rate: 600, amount: 744 };

interface DocSpec { band: string; kind: string; number: string; party: string; meta: [string, string][]; head: [string, string, string]; rows: [string, string, string, string][]; foot?: [string, string, boolean?][] }

function drawDoc(d: DocSpec) {
  const [cv, ctx] = canvas(DOC.w, DOC.h);
  ctx.clearRect(0, 0, DOC.w, DOC.h);
  ctx.fillStyle = d.band; ctx.fillRect(0, 0, DOC.w, 16);
  text(ctx, d.kind.toUpperCase(), 56, 92, { px: 24, w: 600, color: C.soft, ls: 3 });
  text(ctx, d.number, 56, 160, { px: 60, w: 600, f: DISP, stretch: "semi-expanded" });
  text(ctx, d.party, 56, 218, { px: 30, w: 500 });
  d.meta.forEach(([k, v], i) => {
    const x = 56 + i * 250;
    text(ctx, k, x, 290, { px: 21, color: C.soft, w: 500, ls: 1 });
    text(ctx, v, x, 326, { px: 27, w: 500, f: SANS });
  });
  rule(ctx, 56, 380, DOC.w - 56);
  text(ctx, "Item", COLS.item, 420, { px: 21, color: C.soft, ls: 1 });
  text(ctx, d.head[0], COLS.qty, 420, { px: 21, color: C.soft, align: "right", ls: 1 });
  text(ctx, d.head[1], COLS.rate, 420, { px: 21, color: C.soft, align: "right", ls: 1 });
  text(ctx, d.head[2], COLS.amount, 420, { px: 21, color: C.soft, align: "right", ls: 1 });
  d.rows.forEach((r, i) => {
    const y = ROWS[i] + 10;
    text(ctx, r[0], COLS.item, y, { px: 25 });
    text(ctx, r[1], COLS.qty, y, { px: 25, align: "right" });
    text(ctx, r[2], COLS.rate, y, { px: 25, align: "right" });
    text(ctx, r[3], COLS.amount, y, { px: 25, align: "right" });
  });
  rule(ctx, 56, 690, DOC.w - 56);
  (d.foot ?? []).forEach(([k, v, strong], i) => {
    const y = 750 + i * 62;
    text(ctx, k, 56, y, { px: strong ? 28 : 24, color: strong ? C.ink : C.soft, w: strong ? 600 : 500 });
    text(ctx, v, DOC.w - 56, y, { px: strong ? 36 : 26, align: "right", w: strong ? 650 : 500, f: strong ? DISP : SANS, stretch: strong ? "semi-expanded" : undefined });
  });
  text(ctx, "Synthetic demo document · Plant X (fictional)", 56, DOC.h - 46, { px: 19, color: C.faint });
  return tex(cv);
}

const H = S.hero;
const short = (d: string) => d.replace("Process additive ", "").replace("Catalyst carrier ", "").replace("HDPE drum 200 L", "DR-200 drum");
export function invoiceTexture() {
  return drawDoc({
    band: C.band.inv, kind: "Tax invoice", number: H.id, party: H.supplier,
    meta: [["PO", H.po], ["Date", day(H.invoiceDate)], ["GSTIN", "27FICT…1Z0"]],
    head: ["Qty", "Rate", "Amount"],
    rows: H.lines.map((l) => [short(l.description), `${inr(l.qty)} ${l.uom}`, rs(l.unitPrice), rs(l.amount)]),
    foot: [["Subtotal", rs(H.subtotalInr)], [`GST ${H.taxPct}%`, rs(H.taxInr)], ["Total", rs(H.totalInr), true]],
  });
}
export function poTexture() {
  return drawDoc({
    band: C.band.po, kind: "Purchase order", number: H.po, party: "Buyer: Anand Deshpande",
    meta: [["Issued", "18-Sep-2026"], ["Supplier", "V-1001"], ["Contract", "C-22"]],
    head: ["Qty", "Rate", "Amount"],
    rows: [["AX-40", "1,000 kg", rs(398), rs(398000)], ["C-12", "5,000 kg", rs(86), rs(430000)], ["DR-200 drum", "40 nos", rs(1450), rs(58000)]],
    foot: [["Tax code", "GST 18%"], ["Status", "Open"]],
  });
}
export function grnTexture() {
  return drawDoc({
    band: C.band.grn, kind: "Goods receipt", number: "5000009001", party: "+ 5000009002 · Stores, Plant X",
    meta: [["Received", "02-Nov-2026"], ["Delivery note", "DN-5521"], ["PO", H.po]],
    head: ["Received", "Inspected", "Accepted"],
    rows: [["AX-40", "1,000 kg", "1,000", "1,000"], ["C-12", "5,000 kg", "5,000", "5,000"], ["DR-200 drum", "32 nos", "32", "32"]],
    foot: [["Quality", "0 rejected"], ["Gate entries", "GE-00039, GE-00040"]],
  });
}
export function amendmentTexture() {
  const [cv, ctx] = canvas(DOC.w, 760);
  ctx.fillStyle = C.band.po; ctx.fillRect(0, 0, DOC.w, 16);
  text(ctx, "CONTRACT AMENDMENT", 56, 92, { px: 24, w: 600, color: C.soft, ls: 3 });
  text(ctx, "C-22 · AX-40", 56, 160, { px: 58, w: 600, f: DISP, stretch: "semi-expanded" });
  text(ctx, H.supplier, 56, 216, { px: 30 });
  rule(ctx, 56, 262, DOC.w - 56);
  text(ctx, "Price per kg", 56, 320, { px: 22, color: C.soft, ls: 1 });
  text(ctx, rs(398), 56, 410, { px: 64, w: 500, f: DISP, color: C.faint, stretch: "semi-expanded" });
  ctx.strokeStyle = C.faint; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(52, 388); ctx.lineTo(236, 388); ctx.stroke();
  text(ctx, "→", 300, 405, { px: 56, color: C.soft });
  text(ctx, rs(412), 400, 410, { px: 64, w: 650, f: DISP, color: C.ok, stretch: "semi-expanded" });
  text(ctx, "Effective", 56, 500, { px: 22, color: C.soft, ls: 1 });
  text(ctx, "01-Oct-2026", 56, 540, { px: 30 });
  text(ctx, "Signed", 400, 500, { px: 22, color: C.soft, ls: 1 });
  text(ctx, "17-Sep-2026", 400, 540, { px: 30 });
  text(ctx, "POs raised earlier keep the old price until the buyer amends them.", 56, 620, { px: 22, color: C.soft });
  text(ctx, "Synthetic demo document · Plant X (fictional)", 56, 714, { px: 19, color: C.faint });
  return tex(cv);
}

// ------------------------------------------------------------------ chips, labels, pills
export function chipTexture(label: string, value: string, tone = C.accent) {
  const [cv, ctx] = canvas(560, 132);
  rrect(ctx, 4, 4, 552, 124, 26);
  ctx.fillStyle = "rgba(12,20,36,0.92)"; ctx.fill();
  ctx.strokeStyle = tone; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = tone; ctx.beginPath(); ctx.arc(46, 66, 9, 0, Math.PI * 2); ctx.fill();
  text(ctx, label.toUpperCase(), 74, 52, { px: 21, color: C.soft, w: 600, ls: 2 });
  text(ctx, value, 74, 98, { px: 32, w: 600 });
  return tex(cv);
}
/** A free-floating label: title line plus optional sub line. Aspect is returned for plane sizing. */
export function labelTexture(title: string, sub?: string, o: { color?: string; align?: CanvasTextAlign; w?: number; titlePx?: number } = {}) {
  const W = o.w ?? 640, Hh = sub ? 150 : 96;
  const [cv, ctx] = canvas(W, Hh);
  const x = o.align === "center" ? W / 2 : o.align === "right" ? W - 8 : 8;
  text(ctx, title, x, 58, { px: o.titlePx ?? 44, w: 600, f: DISP, stretch: "semi-expanded", color: o.color ?? C.ink, align: o.align });
  if (sub) text(ctx, sub, x, 118, { px: 28, color: C.soft, align: o.align });
  return { map: tex(cv), aspect: W / Hh };
}
export function pillTexture(textS: string, tone: string, sub?: string) {
  const [, m] = canvas(4, 4);
  font(m, 700, 54, DISP, "expanded");
  const tw = m.measureText(textS).width + textS.length * 2;
  font(m, 500, 28, SANS);
  const sw = sub ? m.measureText(sub).width : 0;
  const W = Math.ceil(Math.max(360, tw, sw) + 92), Hh = sub ? 200 : 132;
  const [cv, ctx] = canvas(W, Hh);
  rrect(ctx, 4, 4, W - 8, Hh - 8, 30);
  ctx.fillStyle = "rgba(10,14,24,0.94)"; ctx.fill();
  ctx.strokeStyle = tone; ctx.lineWidth = 5; ctx.stroke();
  text(ctx, textS, 44, 86, { px: 54, w: 700, f: DISP, stretch: "expanded", color: tone, ls: 2 });
  if (sub) text(ctx, sub, 44, 154, { px: 28, color: C.ink });
  return { map: tex(cv), aspect: W / Hh };
}
export function stampTexture(lines: [string, string]) {
  const [cv, ctx] = canvas(640, 260);
  ctx.translate(320, 130); ctx.rotate(-0.09); ctx.translate(-320, -130);
  rrect(ctx, 20, 20, 600, 220, 24);
  ctx.strokeStyle = C.ok; ctx.lineWidth = 10; ctx.stroke();
  text(ctx, "APPROVED", 320, 140, { px: 76, w: 750, f: DISP, stretch: "semi-expanded", color: C.ok, align: "center", ls: 3 });
  text(ctx, lines[0], 320, 196, { px: 30, w: 600, color: C.ok, align: "center" });
  text(ctx, lines[1], 320, 228, { px: 22, w: 500, color: C.ok, align: "center" });
  return tex(cv);
}
export function hashBlockTexture(seq: number, hash: string, action: string, state: "ok" | "bad") {
  const [cv, ctx] = canvas(420, 300);
  const tone = state === "bad" ? C.bad : C.accentHi;
  text(ctx, `#${seq}`, 30, 74, { px: 50, w: 650, f: DISP, stretch: "semi-expanded", color: state === "bad" ? C.bad : C.ink });
  text(ctx, action, 30, 124, { px: 26, color: C.soft });
  text(ctx, "sha256", 30, 196, { px: 20, color: C.faint, ls: 2 });
  text(ctx, hash + "…", 30, 240, { px: 34, f: MONO, color: tone });
  return tex(cv);
}
/** Intelligence panel: static text and empty tracks; the bars themselves are meshes that grow over the tracks. */
export const INTEL = { w: 1000, h: 1180, bars: [] as { y: number; x0: number; x1: number; value: number; tone: string }[] };
export function intelTexture() {
  const I = S.intelligence;
  const [cv, ctx] = canvas(INTEL.w, INTEL.h);
  INTEL.bars = [];
  const track = (y: number, value: number, tone: string, x0 = 40, x1 = 960) => {
    rrect(ctx, x0, y - 9, x1 - x0, 18, 9); ctx.fillStyle = "rgba(140,160,190,0.14)"; ctx.fill();
    INTEL.bars.push({ y, x0, x1, value, tone });
  };
  const block = (top: number, title: string, p: number, model: string, auc: number | undefined, factors: { label: string; value: string; effectPoints: number }[]) => {
    text(ctx, title, 40, top, { px: 34, w: 600 });
    text(ctx, `${Math.round(p * 100)}%`, 960, top + 4, { px: 64, w: 650, f: DISP, stretch: "semi-expanded", align: "right", color: p > 0.6 ? C.warn : C.accentHi });
    text(ctx, `${model}${auc ? ` · AUC ${auc.toFixed(2)}` : ""}`, 40, top + 40, { px: 22, color: C.soft });
    track(top + 78, p, p > 0.6 ? C.warn : C.accent);
    const max = Math.max(...factors.map((f) => Math.abs(f.effectPoints)));
    factors.slice(0, 3).forEach((f, i) => {
      const y = top + 140 + i * 66;
      text(ctx, f.label, 40, y, { px: 24, color: C.ink });
      text(ctx, `+${f.effectPoints.toFixed(1)} pts`, 960, y, { px: 22, color: C.soft, align: "right" });
      track(y + 22, Math.abs(f.effectPoints) / max, C.accent, 40, 960);
    });
  };
  block(70, "Exception risk", I.exception.p, I.exception.model, I.exception.auc, I.exception.factors);
  block(600, "Payment-delay risk", I.delay.p, I.delay.model, I.delay.auc, I.delay.factors);
  text(ctx, `Trained on ${I.exception.trainedOn}. Advises; never overrides the rules.`, 40, 1140, { px: 22, color: C.faint });
  return tex(cv);
}
export function gaugeLabelTexture() {
  const I = S.intelligence.criticality;
  const [cv, ctx] = canvas(600, 420);
  text(ctx, String(I.score), 300, 210, { px: 168, w: 650, f: DISP, stretch: "semi-expanded", align: "center" });
  text(ctx, "Supply criticality", 300, 278, { px: 32, w: 600, align: "center" });
  text(ctx, `${I.band} · ${S.hero.supplier}`, 300, 322, { px: 24, color: C.soft, align: "center" });
  text(ctx, "Sole source: AX-40, C-12", 300, 360, { px: 22, color: C.faint, align: "center" });
  return tex(cv);
}
