// Hand-built SVG charts in the design tokens. Server components: every bar is a link that filters the table below.
import Link from "next/link";
import s from "./Dashboard.module.css";

export interface BarDatum { id: string; label: string; value: number; href: string; active?: boolean; note?: string }

/** Horizontal bars, one per row. The row is the link; the bar itself is an SVG rect. */
export function HBars({ data, caption }: { data: BarDatum[]; caption: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={s.bars} aria-label={caption}>
      {data.map((d) => (
        <li key={d.id}>
          <Link href={d.href} className={d.active ? `${s.barRow} ${s.barOn}` : s.barRow} aria-current={d.active ? "true" : undefined}>
            <span className={s.barLabel}>{d.label}</span>
            <svg className={s.barSvg} viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width="100" height="12" className={s.barTrack} />
              {d.value > 0 && <rect x="0" y="0" width={(d.value / max) * 100} height="12" className={s.barFill} />}
            </svg>
            <span className={s.barValue}>{d.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface AgeDatum { id: string; label: string; count: number; href: string; active?: boolean }

const SHADE = ["#a5d6ff", "#58a6ff", "#2f81f7", "#1158c7"]; // blue, light to dark: older is darker

/** One stacked bar for the whole queue, split by age bucket. Segments and legend entries are links. */
export function AgeBar({ data }: { data: AgeDatum[] }) {
  const total = data.reduce((n, d) => n + d.count, 0);
  let x = 0;
  return (
    <div>
      <svg className={s.ageSvg} viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label={`Open exceptions by age: ${data.map((d) => `${d.label} ${d.count}`).join(", ")}`}>
        {total === 0 && <rect x="0" y="0" width="100" height="14" className={s.barTrack} />}
        {data.map((d, i) => {
          const w = total ? (d.count / total) * 100 : 0;
          const rect = w > 0 ? (
            <a key={d.id} href={d.href}>
              <title>{`${d.label}: ${d.count}`}</title>
              <rect x={x} y="0" width={w} height="14" fill={SHADE[i]} style={{ stroke: "var(--surface)" }} strokeWidth="0.4" />
            </a>
          ) : null;
          x += w;
          return rect;
        })}
      </svg>
      <ul className={s.legend}>
        {data.map((d, i) => (
          <li key={d.id}>
            <Link href={d.href} className={d.active ? `${s.legendLink} ${s.barOn}` : s.legendLink} aria-current={d.active ? "true" : undefined}>
              <span className={s.swatch} style={{ background: SHADE[i] }} aria-hidden="true" />
              <span>{d.label}</span>
              <strong className="mono">{d.count}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
