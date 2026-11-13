// The one pinned 3D canvas. Loaded as a separate chunk so the page paints before three.js arrives.
// Quality: pixel ratio capped at 1.5, dropped to 1 (and multisampling off) when the frame rate declines; if it stays under
// 30 fps the page hands over to Lite mode. Chapter scenery mounts only near its chapter.
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Grid, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Vector3, type PerspectiveCamera } from "three";
import { HeroInvoice, Particles } from "./Hero";
import { Approval, Documents, Intelligence, Paid, Problem, Risk, Sources, Trust, Upload } from "./Chapters";
import { damp, easeInOut, lerp, seg, story } from "./motion";

/** Camera rest pose per chapter: [position, look-at]. */
// Distances follow a fit budget: at 1440 x 900 each chapter's content stays within about 370 px either side of the scene centre,
// which sits between the text column and the chapter rail.
const CAM: [number, number, number, number, number, number][] = [
  [0, 0.1, 6.4, 0, 0, 0],
  [0, 1.9, 8.3, 0, 0.0, 0],
  [0.2, 0.1, 7.2, 0.15, 0, 0],
  [0, 3.1, 8.9, 0, -0.2, 0],
  [0, 0.3, 9.4, 0, 0.05, 0],
  [0.3, 0.4, 9.4, 0.1, 0.1, 0],
  [0, 0.5, 8.9, 0, 0, 0],
  [0, 0.8, 8.9, 0, -0.3, 0],
  [0, 0.2, 9.2, 0, 0.05, 0],
  [0, 1.0, 8.8, 0, -0.1, 0],
  [0, 0.3, 9.8, 0, 0.1, 0],
  [0, 0.7, 9.6, 0, 0.35, 0],
];
const PARTS: { from: number; to: number; C: ComponentType }[] = [
  { from: 1, to: 1, C: Problem }, { from: 2, to: 2, C: Upload }, { from: 3, to: 3, C: Sources }, { from: 4, to: 5, C: Documents },
  { from: 6, to: 6, C: Risk }, { from: 7, to: 7, C: Approval }, { from: 8, to: 8, C: Intelligence }, { from: 9, to: 9, C: Trust }, { from: 10, to: 10, C: Paid },
];

function Rig() {
  const { camera, size } = useThree();
  const pos = useRef(new Vector3()), look = useRef(new Vector3()), px = useRef(0), py = useRef(0);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    story.c = damp(story.c, story.target, 7, d);
    if (Math.abs(story.c - story.target) < 1e-4) story.c = story.target;
    const c = story.c, i = Math.max(0, Math.min(11, Math.floor(c)));
    const b = easeInOut(seg(c - i, 0.25, 0.75));
    const a = CAM[i], z = CAM[Math.min(11, i + 1)];
    const narrow = size.width < 1000;
    const far = narrow ? 1 + Math.min(0.9, (1000 - size.width) / 700) : 1;
    pos.current.set(lerp(a[0], z[0], b), lerp(a[1], z[1], b), lerp(a[2], z[2], b) * far);
    look.current.set(lerp(a[3], z[3], b), lerp(a[4], z[4], b), lerp(a[5], z[5], b));
    // scroll-driven drift and a little pointer parallax (damped); nothing moves on its own
    px.current = damp(px.current, story.pointerX, 3, d); py.current = damp(py.current, story.pointerY, 3, d);
    pos.current.x += Math.sin(c * 1.3) * 0.18 + px.current * 0.25;
    pos.current.y += Math.cos(c * 0.9) * 0.1 - py.current * 0.15;
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    // leave the left column for the chapter text on wide screens; centre the final chapter
    const cam = camera as PerspectiveCamera;
    const off = narrow ? 0 : -size.width * 0.14 * (1 - seg(c, 10.4, 10.9));
    if (!cam.view || Math.abs(cam.view.offsetX - off) > 0.5 || cam.view.fullWidth !== size.width || cam.view.fullHeight !== size.height) {
      cam.setViewOffset(size.width, size.height, off, narrow ? size.height * 0.12 : 0, size.width, size.height);
    }
  });
  return null;
}

