"use client";
// Golden Journey shell: persistent stepper, Back/Next, arrow keys, Reset, Skip to step, presenter notes with a timer, and the
// pre-computed fallback. The nine screens only render data; all data comes from one document (live from the API, or pre-computed).
import { useCallback, useEffect, useRef, useState } from "react";
import { COPY } from "@/plantpay/journey/copy";
import { NOTES, TOTAL_TARGET_SECONDS, STEP_TARGET_SECONDS, estimateSeconds, wordCount } from "@/plantpay/journey/notes";
import { JOURNEY_STEPS, JOURNEY_TITLES, type JourneyData } from "@/plantpay/journey/types";
import { journeyProblems, stepProblems } from "@/plantpay/journey/validate";
import { Feature } from "./Screens";
import SafeScreen from "./ScreenBoundary";
import j from "./Journey.module.css";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function loadFallback(): Promise<JourneyData> {
  const m = await import("@/plantpay/journey/fallback.json");
  return { ...(m.default as unknown as JourneyData), mode: "fallback" };
}

/** Live data when the call works and every screen has content; the pre-computed copy for any screen (or the whole journey) that does not. */
async function loadJourney(opts: { forceFallback: boolean; forceFail: boolean }): Promise<{ data: JourneyData; note?: string }> {
  if (opts.forceFallback) return { data: await loadFallback(), note: "Pre-computed results are shown because fallback mode was requested." };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    const res = await fetch(`/api/plantpay/journey${opts.forceFail ? "?fail=1" : ""}`, { cache: "no-store", signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`The live call returned ${res.status}.`);
    const live = (await res.json()) as JourneyData;
    const bad = Array.from({ length: JOURNEY_STEPS }, (_, i) => i + 1).filter((n) => stepProblems(n, live).length > 0);
    if (bad.length === 0) return { data: { ...live, mode: "live" } };
    const fb = await loadFallback();
    const steps = { ...live.steps } as Record<number, unknown>;
    for (const n of bad) steps[n] = (fb.steps as unknown as Record<number, unknown>)[n];
    return { data: { ...live, steps: steps as unknown as JourneyData["steps"], mode: "fallback" }, note: `Live data for step${bad.length > 1 ? "s" : ""} ${bad.join(", ")} was incomplete, so the pre-computed result is shown for ${bad.length > 1 ? "them" : "it"}.` };
  } catch (e) {
    return { data: await loadFallback(), note: `The live call failed (${e instanceof Error ? e.message : "unknown error"}), so pre-computed results are shown. Everything on screen is a stored result of an earlier run.` };
  }
}

