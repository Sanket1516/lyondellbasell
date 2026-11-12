"use client";
// If a journey screen throws while drawing live data, the same step is drawn from the pre-computed copy instead of an error page.
// If that fails too, a short message with a way forward is shown. Never a stack trace.
import { Component, useEffect, useState, type ReactNode } from "react";
import type { JourneyData } from "@/plantpay/journey/types";
import Screen from "./Screens";
import j from "./Journey.module.css";

class Boundary extends Component<{ alt: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn("Journey screen fell back to the pre-computed copy:", e); }
  render() { return this.state.failed ? this.props.alt : this.props.children; }
}

const Stuck = () => <p className={j.banner} role="status">This step could not be drawn. Use Next to continue, or Reset journey to start again.</p>;

function FallbackScreen({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  const [data, setData] = useState<JourneyData | null>(null);
  useEffect(() => { void import("@/plantpay/journey/fallback.json").then((m) => setData({ ...(m.default as unknown as JourneyData), mode: "fallback" })); }, []);
  if (!data) return <p className={j.loading} role="status">Loading the pre-computed result for this step…</p>;
  return (
    <>
      <p className={j.banner} role="status"><strong>Fallback mode.</strong> This step is shown from the pre-computed results of an earlier run.</p>
      <Screen step={step} data={data} onJump={onJump} />
    </>
  );
}

/** Live screen first; on a render error, the pre-computed screen; on a second error, a short message. */
export default function SafeScreen({ step, data, onJump }: { step: number; data: JourneyData; onJump: (n: number) => void }) {
  const alt = data.mode === "fallback" ? <Stuck /> : <Boundary alt={<Stuck />}><FallbackScreen step={step} onJump={onJump} /></Boundary>;
  return <Boundary alt={alt}><Screen step={step} data={data} onJump={onJump} /></Boundary>;
}
