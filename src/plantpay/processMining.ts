// Stage 7: Process-Mining Twin. Rebuilds the path every invoice actually took from workflow_events, compares it with the
// expected path, and reports where time goes, which departments hold invoices longest, rework loops, which exception types
// cost the most time and which workflows are overly complex. Pure functions over event lists: no database, no clock.
//
// How a path is read from events (a small state machine, one "station" at a time):
//   invoice_received        -> station Intake, waiting for assignment
//   department_assigned     -> station = the department it was handed to, waiting to be picked up
//   review_started          -> station = the department of the event, working
//   review_completed        -> same station, waiting for the next handover
//   approval_requested      -> station Approval, waiting
//   approval_granted        -> station Payment, waiting
//   payment_status_changed  -> station Payment; "paid" ends the path
// Finance is called "AP review" until approval is requested. exception_* events do not move the invoice; they are paired
// by check to measure how long each exception type stays open.
import type { WorkflowEvent } from "./workflowEvents";

export const EXPECTED_PATH = ["Intake", "AP review", "Approval", "Payment"] as const;
/** Working-day targets for the expected path (an assumption, shown on the page): hours an invoice should spend at each station. */
export const EXPECTED_HOURS: Record<string, number> = { Intake: 2, "AP review": 24, Approval: 24, Payment: 48 };
/** A path with more stations than this, or this many loops, is called complex. */
export const COMPLEX_STATIONS = 6;
export const COMPLEX_LOOPS = 2;
const HOUR = 3600000;

export type Phase = "waiting" | "working";
export interface Segment { station: string; phase: Phase; from: string; to: string; hours: number; open: boolean }
export interface InvoicePath {
  invoiceId: string;
  stations: string[];            // collapsed: consecutive repeats merged
  segments: Segment[];
  completed: boolean;            // payment reached
  startedAt: string;
  endedAt: string;               // last event, or "now" for an open invoice
  cycleHours: number;
  loops: Loop[];
  exceptions: ExceptionSpan[];
  conformance: Conformance;
  deviations: string[];
}
export interface Loop { via: string; from: string; sequence: string[] }
export interface ExceptionSpan { check: string; department: string; raisedAt: string; resolvedAt?: string; hours: number; open: boolean }
export type Conformance = "conforming" | "on_track" | "rework" | "extra_steps";

const stationOf = (department: string, afterApprovalRequest: boolean): string => (department === "Finance" ? (afterApprovalRequest ? "Approval" : "AP review") : department);

/** Reconstruct one invoice's path. `now` closes the last interval for an invoice that is still open. */
export function reconstructPath(invoiceId: string, events: WorkflowEvent[], now: string): InvoicePath | undefined {
  const evs = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  if (evs.length === 0) return undefined;
  const segments: Segment[] = [];
  let station = "Intake", phase: Phase = "waiting", since = evs[0].at, completed = false, approvalRequested = false, paidAt: string | undefined;
  const close = (to: string, open = false) => { if (to > since) segments.push({ station, phase, from: since, to, hours: (Date.parse(to) - Date.parse(since)) / HOUR, open }); since = to > since ? to : since; };
  const move = (at: string, s: string, p: Phase) => { if (s === station && p === phase) return; close(at); station = s; phase = p; };
  for (const e of evs) {
    switch (e.type) {
      case "invoice_received": break;
      case "department_assigned": {
        const to = typeof e.payload.to === "string" ? e.payload.to : e.department;
        if (to === "Intake") break;
        move(e.at, stationOf(to, approvalRequested), "waiting"); break;
      }
      case "review_started": move(e.at, stationOf(e.department, approvalRequested), "working"); break;
      case "review_completed": move(e.at, stationOf(e.department, approvalRequested), "waiting"); break;
      case "approval_requested": approvalRequested = true; move(e.at, "Approval", "waiting"); break;
      case "approval_granted": move(e.at, "Payment", "waiting"); break;
      case "payment_status_changed": {
        const to = String(e.payload.to ?? "");
        if (to === "paid") { move(e.at, "Payment", "working"); paidAt = e.at; completed = true; } else move(e.at, "Payment", "working");
        break;
      }
      default: break; // exception_raised / exception_resolved do not move the invoice
    }
  }
  const last = evs[evs.length - 1].at;
  const endedAt = completed ? (paidAt ?? last) : now > last ? now : last;
  close(endedAt, !completed && endedAt > last);
  // The last segment of an open invoice is still running: mark it open even if it was closed at an event time
  if (!completed && segments.length && segments[segments.length - 1].to === endedAt) segments[segments.length - 1].open = endedAt > last;

  // Collapse into stations
  const stations: string[] = [];
  for (const sg of segments) if (stations[stations.length - 1] !== sg.station) stations.push(sg.station);
  if (stations.length === 0) stations.push("Intake");
  const loops = findLoops(stations);
  const exceptions = pairExceptions(evs, endedAt);
  const { conformance, deviations } = conform(stations, loops, completed);
  return { invoiceId, stations, segments, completed, startedAt: evs[0].at, endedAt, cycleHours: (Date.parse(endedAt) - Date.parse(evs[0].at)) / HOUR, loops, exceptions, conformance, deviations };
}