export default function JourneyApp() {
  const [data, setData] = useState<JourneyData | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [step, setStep] = useState(1);
  const [visited, setVisited] = useState<Set<number>>(new Set([1]));
  const [runId, setRunId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stepSince, setStepSince] = useState(0);
  const [paused, setPaused] = useState(false);
  const flags = useRef({ forceFallback: false, forceFail: false });
  const main = useRef<HTMLDivElement>(null);

  const start = useCallback(async () => {
    setLoading(true);
    const r = await loadJourney(flags.current);
    setData(r.data); setNote(r.note); setStep(1); setVisited(new Set([1])); setElapsed(0); setStepSince(0); setPaused(false); setRunId((x) => x + 1); setLoading(false);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    flags.current = { forceFallback: q.get("fallback") === "1", forceFail: q.get("fail") === "1" };
    void start();
  }, [start]);

  useEffect(() => {
    if (loading || paused) return;
    const t = setInterval(() => setElapsed((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [loading, paused]);

  const go = useCallback((n: number) => {
    const to = Math.min(JOURNEY_STEPS, Math.max(1, n));
    setStep(to); setVisited((v) => new Set(v).add(to)); setStepSince(elapsed);
    main.current?.scrollIntoView({ block: "start" });
  }, [elapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(step + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(step - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  if (loading || !data) return <p className={j.loading} role="status">Preparing the journey from the six systems…</p>;
  const copy = COPY[step - 1];
  const stepElapsed = elapsed - stepSince;
  const fallback = data.mode === "fallback";
  return (
    <div className={j.wrap} ref={main}>
      <nav className={j.stepper} aria-label="Journey steps">
        <h2>A week at the plant</h2>
        <ol>
          {JOURNEY_TITLES.map((t, i) => {
            const n = i + 1;
            return (
              <li key={t}>
                <button type="button" className={`${j.stepBtn} ${n === step ? j.stepOn : ""}`} aria-current={n === step ? "step" : undefined} onClick={() => go(n)}>
                  <span className={`${j.stepNum} ${n === step ? j.numOn : visited.has(n) && n < step ? j.numDone : ""}`}>{visited.has(n) && n < step ? "✓" : n}</span>
                  <span className={j.stepLabel}>{t}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={j.main}>
        <div className={j.bar}>
          <h1>Golden Journey</h1>
          <div className={j.barTools}>
            <span className={`${j.mode} ${fallback ? j.modeFallback : j.modeLive}`}>{fallback ? "Pre-computed results" : "Live data"}</span>
            <span className={`${j.timer} ${elapsed > TOTAL_TARGET_SECONDS ? j.timerOver : ""}`} role="timer" aria-label="Elapsed time">{clock(elapsed)} / {clock(TOTAL_TARGET_SECONDS)}</span>
            <button type="button" className={j.btn} onClick={() => setPaused((p) => !p)}>{paused ? "Resume timer" : "Pause timer"}</button>
            <button type="button" className={j.btn} aria-pressed={notes} onClick={() => setNotes((v) => !v)}>Presenter notes: {notes ? "on" : "off"}</button>
            <label className={j.hint}>Skip to step{" "}
              <select className={j.sel} value={step} onChange={(e) => go(Number(e.target.value))}>
                {JOURNEY_TITLES.map((t, i) => <option key={t} value={i + 1}>{i + 1}. {t}</option>)}
              </select>
            </label>
            <button type="button" className={j.btn} onClick={() => void start()}>Reset journey</button>
          </div>
        </div>

        {note && <div className={j.banner} role="status"><strong>Fallback mode.</strong> {note} <button type="button" className={j.linkBtn} onClick={() => { flags.current = { forceFallback: false, forceFail: false }; void start(); }}>Try live data again</button></div>}

        {notes && (
          <aside className={j.notes} aria-label="Presenter notes">
            <h3>Speaker script, step {step}: about {estimateSeconds(NOTES[step - 1])} seconds ({wordCount(NOTES[step - 1])} words). On this step for {clock(stepElapsed)} of {clock(STEP_TARGET_SECONDS)}.</h3>
            <p>{NOTES[step - 1]}</p>
          </aside>
        )}

        <header className={j.head}>
          <div className={j.kicker}>Step {step} of {JOURNEY_STEPS}</div>
          <h2>{JOURNEY_TITLES[step - 1]}</h2>
          <div className={j.badges}>{copy.badges.map((b) => <Feature key={b}>{b}</Feature>)}</div>
          <p className={j.caption}>{copy.caption}</p>
        </header>

        <SafeScreen key={`${runId}-${step}`} step={step} data={data} onJump={go} />

        <aside className={j.notice}><h3>What to notice</h3><ul>{copy.notice.map((x) => <li key={x}>{x}</li>)}</ul></aside>

        <div className={j.nav}>
          <button type="button" className={j.btn} onClick={() => go(step - 1)} disabled={step === 1}>Back</button>
          {step < JOURNEY_STEPS ? <button type="button" className={j.btnPrimary} onClick={() => go(step + 1)}>Next</button> : <button type="button" className={j.btnPrimary} onClick={() => void start()}>Restart the journey</button>}
          <span className={j.hint}>Keyboard: ← Back, → Next. {journeyProblems(data).length === 0 ? "" : "Some content is incomplete."}</span>
        </div>
      </div>
    </div>
  );
}
