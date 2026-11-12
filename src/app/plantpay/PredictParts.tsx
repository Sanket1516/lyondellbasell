// Small presentational pieces for the prediction and supplier pages (server components, no client JS).
import type { Factor } from "@/predict/predictor";
import type { Band, Score } from "@/predict/supplier";
import p from "./Predict.module.css";

export type Tone = "risk" | "good" | "crit";
const fillClass = (band: Band, tone: Tone) => (tone === "good" ? p.fillGood : tone === "crit" ? p.fillCrit : band === "High" ? p.fillHigh : band === "Medium" ? p.fillMedium : p.fillLow);

export function Level({ band, tone = "risk" }: { band: Band; tone?: Tone }) {
  return <span className={`${p.level} ${p[band]} ${tone === "crit" ? p.toneCrit : tone === "good" ? p.toneGood : ""}`}>{band}</span>;
}
export function Meter({ value, band, tone = "risk", label }: { value: number; band: Band; tone?: Tone; label: string }) {
  return <div className={p.meter} role="img" aria-label={`${label}: ${Math.round(value)} percent`}><div className={`${p.fill} ${fillClass(band, tone)}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>;
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Top contributing factors as a diverging bar: red pushes the probability up, green pulls it down (percentage points). */
export function FactorList({ factors, empty = "No single factor moves this estimate by more than half a point." }: { factors: Factor[]; empty?: string }) {
  if (factors.length === 0) return <p className={p.small}>{empty}</p>;
  const max = Math.max(...factors.map((f) => Math.abs(f.effectPoints)), 1);
  return (
    <ul className={p.factors}>
      {factors.map((f) => (
        <li key={f.feature}>
          <span className={p.fname}>{f.label}<br /><span className={p.fval}>{f.value}</span></span>
          <span className={p.dbar} aria-hidden="true"><span className={`${p.dfill} ${f.effectPoints >= 0 ? p.up : p.down}`} style={{ width: `${(Math.abs(f.effectPoints) / max) * 50}%` }} /></span>
          <span className={p.pts}>{f.effectPoints >= 0 ? "+" : "−"}{Math.abs(f.effectPoints).toFixed(1)} pts<span className="sr-only"> ({f.direction} the estimate)</span></span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreRows({ title, score, tone }: { title: string; score: Score; tone: Tone }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 2px", fontSize: "0.95rem" }}>{title} <span className={p.big} style={{ fontSize: "1.3rem" }}>{score.score}</span><Level band={score.band} tone={tone} /></h3>
      <Meter value={score.score} band={score.band} tone={tone} label={title} />
      <p className={p.small} style={{ margin: "2px 0 6px" }}>{score.summary}</p>
      <ul className={p.factors}>
        {score.parts.map((x) => (
          <li key={x.label} style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1.6fr) 54px" }}>
            <span className={p.fname}>{x.label}</span><span className={p.fval}>{x.note}</span><span className={p.pts}>{x.points.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
