// Lite mode: the same story as static, layered SVG illustrations. Layers reveal with CSS when the section scrolls in
// (class "in" is added by an IntersectionObserver). No WebGL, no per-frame work.
import type { ReactNode } from "react";
import { APPROVER, CLERK, S, inr, rs } from "../content";

const K = { ink: "#e8edf5", soft: "#8d99ab", faint: "#5b6678", line: "#24324a", glass: "#0e1626", acc: "#3d8bff", hi: "#7fb3ff", ok: "#3fb950", warn: "#e3a72f", bad: "#f85149" };
const L = ({ d = 0, children }: { d?: number; children: ReactNode }) => <g className="layer" style={{ ["--d" as string]: `${d * 110}ms` }}>{children}</g>;
const T = (p: { x: number; y: number; s?: number; c?: string; w?: number; a?: "start" | "middle" | "end"; f?: "d" | "m"; children: ReactNode }) => (
  <text x={p.x} y={p.y} fontSize={p.s ?? 13} fill={p.c ?? K.ink} fontWeight={p.w ?? 500} textAnchor={p.a ?? "start"}
    fontFamily={p.f === "d" ? "Archivo Variable, Inter Variable, sans-serif" : p.f === "m" ? "Spline Sans Mono, monospace" : "Inter Variable, sans-serif"}>{p.children}</text>
);
function Doc({ x, y, w = 150, h = 196, band, title, sub, rows = [], hi }: { x: number; y: number; w?: number; h?: number; band: string; title: string; sub?: string; rows?: [string, string][]; hi?: { row: number; c: string } }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={8} fill={K.glass} stroke={K.line} />
      <rect width={w} height={4} rx={2} fill={band} />
      <T x={12} y={30} s={15} w={600} f="d">{title}</T>
      {sub && <T x={12} y={48} s={10} c={K.soft}>{sub}</T>}
      {rows.map(([a, b], i) => (
        <g key={i}>
          {hi && hi.row === i && <rect x={6} y={64 + i * 24} width={w - 12} height={20} rx={4} fill={hi.c} opacity={0.22} />}
          <T x={12} y={78 + i * 24} s={10.5}>{a}</T>
          <T x={w - 12} y={78 + i * 24} s={10.5} a="end" c={hi && hi.row === i ? hi.c : K.ink}>{b}</T>
        </g>
      ))}
    </g>
  );
}
const Pill = ({ x, y, text, c, w = 150 }: { x: number; y: number; text: string; c: string; w?: number }) => (
  <g transform={`translate(${x} ${y})`}><rect width={w} height={28} rx={14} fill="#0a0e18" stroke={c} strokeWidth={1.5} /><T x={w / 2} y={18.5} s={11} w={700} c={c} a="middle" f="d">{text}</T></g>
);

