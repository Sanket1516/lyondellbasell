"use client";
import { useEffect, useState } from "react";

// Same key as the landing page, so one choice holds across "/" and the app (same origin).
export const THEME_KEY = "plantpay-landing-theme";
type Theme = "dark" | "light";

const read = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
function saved(): Theme | null {
  try { const v = localStorage.getItem(THEME_KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}

/** Light/dark switch. The theme itself is set before first paint by the inline script in app/layout.tsx. */
export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(read());
    // Follow the system setting until the viewer picks a theme.
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => {
      if (saved()) return;
      const t: Theme = e.matches ? "light" : "dark";
      document.documentElement.dataset.theme = t;
      setTheme(t);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const toggle = () => {
    const next: Theme = read() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: the choice lasts for this page only */ }
    setTheme(next);
  };

  const light = theme === "light";
  const label = light ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} title={label}>
      {light ? (
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      )}
    </button>
  );
}
