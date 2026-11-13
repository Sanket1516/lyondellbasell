"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import s from "../Plantpay.module.css";

// Interactive relationship graph: a small force-directed layout in plain SVG (no library). Drag a node, click it for detail,
// filter by node type. A link is a question for a person to check, never a finding about anyone.
export interface ViewNode { id: string; type: "vendor" | "bank" | "address" | "approver" | "po" | "invoice"; label: string; detail?: string }
export interface ViewEdge { source: string; target: string; kind: string }
export interface ViewFinding { kind: string; nodeIds: string[]; confirmedLegitimate: boolean; text: string }

const W = 900, H = 520;
const COLOR: Record<ViewNode["type"], string> = { vendor: "#2f81f7", bank: "#d29922", address: "#3fb950", approver: "#a371f7", po: "#6e7681", invoice: "#8b949e" };
const NAME: Record<ViewNode["type"], string> = { vendor: "Vendor", bank: "Bank account", address: "Address", approver: "Approver", po: "PO", invoice: "Invoice" };
const EDGE_NAME: Record<string, string> = { holds_account: "holds account", registered_at: "registered at", billed_by: "billed by", for_po: "for PO", approved_by: "approved by", ordered_from: "ordered from" };

type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };

export default function GraphView({ nodes, edges, findings }: { nodes: ViewNode[]; edges: ViewEdge[]; findings: ViewFinding[] }) {
  const [pos, setPos] = useState<Record<string, P>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const drag = useRef<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const posRef = useRef<Record<string, P>>({});

  const flagged = useMemo(() => {
    const m = new Map<string, boolean>(); // node -> shared with confirmed-legitimate only?
    for (const f of findings) for (const id of f.nodeIds) m.set(id, (m.get(id) ?? true) && f.confirmedLegitimate);
    return m;
  }, [findings]);
  const shown = useMemo(() => nodes.filter((n) => !hidden.has(n.type)), [nodes, hidden]);
  const shownIds = useMemo(() => new Set(shown.map((n) => n.id)), [shown]);
  const shownEdges = useMemo(() => edges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target)), [edges, shownIds]);

  // simple force layout, run for a fixed number of steps then settle
  useEffect(() => {
    const p: Record<string, P> = {};
    shown.forEach((n, i) => { const a = (i / Math.max(shown.length, 1)) * Math.PI * 2; p[n.id] = posRef.current[n.id] ?? { x: W / 2 + Math.cos(a) * 200, y: H / 2 + Math.sin(a) * 160, vx: 0, vy: 0 }; });
    posRef.current = p;
    let step = 0; let raf = 0;
    const tick = () => {
      const ids = Object.keys(p);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = p[ids[i]], b = p[ids[j]]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01; const f = 1800 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const e of shownEdges) { const a = p[e.source], b = p[e.target]; if (!a || !b) continue; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.01; const f = (d - 90) * 0.02; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      for (const id of ids) { const q = p[id]; q.vx += (W / 2 - q.x) * 0.002; q.vy += (H / 2 - q.y) * 0.002; if (!q.fixed) { q.x = Math.max(24, Math.min(W - 24, q.x + q.vx)); q.y = Math.max(24, Math.min(H - 24, q.y + q.vy)); } q.vx *= 0.82; q.vy *= 0.82; }
      setPos({ ...p });
      if (++step < 220 || drag.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, shownEdges]);

  const toLocal = (ev: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H }; };
  const onMove = (ev: React.PointerEvent) => { if (!drag.current) return; const q = posRef.current[drag.current]; if (!q) return; const l = toLocal(ev); q.x = l.x; q.y = l.y; q.vx = 0; q.vy = 0; setPos({ ...posRef.current }); };
  const sel = selected ? nodes.find((n) => n.id === selected) : undefined;
  const selEdges = selected ? edges.filter((e) => e.source === selected || e.target === selected) : [];
  const byId = (id: string) => nodes.find((n) => n.id === id);
  const types = [...new Set(nodes.map((n) => n.type))];
  const hot = (id: string) => flagged.get(id) === false; // linked and not confirmed as legitimate

  if (nodes.length === 0) return <p className={s.lead}>Nothing to draw for this selection.</p>;
  return (
    <div>
      <div className={s.graphTools}>
        {types.map((t) => (
          <label key={t}><input type="checkbox" checked={!hidden.has(t)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })} /> <span style={{ color: COLOR[t] }}>●</span> {NAME[t]}</label>
        ))}
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className={s.graphSvg} role="img" aria-label="Relationship graph of vendors, accounts, addresses and approvers" onPointerMove={onMove} onPointerUp={() => { if (drag.current && posRef.current[drag.current]) posRef.current[drag.current].fixed = false; drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        {shownEdges.map((e, i) => { const a = pos[e.source], b = pos[e.target]; if (!a || !b) return null; const on = selected && (e.source === selected || e.target === selected); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: on ? "var(--accent-2)" : "var(--graph-edge)" }} strokeWidth={on ? 2 : 1} opacity={selected && !on ? 0.25 : 0.8} />; })}
        {shown.map((n) => { const q = pos[n.id]; if (!q) return null; const r = n.type === "vendor" ? 13 : n.type === "invoice" || n.type === "po" ? 5 : 9; return (
          <g key={n.id} transform={`translate(${q.x},${q.y})`} style={{ cursor: "grab" }} tabIndex={0} role="button" aria-label={`${NAME[n.type]} ${n.label}`}
            onPointerDown={(ev) => { (ev.target as Element).setPointerCapture?.(ev.pointerId); drag.current = n.id; posRef.current[n.id].fixed = true; setSelected(n.id); }}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") setSelected(n.id); }}>
            <circle r={r} fill={COLOR[n.type]} style={{ stroke: hot(n.id) ? "var(--bad)" : selected === n.id ? "var(--ink)" : "var(--paper)" }} strokeWidth={hot(n.id) ? 3 : 2} />
            {(n.type === "vendor" || n.type === "bank" || n.type === "approver" || selected === n.id) && <text y={r + 12} textAnchor="middle" fontSize="10.5" fill="currentColor">{n.label.length > 24 ? n.label.slice(0, 23) + "…" : n.label}</text>}
          </g>
        ); })}
      </svg>
      <p className={s.srcMeta}>Red outline: linked to another vendor and not yet confirmed as legitimate, which is a question for a person, not a conclusion. Drag nodes to rearrange; click one for detail.</p>
      <div className={s.panel} aria-live="polite">
        {sel ? (
          <>
            <h3>{NAME[sel.type]}: {sel.label}</h3>
            {sel.detail && <p>{sel.detail}</p>}
            <ul>{selEdges.slice(0, 14).map((e, i) => { const other = byId(e.source === sel.id ? e.target : e.source); return <li key={i}>{e.source === sel.id ? EDGE_NAME[e.kind] : `${EDGE_NAME[e.kind]} (from)`}: {other?.label ?? "?"}</li>; })}{selEdges.length > 14 && <li>and {selEdges.length - 14} more</li>}</ul>
            {findings.filter((f) => f.nodeIds.includes(sel.id)).map((f, i) => <p key={i} className={s.srcMeta}>{f.text} <em>(warning, not proof)</em></p>)}
          </>
        ) : <p className={s.srcMeta}>Select a node to see what it is connected to.</p>}
      </div>
    </div>
  );
}