/** A loop is a station that is left and then entered again: AP review -> Procurement -> AP review. */
export function findLoops(stations: string[]): Loop[] {
  const out: Loop[] = [];
  for (let i = 0; i < stations.length; i++) {
    const j = stations.indexOf(stations[i], i + 1);
    if (j < 0) continue;
    // report each return once: only when stations[i] is the first occurrence of the repeat pair we have not yet reported
    if (stations.lastIndexOf(stations[i], j - 1) !== i) continue;
    const seq = stations.slice(i, j + 1);
    out.push({ from: stations[i], via: seq.slice(1, -1).join(" → "), sequence: seq });
  }
  return out;
}

function conform(stations: string[], loops: Loop[], completed: boolean): { conformance: Conformance; deviations: string[] } {
  const exp = EXPECTED_PATH as readonly string[];
  const deviations: string[] = [];
  for (const l of loops) deviations.push(`Rework loop: ${l.sequence.join(" → ")}`);
  const extra = [...new Set(stations.filter((s) => !exp.includes(s)))];
  if (extra.length) deviations.push(`Extra station${extra.length === 1 ? "" : "s"} outside the expected path: ${extra.join(", ")}`);
  if (completed) {
    const skipped = exp.filter((s) => !stations.includes(s));
    if (skipped.length) deviations.push(`Skipped: ${skipped.join(", ")}`);
  }
  if (loops.length) return { conformance: "rework", deviations };
  if (extra.length || (completed && deviations.length)) return { conformance: "extra_steps", deviations };
  const prefix = stations.every((s, i) => s === exp[i]);
  return { conformance: completed && prefix && stations.length === exp.length ? "conforming" : prefix ? "on_track" : "extra_steps", deviations };
}

/** Pair exception_raised with the next exception_resolved for the same check (first in, first out). Unresolved ones stay open until `now`. */
export function pairExceptions(evs: WorkflowEvent[], now: string): ExceptionSpan[] {
  const raised: { check: string; department: string; at: string; resolved?: string }[] = [];
  const dept = (e: WorkflowEvent) => { const next = evs.find((x) => x.type === "department_assigned" && x.at >= e.at && x.id > e.id); return typeof next?.payload.to === "string" ? next.payload.to : "Finance"; };
  for (const e of evs) {
    if (e.type === "exception_raised") raised.push({ check: String(e.payload.check ?? "unspecified"), department: dept(e), at: e.at });
    if (e.type === "exception_resolved") {
      const check = String(e.payload.check ?? "unspecified");
      const r = raised.find((x) => !x.resolved && x.check === check) ?? raised.find((x) => !x.resolved && x.department === e.department) ?? raised.find((x) => !x.resolved);
      if (r) r.resolved = e.at;
    }
  }
  return raised.map((r) => { const end = r.resolved ?? now; return { check: r.check, department: r.department, raisedAt: r.at, resolvedAt: r.resolved, hours: Math.max(0, (Date.parse(end) - Date.parse(r.at)) / HOUR), open: !r.resolved }; });
}

// ---------------------------------------------------------------- whole-process analysis
export interface StationStat { station: string; invoices: number; visits: number; waitHours: number; workHours: number; totalHours: number; avgHoursPerVisit: number; expectedHours?: number; sharePct: number }
export interface Variant { key: string; stations: string[]; invoices: number; sharePct: number; completed: number; avgCycleDays: number; conformance: Conformance; hasLoop: boolean; example: string }
export interface Edge { from: string; to: string; count: number; avgGapHours: number; rework: boolean }
export interface ExceptionStat { check: string; count: number; open: number; avgDays: number; totalDays: number; sharePct: number; department: string }
export interface LoopStat { sequence: string; via: string; invoices: number; occurrences: number; extraDays: number }
export interface ProcessAnalysis {
  asOf: string; invoices: number; completed: number; open: number;
  avgCycleDays: number; medianCycleDays: number;
  conformance: Record<Conformance, number>; conformingPct: number;
  stations: StationStat[]; bottlenecks: StationStat[]; edges: Edge[]; variants: Variant[];
  loops: LoopStat[]; reworkInvoices: number; reworkPct: number;
  exceptions: ExceptionStat[]; complex: { invoiceId: string; stations: number; loops: number; cycleDays: number; why: string }[]; complexCount: number;
  paths: Map<string, InvoicePath>;
}

