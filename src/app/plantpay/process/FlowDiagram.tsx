import type { Edge, InvoicePath, StationStat } from "@/plantpay/processMining";
import s from "./Process.module.css";

const W = 960, H = 400, BW = 150, BH = 58;
const MAIN: Record<string, [number, number]> = { Intake: [20, 60], "AP review": [270, 60], Approval: [560, 60], Payment: [790, 60] };
const DEPT_ORDER = ["Procurement", "Warehouse", "Quality", "Logistics", "Supplier master data"];

/** Station layout: the expected path along the top, the other departments in a row underneath AP review. */
function layout(stations: string[]): Map<string, [number, number]> {
  const pos = new Map<string, [number, number]>();
  for (const [k, v] of Object.entries(MAIN)) pos.set(k, v);
  const depts = [...stations.filter((x) => !(x in MAIN))].sort((a, b) => (DEPT_ORDER.indexOf(a) + 99) % 99 - (DEPT_ORDER.indexOf(b) + 99) % 99);
  const gap = (W - 40 - BW) / Math.max(1, depts.length - 1 || 1);
  depts.forEach((d, i) => pos.set(d, [depts.length === 1 ? (W - BW) / 2 : 20 + i * Math.min(gap, 190), 270]));
  return pos;
}
const center = (p: [number, number]) => [p[0] + BW / 2, p[1] + BH / 2] as const;
function edgePoint(c: readonly [number, number], dx: number, dy: number): [number, number] {
  const tx = dx === 0 ? Infinity : BW / 2 / Math.abs(dx), ty = dy === 0 ? Infinity : BH / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [c[0] + dx * t, c[1] + dy * t];
}
/** A line from box a to box b, shifted sideways by `off` so a pair of opposite arrows does not overlap. */
function line(a: [number, number], b: [number, number], off: number) {
  const ca = center(a), cb = center(b);
  const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
  const ux = (cb[0] - ca[0]) / len, uy = (cb[1] - ca[1]) / len;
  const nx = -uy, ny = ux;
  const p1 = edgePoint(ca, ux, uy), p2 = edgePoint(cb, -ux, -uy);
  const x1 = p1[0] + nx * off, y1 = p1[1] + ny * off, x2 = p2[0] + nx * off, y2 = p2[1] + ny * off;
  return { x1, y1, x2, y2, mx: (x1 + x2) / 2 + nx * 10, my: (y1 + y2) / 2 + ny * 10 };
}

const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);

export default function FlowDiagram({ stats, edges, selected }: { stats: StationStat[]; edges: Edge[]; selected?: InvoicePath }) {
  const names = [...new Set([...Object.keys(MAIN), ...stats.map((x) => x.station)])];
  const pos = layout(names);
  const stat = new Map(stats.map((x) => [x.station, x]));
  const maxCount = Math.max(1, ...edges.map((e) => e.count));
  const hops = selected ? selected.stations.slice(0, -1).map((f, i) => [f, selected.stations[i + 1]] as const) : [];
  return (
    <div className={s.diagramWrap}>
      <svg className={s.diagram} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Flow diagram of invoice paths between stations. Counts are shown on each arrow. Rework arrows are dashed.">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke" /></marker>
        </defs>
        <text x="20" y="38" className={s.dHead}>EXPECTED PATH</text>
        <text x="20" y="246" className={s.dHead}>WORK SENT TO DEPARTMENTS</text>
        {edges.filter((e) => pos.has(e.from) && pos.has(e.to)).map((e) => {
          const g = line(pos.get(e.from)!, pos.get(e.to)!, 8);
          const w = 1.2 + (e.count / maxCount) * 5;
          return (
            <g key={`${e.from}>${e.to}`} className={e.rework ? s.eRework : s.eFlow}>
              <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} strokeWidth={w} markerEnd="url(#arr)" />
              <text x={g.mx} y={g.my} className={s.eLabel} textAnchor="middle">{e.count} · {fmtH(e.avgGapHours)}</text>
            </g>
          );
        })}
        {hops.map(([f, t], i) => {
          if (!pos.has(f) || !pos.has(t)) return null;
          const g = line(pos.get(f)!, pos.get(t)!, -14);
          return (
            <g key={i} className={s.eSel}>
              <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} markerEnd="url(#arr)" />
              <circle cx={(g.x1 + g.x2) / 2} cy={(g.y1 + g.y2) / 2} r="9" />
              <text x={(g.x1 + g.x2) / 2} y={(g.y1 + g.y2) / 2 + 3.5} textAnchor="middle">{i + 1}</text>
            </g>
          );
        })}
        {names.map((n) => {
          const p = pos.get(n)!; const st = stat.get(n);
          const hot = st && st.expectedHours !== undefined ? st.avgHoursPerVisit > st.expectedHours : false;
          return (
            <g key={n}>
              <rect x={p[0]} y={p[1]} width={BW} height={BH} rx="6" className={hot ? s.nHot : s.nBox} />
              <text x={p[0] + BW / 2} y={p[1] + 23} textAnchor="middle" className={s.nName}>{n}</text>
              <text x={p[0] + BW / 2} y={p[1] + 42} textAnchor="middle" className={s.nSub}>{st ? `${st.invoices} invoices · avg ${fmtH(st.avgHoursPerVisit)}` : "no invoices"}</text>
            </g>
          );
        })}
      </svg>
      <p className={s.legend}><span className={s.keyFlow} /> Normal handover <span className={s.keyRework} /> Rework (work sent back to an earlier station) <span className={s.keySel} /> Selected invoice, numbered in order. Arrow labels: invoices · average time spent at the station it leaves. A highlighted box means invoices stay longer per visit than the expected path allows.</p>
    </div>
  );
}