/** Mounts each chapter's scenery only while the story is within one chapter of it. */
function Chapters() {
  const [near, setNear] = useState("0");
  const key = useRef("0");
  useFrame(() => {
    const c = story.c;
    const k = PARTS.map((p, j) => (c > p.from - 1.05 && c < p.to + 1.05 ? j : -1)).filter((j) => j >= 0).join(",");
    if (k !== key.current) { key.current = k; setNear(k); }
  });
  const on = new Set(near.split(",").filter(Boolean).map(Number));
  return <>{PARTS.map((p, j) => (on.has(j) ? <p.C key={j} /> : null))}</>;
}

/** Frame-rate guard: after warm-up, three consecutive seconds under 30 fps at the lowest quality hands over to Lite mode. */
function FpsGuard({ low, onLowFps, enabled }: { low: boolean; onLowFps: () => void; enabled: boolean }) {
  const acc = useRef({ frames: 0, t: 0, bad: 0, since: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.since += dt;
    if (!enabled || a.since < 4 || document.visibilityState !== "visible") return;
    a.frames++; a.t += dt;
    if (a.t >= 1) {
      const fps = a.frames / a.t;
      a.bad = fps < 30 ? a.bad + 1 : 0;
      a.frames = 0; a.t = 0;
      if (a.bad >= 3 && low) onLowFps();
    }
  });
  return null;
}

function Ready({ onReady }: { onReady: () => void }) {
  const { gl, scene, camera } = useThree();
  const n = useRef(0), done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    if (++n.current === 3) { gl.compile(scene, camera); }
    if (n.current >= 6) { done.current = true; onReady(); }
  });
  return null;
}

export interface SceneProps { onReady: () => void; onLowFps: () => void; fpsGuard: boolean }
export default function Scene({ onReady, onLowFps, fpsGuard }: SceneProps) {
  const [low, setLow] = useState(false);
  const [dpr, setDpr] = useState(Math.min(1.5, window.devicePixelRatio || 1));
  useEffect(() => {
    const info = (window as unknown as { __story?: Record<string, unknown> }).__story;
    if (info) info.quality = low ? "low" : "high";
  }, [low]);
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: 36, near: 0.1, far: 60, position: [0, 0.1, 6.2] }}
      onCreated={({ gl }) => {
        gl.setClearColor("#05070d");
        const ext = gl.getContext();
        const dbg = ext.getExtension("WEBGL_debug_renderer_info");
        const w = window as unknown as { __story?: Record<string, unknown> };
        if (w.__story) w.__story.renderer = dbg ? ext.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown";
      }}
    >
      <PerformanceMonitor onDecline={() => { setLow(true); setDpr(1); }} flipflops={2} onFallback={() => { setLow(true); setDpr(1); }} />
      <fog attach="fog" args={["#05070d", 9, 22]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} color="#dfe8ff" />
      <pointLight position={[-4, 1, -3]} intensity={18} color="#3d8bff" distance={14} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 4, 3]} scale={[8, 1.2, 1]} color="#cfe0ff" />
        <Lightformer form="rect" intensity={1.4} position={[-5, 0.5, -2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} color="#3d8bff" />
        <Lightformer form="ring" intensity={1.2} position={[4, 1, -4]} scale={2} color="#7fb3ff" />
      </Environment>
      <Grid position={[0, -2.35, 0]} args={[40, 40]} cellSize={0.5} cellThickness={0.6} cellColor="#101a2b" sectionSize={2.5} sectionThickness={1} sectionColor="#18294a" fadeDistance={20} fadeStrength={1.6} infiniteGrid followCamera={false} />
      <Rig />
      <Particles count={low ? 700 : 1400} />
      <HeroInvoice />
      <Chapters />
      <EffectComposer multisampling={low ? 0 : 4} enableNormalPass={false}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.72} />
        <Vignette offset={0.28} darkness={0.72} />
      </EffectComposer>
      <FpsGuard low={low} onLowFps={onLowFps} enabled={fpsGuard} />
      <Ready onReady={onReady} />
    </Canvas>
  );
}