const days = (h: number) => h / 24;
const round1 = (n: number) => Math.round(n * 10) / 10;
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function analyse(eventsByInvoice: Map<string, WorkflowEvent[]>, now: string): ProcessAnalysis {
  const paths = new Map<string, InvoicePath>();
  for (const [id, evs] of eventsByInvoice) { const p = reconstructPath(id, evs, now); if (p) paths.set(id, p); }
  const all = [...paths.values()];
  const conformance: Record<Conformance, number> = { conforming: 0, on_track: 0, rework: 0, extra_steps: 0 };
  for (const p of all) conformance[p.conformance]++;

  const st = new Map<string, { inv: Set<string>; visits: number; wait: number; work: number }>();
  for (const p of all) for (const sg of p.segments) {
    const s = st.get(sg.station) ?? st.set(sg.station, { inv: new Set(), visits: 0, wait: 0, work: 0 }).get(sg.station)!;
    s.inv.add(p.invoiceId); if (sg.phase === "waiting") s.wait += sg.hours; else s.work += sg.hours;
  }
  for (const p of all) { let prev = ""; for (const s of p.stations) { if (s !== prev) st.get(s)!.visits++; prev = s; } }
  const totalHours = [...st.values()].reduce((a, s) => a + s.wait + s.work, 0) || 1;
  const stations: StationStat[] = [...st].map(([station, s]) => ({ station, invoices: s.inv.size, visits: s.visits, waitHours: s.wait, workHours: s.work, totalHours: s.wait + s.work, avgHoursPerVisit: s.visits ? (s.wait + s.work) / s.visits : 0, expectedHours: EXPECTED_HOURS[station], sharePct: ((s.wait + s.work) / totalHours) * 100 })).sort((a, b) => b.totalHours - a.totalHours);
  // Bottleneck = a station where an invoice waits longer per visit than the expected path allows, or any non-expected station ranked by average time per visit.
  const bottlenecks = [...stations].filter((s) => s.visits >= 3 && s.station !== "Intake" && s.station !== "Payment").sort((a, b) => b.avgHoursPerVisit - a.avgHoursPerVisit).slice(0, 4);

  const edgeMap = new Map<string, { count: number; gap: number }>();
  for (const p of all) {
    // gap = time spent at the "from" station on that visit
    const visits: { station: string; hours: number }[] = [];
    for (const sg of p.segments) { const last = visits[visits.length - 1]; if (last && last.station === sg.station) last.hours += sg.hours; else visits.push({ station: sg.station, hours: sg.hours }); }
    for (let k = 0; k < visits.length - 1; k++) {
      const key = `${visits[k].station}>${visits[k + 1].station}`;
      const e = edgeMap.get(key) ?? edgeMap.set(key, { count: 0, gap: 0 }).get(key)!;
      e.count++; e.gap += visits[k].hours;
    }
  }
  const expEdges = new Set<string>(EXPECTED_PATH.slice(0, -1).map((s, i) => `${s}>${EXPECTED_PATH[i + 1]}`));
  const edges: Edge[] = [...edgeMap].map(([k, v]) => { const [from, to] = k.split(">"); return { from, to, count: v.count, avgGapHours: v.gap / v.count, rework: !expEdges.has(k) && (to === "AP review" || to === "Intake") }; });

  const vmap = new Map<string, InvoicePath[]>();
  for (const p of all) { const k = p.stations.join(" → "); (vmap.get(k) ?? vmap.set(k, []).get(k)!).push(p); }
  const variants: Variant[] = [...vmap].map(([key, ps]) => ({
    key, stations: ps[0].stations, invoices: ps.length, sharePct: (ps.length / all.length) * 100, completed: ps.filter((p) => p.completed).length,
    avgCycleDays: round1(days(ps.reduce((a, p) => a + p.cycleHours, 0) / ps.length)), conformance: ps[0].conformance, hasLoop: ps[0].loops.length > 0, example: ps.map((p) => p.invoiceId).sort()[0],
  })).sort((a, b) => b.invoices - a.invoices || a.key.localeCompare(b.key));

  const loopMap = new Map<string, { inv: Set<string>; n: number; extra: number }>();
  for (const p of all) for (const l of p.loops) {
    const k = l.sequence.join(" → ");
    const m = loopMap.get(k) ?? loopMap.set(k, { inv: new Set(), n: 0, extra: 0 }).get(k)!;
    m.inv.add(p.invoiceId); m.n++;
    // time spent between leaving `from` and coming back, summed over the visits that sit inside the loop
    m.extra += loopHours(p, l) / 24;
  }
  const loops: LoopStat[] = [...loopMap].map(([sequence, m]) => ({ sequence, via: sequence.split(" → ").slice(1, -1).join(" → "), invoices: m.inv.size, occurrences: m.n, extraDays: round1(m.extra) })).sort((a, b) => b.invoices - a.invoices || b.extraDays - a.extraDays);
  const reworkInvoices = all.filter((p) => p.loops.length > 0).length;

  const em = new Map<string, { n: number; open: number; h: number; dept: Map<string, number> }>();
  for (const p of all) for (const x of p.exceptions) {
    const m = em.get(x.check) ?? em.set(x.check, { n: 0, open: 0, h: 0, dept: new Map() }).get(x.check)!;
    m.n++; if (x.open) m.open++; m.h += x.hours; m.dept.set(x.department, (m.dept.get(x.department) ?? 0) + 1);
  }
  const totalExH = [...em.values()].reduce((a, m) => a + m.h, 0) || 1;
  const exceptions: ExceptionStat[] = [...em].map(([check, m]) => ({ check, count: m.n, open: m.open, avgDays: round1(days(m.h / m.n)), totalDays: round1(days(m.h)), sharePct: (m.h / totalExH) * 100, department: [...m.dept].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.totalDays - a.totalDays);

  const complexAll = all.filter((p) => p.stations.length > COMPLEX_STATIONS || p.loops.length >= COMPLEX_LOOPS)
    .map((p) => ({ invoiceId: p.invoiceId, stations: p.stations.length, loops: p.loops.length, cycleDays: round1(days(p.cycleHours)), why: [p.stations.length > COMPLEX_STATIONS ? `${p.stations.length} stations (expected ${EXPECTED_PATH.length})` : "", p.loops.length >= COMPLEX_LOOPS ? `${p.loops.length} rework loops` : ""].filter(Boolean).join(", ") }))
    .sort((a, b) => b.loops - a.loops || b.stations - a.stations || b.cycleDays - a.cycleDays || a.invoiceId.localeCompare(b.invoiceId));

  const cycles = all.map((p) => days(p.cycleHours));
  return {
    asOf: now, invoices: all.length, completed: all.filter((p) => p.completed).length, open: all.filter((p) => !p.completed).length,
    avgCycleDays: round1(cycles.reduce((a, b) => a + b, 0) / (cycles.length || 1)), medianCycleDays: round1(median(cycles)),
    conformance, conformingPct: (conformance.conforming / (all.length || 1)) * 100, stations, bottlenecks, edges, variants, loops, reworkInvoices, reworkPct: (reworkInvoices / (all.length || 1)) * 100,
    exceptions, complex: complexAll.slice(0, 10), complexCount: complexAll.length, paths,
  };
}

/** Hours between first leaving the loop's start station and arriving back (the rework detour). */
function loopHours(p: InvoicePath, l: Loop): number {
  const visits: { station: string; hours: number }[] = [];
  for (const sg of p.segments) { const last = visits[visits.length - 1]; if (last && last.station === sg.station) last.hours += sg.hours; else visits.push({ station: sg.station, hours: sg.hours }); }
  const n = l.sequence.length;
  for (let i = 0; i + n <= visits.length; i++) if (l.sequence.every((s, k) => visits[i + k].station === s)) return visits.slice(i + 1, i + n - 1).reduce((a, v) => a + v.hours, 0);
  return 0;
}

export const CHECK_LABEL: Record<string, string> = {
  price: "Price differs from PO", quantity: "Quantity above goods received", quality: "Quality inspection", weighbridge: "Weighbridge weight", tax: "Tax rate", duplicate: "Possible duplicate",
  unit_of_measure: "Unit of measure", contract: "Contract terms", inventory: "Inventory reconciliation", bank_change: "Bank-detail change verification", follow_up: "Follow-up question from AP", unspecified: "Not specified",
  purchase_order: "Purchase order", vendor: "Supplier record", arithmetic: "Arithmetic", shared_bank_account: "Shared account review", threshold_splitting: "Approval-threshold pattern", address_change: "Address change", tax_id_conflict: "Tax ID conflict",
};
