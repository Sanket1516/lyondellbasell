import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CHAPTERS, ROLES, S, demoHref, inr, type Chapter, type Counter } from "./content";
import { story } from "./scene/motion";
import { grainDataUrl } from "./grain";
import { LiteArt } from "./lite/LiteArt";
import type { SceneProps } from "./scene/Scene";
import css from "./App.module.css";

gsap.registerPlugin(ScrollTrigger);

type Mode = "3d" | "lite";
export type Theme = "dark" | "light";
const params = new URLSearchParams(location.search);
const FPS_GUARD = params.get("fpsguard") !== "0";
const LAST = CHAPTERS.length - 1;

function webglOk(): boolean {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
function saved(): Mode | null { try { const v = localStorage.getItem("plantpay-landing-mode"); return v === "3d" || v === "lite" ? v : null; } catch { return null; } }
function save(m: Mode) { try { localStorage.setItem("plantpay-landing-mode", m); } catch { /* storage blocked: fine */ } }

function initial(): { mode: Mode; reason?: string } {
  if (params.get("lite") === "1") return { mode: "lite" };
  const gl = webglOk();
  if (!gl) return { mode: "lite", reason: "3D is not available in this browser, so you are seeing Lite mode. The story is the same." };
  if (params.get("lite") === "0") return { mode: "3d" };
  const s = saved();
  if (s) return { mode: s };
  if (reducedMotion()) return { mode: "lite", reason: "Lite mode is on because your system asks for reduced motion." };
  return { mode: "3d" };
}

// The theme is set on <html> before first paint (index.html); an explicit choice is saved, otherwise it follows the system.
const THEME_KEY = "plantpay-landing-theme";
const currentTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
function savedTheme(): Theme | null { try { const v = localStorage.getItem(THEME_KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; } }

const fmt = (c: Counter, v: number) => `${c.prefix ?? ""}${inr(v, c.decimals ?? 0)}${c.suffix ?? ""}`;

function Copy({ ch, i }: { ch: Chapter; i: number }) {
  const H = i === 0 ? "h1" : "h2";
  return (
    <div className={css.copy} data-copy>
      <p className={css.eyebrow}>{ch.eyebrow}</p>
      <H className={i === 0 ? css.display : css.headline} id={`h-${ch.id}`}>{ch.headline}</H>
      <p className={css.caption}>{ch.caption}</p>
      {ch.id === "cause" && (
        <>
          <ol className={css.chain} aria-label="Root cause">
            <li>Contract amended</li><li>PO not updated</li><li>{S.rootCause.responsible.department} buyer to fix</li>
          </ol>
          <blockquote className={css.quote}>{S.rootCause.counterfactual}</blockquote>
        </>
      )}
      {ch.counters && (
        <dl className={css.counters}>
          {ch.counters.map((c, k) => (
            <div key={k} className={css.counter} data-tone={c.tone}>
              <dt className={css.counterValue} data-count={c.value} data-fmt={k}>{fmt(c, c.value)}</dt>
              <dd className={css.counterLabel}>{c.label}</dd>
            </div>
          ))}
        </dl>
      )}
      {ch.tag && <p className={css.tag} data-tone={ch.tag.tone}>{ch.tag.text}</p>}
      {i === 0 && <p className={css.hint} aria-hidden="true"><span className={css.hintLine} />Scroll to follow the invoice</p>}
    </div>
  );
}

export default function App() {
  const init = useRef(initial());
  const [mode, setModeState] = useState<Mode>(init.current.mode);
  const [notice, setNotice] = useState<string | undefined>(init.current.reason);
  const [progress, setProgress] = useState(0.05);
  const [ready, setReady] = useState(false);
  const [Scene, setScene] = useState<ComponentType<SceneProps> | null>(null);
  const [active, setActive] = useState(0);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const lenis = useRef<Lenis | null>(null);
  const mids = useRef<number[]>([]);
  const activeRef = useRef(0);
  const restoreTo = useRef<number | null>(null);
  const grain = useRef(grainDataUrl());

  const setMode = useCallback((m: Mode, why?: string) => {
    restoreTo.current = activeRef.current;
    setModeState(m);
    setNotice(why);
  }, []);

  // ---------------------------------------------------------------- scroll position -> chapter coordinate
  const measure = useCallback(() => {
    mids.current = sections.current.map((s) => (s ? s.offsetTop + s.offsetHeight / 2 : 0));
  }, []);
  const onScroll = useCallback(() => {
    const m = mids.current;
    if (!m.length) return;
    const center = window.scrollY + window.innerHeight / 2;
    let c = 0;
    if (center <= m[0]) c = 0;
    else if (center >= m[LAST]) c = LAST;
    else for (let i = 0; i < LAST; i++) if (center < m[i + 1]) { c = i + (center - m[i]) / (m[i + 1] - m[i]); break; }
    story.target = c;
    const a = Math.round(c);
    if (a !== activeRef.current) { activeRef.current = a; setActive(a); }
  }, []);
  const goTo = useCallback((i: number, immediate = false) => {
    const s = sections.current[i];
    if (!s) return;
    const y = i === 0 ? 0 : i === LAST ? s.offsetTop : s.offsetTop + s.offsetHeight / 2 - window.innerHeight / 2;
    if (lenis.current) lenis.current.scrollTo(y, { immediate, duration: immediate ? 0 : 1.6, force: true });
    else window.scrollTo({ top: y, behavior: immediate || reducedMotion() ? "auto" : "smooth" });
    if (immediate) { story.target = i; story.c = i; }
  }, []);

  // ---------------------------------------------------------------- smooth scrolling (Lenis) driving ScrollTrigger
  useEffect(() => {
    document.getElementById("boot")?.remove();
    const smooth = !reducedMotion();
    let raf: ((t: number) => void) | undefined;
    if (smooth) {
      const l = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.9 });
      lenis.current = l;
      l.on("scroll", () => { ScrollTrigger.update(); onScroll(); });
      raf = (t: number) => l.raf(t * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
    }
    const native = () => { if (!smooth) { ScrollTrigger.update(); onScroll(); } };
    window.addEventListener("scroll", native, { passive: true });
    const ro = new ResizeObserver(() => { measure(); onScroll(); });
    ro.observe(document.body);
    const move = (e: PointerEvent) => { story.pointerX = (e.clientX / window.innerWidth - 0.5) * 2; story.pointerY = (e.clientY / window.innerHeight - 0.5) * 2; };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("scroll", native); window.removeEventListener("pointermove", move); ro.disconnect();
      if (raf) gsap.ticker.remove(raf);
      lenis.current?.destroy(); lenis.current = null;
    };
  }, [measure, onScroll]);

  // ---------------------------------------------------------------- loading: fonts, then the 3D chunk, then the first frames
  useEffect(() => {
    let alive = true;
    (async () => {
      const fonts = document.fonts
        ? Promise.all([
            document.fonts.load('600 48px "Archivo Variable"', "INV ₹ 0123"),
            document.fonts.load('500 16px "Inter Variable"', "Aa ₹ 0123 · →"),
            document.fonts.load('600 16px "Inter Variable"', "Aa ₹"),
            document.fonts.load('400 16px "Spline Sans Mono"', "0123 abcdef"),
          ])
        : Promise.resolve();
      await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);
      if (!alive) return;
      setProgress(0.4);
      if (mode !== "3d") { setProgress(1); setReady(true); return; }
      try {
        const mod = await import("./scene/Scene");
        if (!alive) return;
        setScene(() => mod.default);
        setProgress(0.75);
      } catch {
        setMode("lite", "The 3D scene could not load, so you are seeing Lite mode. The story is the same.");
        setProgress(1); setReady(true);
      }
    })();
    return () => { alive = false; };
  }, [mode, setMode]);

  useEffect(() => {
    if (mode !== "3d" || ready) return;
    const t = setTimeout(() => { setMode("lite", "3D took too long to start on this device, so you are seeing Lite mode."); setReady(true); }, 12000);
    return () => clearTimeout(t);
  }, [mode, ready, setMode]);

  const onSceneReady = useCallback(() => { setProgress(1); setReady(true); }, []);
  const onLowFps = useCallback(() => setMode("lite", "Switched to Lite mode: the 3D scene ran below 30 frames per second here."), [setMode]);

  // ---------------------------------------------------------------- per-chapter text timelines (3D) or reveals (Lite)
  useLayoutEffect(() => {
    measure();
    const ctx = gsap.context(() => {
      if (mode !== "3d") return;
      sections.current.forEach((sec, i) => {
        if (!sec || i === LAST) return;
        const copy = sec.querySelector<HTMLElement>("[data-copy]");
        if (!copy) return;
        const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: 0.4 } });
        tl.fromTo(copy, { autoAlpha: 0, y: 46 }, { autoAlpha: 1, y: 0, duration: 0.14, ease: "power2.out" }, 0.25)
          .to(copy, { autoAlpha: 0, y: -46, duration: 0.14, ease: "power2.in" }, 0.61)
          .set({}, {}, 1);
        const ch = CHAPTERS[i];
        copy.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
          const c = ch.counters![Number(el.dataset.fmt)];
          const o = { v: 0 };
          tl.to(o, { v: c.value, duration: 0.2, ease: "power1.out", onUpdate: () => { el.textContent = fmt(c, Math.round(o.v)); } }, 0.28);
        });
      });
    });
    ScrollTrigger.refresh();
    measure();
    if (restoreTo.current !== null) { const r = restoreTo.current; restoreTo.current = null; requestAnimationFrame(() => { measure(); goTo(r, true); }); }
    else onScroll();
    return () => ctx.revert();
  }, [mode, measure, onScroll, goTo]);

  useEffect(() => {
    if (mode !== "lite") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add("in"); }), { threshold: 0.2 });
    sections.current.forEach((s) => s && io.observe(s));
    return () => io.disconnect();
  }, [mode]);

  // ---------------------------------------------------------------- test and presenter hooks
  useEffect(() => {
    const w = window as unknown as { __story: Record<string, unknown> };
    w.__story = { ...(w.__story ?? {}), goTo, chapters: CHAPTERS.length, mode, ready, theme, c: () => story.c, setMode: (m: Mode) => setMode(m), setTheme: (t: Theme) => setTheme(t) };
    document.documentElement.dataset.ready = ready ? "1" : "0";
    document.documentElement.dataset.mode = mode;
  }, [goTo, mode, ready, setMode, theme]);

  // ---------------------------------------------------------------- theme: apply, and follow the system until the viewer picks one
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => { if (!savedTheme() && !params.get("theme")) setTheme(e.matches ? "light" : "dark"); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: fine */ }
    setTheme(next);
  };

  const toggleLite = () => {
    const next: Mode = mode === "lite" ? "3d" : "lite";
    if (next === "3d" && !webglOk()) { setNotice("3D is not available in this browser."); return; }
    save(next);
    if (next === "3d") { setReady(false); setProgress(0.4); }
    setMode(next);
  };

  return (
    <div className={css.root} data-mode={mode}>
      <a className={css.skip} href="#live-demo">Skip to the live demo</a>
      <header className={css.bar}>
        <a className={css.brand} href="#hero" onClick={(e) => { e.preventDefault(); goTo(0); }}>
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect x="8" y="5" width="16" height="22" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M12 12h8M12 17h5" stroke="currentColor" strokeWidth="2.4" /></svg>
          PlantPay
        </a>
        <div className={css.barRight}>
          <button type="button" className={css.themeBtn} onClick={toggleTheme} aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"} title={theme === "light" ? "Dark mode" : "Light mode"}>
            {theme === "light" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            )}
          </button>
          <button type="button" className={css.lite} aria-pressed={mode === "lite"} onClick={toggleLite}>
            <span className={css.switch} aria-hidden="true" />Lite mode
          </button>
          <a className={css.barCta} href="#live-demo" onClick={(e) => { e.preventDefault(); goTo(LAST); document.getElementById("journey-cta")?.focus({ preventScroll: true }); }}>Live demo</a>
        </div>
      </header>

      {mode === "3d" && Scene && (
        <div className={css.stage} aria-hidden="true">
          {/* Keyed by theme: textures are drawn once per mount, so a theme change remounts the canvas with the new palette. */}
          <Scene key={theme} theme={theme} onReady={onSceneReady} onLowFps={onLowFps} fpsGuard={FPS_GUARD} />
        </div>
      )}
      <div className={css.grain} aria-hidden="true" style={{ backgroundImage: `url(${grain.current})` }} />
      {/* One shared scrim under the chapter text on narrow screens (per-chapter scrims would stack over the active text). */}
      <div className={css.scrim} aria-hidden="true" />

      <nav className={css.rail} aria-label="Story chapters">
        <ol>
          {CHAPTERS.map((ch, i) => (
            <li key={ch.id}>
              <button type="button" onClick={() => goTo(i)} aria-current={active === i ? "step" : undefined} aria-label={`Chapter ${i + 1} of ${CHAPTERS.length}: ${ch.nav}`}>
                <span className={css.railLabel}>{ch.nav}</span><span className={css.railTick} />
              </button>
            </li>
          ))}
        </ol>
        <div className={css.railCount} aria-hidden="true">{String(active).padStart(2, "0")} / {String(LAST).padStart(2, "0")}</div>
      </nav>

      <main>
        {CHAPTERS.slice(0, LAST).map((ch, i) => (
          <section key={ch.id} id={ch.id} ref={(el) => { sections.current[i] = el; }} className={css.section} aria-labelledby={`h-${ch.id}`}>
            <div className={css.copyWrap}><Copy ch={ch} i={i} /></div>
            {mode === "lite" && <div className={css.art}><LiteArt i={i} theme={theme} /></div>}
            <p className={css.srOnly}>{ch.alt}</p>
          </section>
        ))}
        <section id="live-demo" ref={(el) => { sections.current[LAST] = el; }} className={css.cta} aria-labelledby="h-cta">
          <div className={css.ctaInner}>
            <p className={css.eyebrow}>{CHAPTERS[LAST].eyebrow}</p>
            <h2 className={css.display} id="h-cta">{CHAPTERS[LAST].headline}</h2>
            <p className={css.caption}>{CHAPTERS[LAST].caption}</p>
            <a id="journey-cta" className={css.primary} href={demoHref("clerk", "/plantpay/journey")}>
              <span className={css.primaryTitle}>Start the Golden Journey</span>
              <span className={css.primarySub}>Nine guided steps on {S.hero.id}, as {ROLES[1].who}, AP Clerk</span>
              <span className={css.arrow} aria-hidden="true">→</span>
            </a>
            <ul className={css.roles}>
              {ROLES.map((r) => (
                <li key={r.role}>
                  <a className={css.role} href={demoHref(r.role)}>
                    <span className={css.roleTitle}>{r.title}</span>
                    <span className={css.roleWho}>{r.who}</span>
                    <span className={css.roleWhat}>{r.what}</span>
                    <span className={css.arrow} aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className={css.creds}>
              Each button signs you in with a demo account. To sign in by hand at <a href="/login">/login</a>:{" "}
              {ROLES.map((r, k) => <Fragment key={r.user}>{k > 0 && " · "}<code>{r.user}</code> / <code>{r.pass}</code></Fragment>)}
            </p>
          </div>
          <footer className={css.footer}>
            Prototype for the LYB Mumbai Hackathon 2026. Synthetic data and fictional companies only; amounts in INR.
            Verdicts come from deterministic rules.
          </footer>
        </section>
      </main>

      {!ready && (
        <div className={css.loader} role="progressbar" aria-label="Loading the story" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className={css.loaderInner}>
            <div className={css.loaderBrand}>PlantPay</div>
            <div className={css.loaderTrack}><div className={css.loaderFill} style={{ transform: `scaleX(${progress})` }} /></div>
            <div className={css.loaderText}>{progress < 0.4 ? "Loading fonts" : progress < 0.75 ? "Loading the 3D engine" : "Preparing the scene"} · {Math.round(progress * 100)}%</div>
          </div>
        </div>
      )}
      {notice && ready && (
        <div className={css.toast} role="status">
          <span>{notice}</span>
          {mode === "lite" && webglOk() && <button type="button" onClick={() => { save("3d"); setReady(false); setProgress(0.4); setMode("3d"); }}>Try 3D</button>}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(undefined)}>×</button>
        </div>
      )}
    </div>
  );
}