const H = S.hero;
const ART: (() => ReactNode)[] = [
  () => (<>
    <L><circle cx={200} cy={150} r={120} fill="url(#glow)" /></L>
    <L d={1}><g transform="rotate(-6 200 150)"><Doc x={125} y={52} band={K.warn} title={H.id} sub={H.supplier} rows={H.lines.map((l) => [l.description.split(" ").slice(-1)[0], rs(l.amount)] as [string, string])} /></g></L>
    <L d={2}>{Array.from({ length: 26 }, (_, i) => <circle key={i} cx={40 + ((i * 97) % 320)} cy={20 + ((i * 53) % 260)} r={1.4} fill={K.hi} opacity={0.6} />)}</L>
  </>),
  () => (<>
    {[0, 1, 2].map((p) => (
      <L key={p} d={p}>{Array.from({ length: 8 }, (_, j) => (
        <g key={j}><rect x={50 + p * 110} y={230 - j * 16} width={90} height={12} rx={2} fill="#1a2538" stroke={K.line} />
          {(p * 8 + j) % 3 === 0 && <rect x={54 + p * 110} y={233 - j * 16} width={24} height={6} rx={2} fill={(p + j) % 2 ? K.warn : K.bad} />}</g>
      ))}</L>
    ))}
    <L d={3}><T x={200} y={70} s={44} w={650} f="d" a="middle" c={K.bad}>{S.problem.overdueOpen}</T><T x={200} y={92} s={12} a="middle" c={K.soft}>invoices past due, still unpaid</T></L>
  </>),
  () => (<>
    <L><Doc x={40} y={50} band={K.warn} title={H.id} sub={H.supplier} rows={[["AX-40", "₹412"], ["C-12", "₹86,000"], ["DR-200", "₹1,450"]]} /></L>
    <L d={1}><rect x={36} y={140} width={158} height={2} fill={K.hi} /></L>
    {["Vendor", "PO number", "Items", "Quantities", "Prices", "Tax"].map((c, i) => (
      <L key={c} d={2 + i * 0.5}><g transform={`translate(220 ${48 + i * 36})`}><rect width={150} height={28} rx={14} fill="#0c1424" stroke={K.acc} /><circle cx={14} cy={14} r={4} fill={K.acc} /><T x={26} y={18} s={11}>{c}</T></g></L>
    ))}
  </>),
  () => (<>
    <L><circle cx={200} cy={150} r={28} fill={K.acc} /><circle cx={200} cy={150} r={46} fill="none" stroke={K.hi} opacity={0.5} /></L>
    {S.sources.map((s, i) => { const a = (i / 6) * Math.PI * 2 - Math.PI / 2, x = 200 + Math.cos(a) * 130, y = 150 + Math.sin(a) * 105;
      return (<L key={s.id} d={1 + i * 0.4}><line x1={x} y1={y} x2={200} y2={150} stroke={K.acc} opacity={0.6} /><rect x={x - 11} y={y - 11} width={22} height={22} rx={5} fill="#15233a" stroke={K.acc} /><T x={x} y={y + (y > 150 ? 30 : -18)} s={11} a="middle">{s.label}</T><T x={x} y={y + (y > 150 ? 43 : -6)} s={9.5} a="middle" c={K.soft}>{`${inr(s.records)} records`}</T></L>); })}
  </>),
  () => (<>
    <L><Doc x={14} y={70} w={118} h={150} band={K.warn} title="Invoice" rows={[["AX-40", "₹412"], ["C-12", "₹86"], ["DR-200", "40 nos"]]} hi={{ row: 0, c: K.bad }} /></L>
    <L d={1}><Doc x={141} y={70} w={118} h={150} band={K.acc} title="PO" rows={[["AX-40", "₹398"], ["C-12", "₹86"], ["DR-200", "40 nos"]]} hi={{ row: 0, c: K.bad }} /></L>
    <L d={2}><Doc x={268} y={70} w={118} h={150} band={K.ok} title="Receipt" rows={[["AX-40", "1,000 kg"], ["C-12", "5,000 kg"], ["DR-200", "32 nos"]]} /></L>
    <L d={3}><Pill x={125} y={28} text="FLAGGED · 3.5% over" c={K.bad} w={150} /></L>
  </>),
  () => (<>
    <L><Doc x={20} y={90} w={118} h={150} band={K.warn} title="Invoice" rows={[["AX-40", "₹412"]]} hi={{ row: 0, c: K.ok }} /></L>
    <L d={1}><Doc x={150} y={120} w={110} h={120} band={K.acc} title="PO" rows={[["AX-40", "₹398"]]} hi={{ row: 0, c: K.warn }} /></L>
    <L d={2}><Doc x={272} y={40} w={118} h={130} band={K.acc} title="C-22 amend." sub="effective 01-Oct-2026" rows={[["AX-40", "₹398 → ₹412"]]} /></L>
    <L d={3}><path d="M272 110 C 200 20, 120 60, 120 160" fill="none" stroke={K.ok} strokeWidth={2} /><path d="M290 172 C 290 200, 270 190, 250 180" fill="none" stroke={K.warn} strokeWidth={2} strokeDasharray="4 4" /></L>
    <L d={4}><Pill x={20} y={48} text="EVIDENCE-SUPPORTED" c={K.ok} w={160} /></L>
  </>),
  () => { const v = S.risk.graph.vendors.slice(0, 14); return (<>
    <L>{v.map((n, i) => { const a = i * 2.4, r = 60 + (i % 4) * 22; return <circle key={n.id} cx={170 + Math.cos(a) * r} cy={140 + Math.sin(a) * r * 0.7} r={5} fill="#3a4a63" />; })}</L>
    <L d={1}><circle cx={120} cy={110} r={9} fill={K.warn} /><circle cx={230} cy={150} r={9} fill={K.warn} /><rect x={170} y={92} width={12} height={12} fill={K.warn} transform="rotate(20 176 98)" /><line x1={120} y1={110} x2={176} y2={98} stroke={K.warn} strokeWidth={2} /><line x1={230} y1={150} x2={176} y2={98} stroke={K.warn} strokeWidth={2} /></L>
    <L d={2}><T x={96} y={92} s={10.5}>{S.risk.shared.a}</T><T x={214} y={176} s={10.5}>{S.risk.shared.b}</T></L>
    <L d={3}><g transform="translate(300 170)"><rect width={70} height={92} rx={6} fill={K.glass} stroke={K.line} /><rect x={8} y={-8} width={70} height={92} rx={6} fill={K.glass} stroke={K.warn} strokeDasharray="4 3" opacity={0.8} /><T x={43} y={44} s={16} w={650} f="d" a="middle" c={K.warn}>{S.risk.duplicate.score}</T><T x={43} y={58} s={9} a="middle" c={K.soft}>of 100</T></g></L>
    <L d={4}><Pill x={20} y={250} text="WARNING, NOT PROOF" c={K.warn} w={160} /></L>
  </>); },
  () => (<>
    <L><line x1={20} y1={170} x2={380} y2={170} stroke={K.acc} strokeWidth={2} /></L>
    <L d={1}><rect x={120} y={80} width={60} height={90} fill="none" stroke={K.ok} strokeWidth={3} /><T x={150} y={70} s={11} a="middle">AP Clerk</T><T x={150} y={56} s={9.5} a="middle" c={K.soft}>{CLERK.name}</T></L>
    <L d={2}><rect x={250} y={80} width={60} height={90} fill="none" stroke={K.ok} strokeWidth={3} /><T x={280} y={70} s={11} a="middle">Approver L1</T><T x={280} y={56} s={9.5} a="middle" c={K.soft}>{APPROVER.name}</T></L>
    <L d={3}><rect x={20} y={220} width={360} height={5} rx={2} fill="#1c2a40" /><rect x={20} y={220} width={360 * (H.totalInr / S.approval.l1Max)} height={5} rx={2} fill={K.acc} /><rect x={20 + 360 * (S.approval.clerkMax / S.approval.l1Max)} y={210} width={2} height={24} fill={K.warn} /><T x={20 + 360 * (S.approval.clerkMax / S.approval.l1Max) + 6} y={248} s={10} c={K.warn}>{`${rs(S.approval.clerkMax)} clerk limit`}</T><T x={20 + 360 * (H.totalInr / S.approval.l1Max)} y={208} s={10} a="middle" c={K.hi}>{rs(H.totalInr)}</T></L>
    <L d={4}><g transform="translate(300 110) rotate(-8)"><rect x={-44} y={-16} width={88} height={32} rx={5} fill="none" stroke={K.ok} strokeWidth={2.5} /><T x={0} y={6} s={14} w={750} a="middle" c={K.ok} f="d">APPROVED</T></g></L>
  </>),
  () => { const I = S.intelligence; const arc = (v: number) => { const a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5 * v; const p = (a: number) => `${100 + Math.cos(a) * 70} ${150 + Math.sin(a) * 70}`; return `M ${p(a0)} A 70 70 0 ${v > 0.66 ? 1 : 0} 1 ${p(a1)}`; };
    return (<>
      <L><path d={arc(1)} fill="none" stroke="#1c2a40" strokeWidth={10} strokeLinecap="round" /><path d={arc(I.criticality.score / 100)} fill="none" stroke={K.acc} strokeWidth={10} strokeLinecap="round" /><T x={100} y={158} s={30} w={650} f="d" a="middle">{I.criticality.score}</T><T x={100} y={176} s={10} a="middle" c={K.soft}>supply criticality</T></L>
      {[["Exception risk", I.exception.p], ["Payment-delay risk", I.delay.p]].map(([l, p], i) => (
        <L key={l as string} d={1 + i}><T x={200} y={92 + i * 70} s={11.5}>{l as string}</T><T x={380} y={92 + i * 70} s={14} w={650} a="end" f="d" c={K.warn}>{`${Math.round((p as number) * 100)}%`}</T><rect x={200} y={100 + i * 70} width={180} height={6} rx={3} fill="#1c2a40" /><rect x={200} y={100 + i * 70} width={180 * (p as number)} height={6} rx={3} fill={K.warn} /></L>
      ))}
      <L d={3}><T x={200} y={226} s={10} c={K.soft}>{`Top factor: ${I.exception.factors[0].label.toLowerCase()}`}</T><Pill x={200} y={244} text="AI-ASSISTED" c={K.hi} w={120} /></L>
    </>); },
  () => (<>
    {S.trust.chain.map((b, i) => { const bad = b.seq >= S.trust.tamperedSeq; return (
      <L key={b.seq} d={i * 0.35}><rect x={14 + i * 42} y={bad && b.seq === S.trust.tamperedSeq ? 112 : 124} width={36} height={52} rx={5} fill={K.glass} stroke={bad ? K.bad : K.acc} strokeWidth={1.5} /><T x={32 + i * 42} y={190} s={8.5} a="middle" c={bad ? K.bad : K.soft} f="m">{`#${b.seq}`}</T>{i > 0 && <line x1={i * 42 + 8} y1={150} x2={i * 42 + 14} y2={150} stroke={bad ? K.bad : K.acc} strokeWidth={2} />}</L>); })}
    <L d={4}><circle cx={14 + 4 * 42 + 18} cy={138} r={40} fill="none" stroke={K.bad} opacity={0.5} /><Pill x={110} y={232} text={`RECORD ${S.trust.tamperedSeq} CHANGED`} c={K.bad} w={180} /></L>
  </>),
  () => (<>
    <L><line x1={30} y1={170} x2={370} y2={170} stroke={K.ok} strokeWidth={3} /></L>
    {S.paid.milestones.map((m, i) => (<L key={m.id} d={i * 0.4}><circle cx={30 + i * (340 / 6)} cy={170} r={8} fill={K.ok} /><T x={30 + i * (340 / 6)} y={i % 2 ? 210 : 196} s={9} a="middle" c={K.soft}>{m.label.replace("Invoice ", "").replace(" confirmed", "").replace(" matched", "")}</T></L>))}
    <L d={3}><Pill x={115} y={90} text="READY FOR PAYMENT" c={K.ok} w={170} /></L>
  </>),
  () => null,
];

export function LiteArt({ i }: { i: number }) {
  const art = ART[i]?.();
  if (!art) return null;
  return (
    <svg className="liteArt" viewBox="0 0 400 300" role="img" aria-hidden="true" focusable="false">
      <defs><radialGradient id="glow"><stop offset="0" stopColor="#3d8bff" stopOpacity="0.35" /><stop offset="1" stopColor="#3d8bff" stopOpacity="0" /></radialGradient></defs>
      {art}
    </svg>
  );
}
