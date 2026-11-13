// The one invoice that travels through every chapter, plus the particle field.
// Its pose is a pure function of the chapter coordinate c: pose(i) is where it rests in chapter i, and between chapters it
// blends from one rest pose to the next while the chapter text is off screen.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, NormalBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, type Group, type Mesh, type MeshBasicMaterial, type Points } from "three";
import { Card, Cell, hdr, useTex } from "./common";
import { act, easeInOut, easeOut, fade, lerp, rng, seg, story } from "./motion";
import { C, COL, COLS, ROWS, colX, invoiceTexture, isLight, rowY, stampTexture } from "./textures";
import { APPROVER, day, S } from "../content";

interface Pose { p: [number, number, number]; r: [number, number, number]; s: number; o: number }
const P = (p: [number, number, number], s = 1, o = 1, r: [number, number, number] = [0, 0, 0]): Pose => ({ p, r, s, o });

function rest(i: number, c: number, t: number): Pose {
  switch (i) {
    case 0: return P([0.15, 0.05, 0], 1, 1, [-0.1 + Math.sin(t * 0.27) * 0.06, -0.35 + Math.sin(t * 0.35) * 0.32 - c * 0.6, 0.02]);
    case 1: return P([0, 1.7, -1.8], 0.6, 0.5, [0.12, 0.25, 0]);
    case 2: return P([-0.85, 0, 0.4], 1, 1, [0, 0.12, 0]);
    case 3: return P([0.2, 0, 0], 0.12, 0, [0, 1.6, 0]);
    case 4: case 5: return P([-1.8, 0, 0], 0.86, 1, [0, 0.16, 0]);
    case 6: return P([-2.4, 0.2, -3.5], 0.6, 0, [0, 0.4, 0]);
    case 7: { const k = easeInOut(act(c, 7, -0.45, 0.02)); return P([lerp(-2.55, 2.25, k), 0.12, 0.05], 0.42, 1, [0, -0.08 + 0.1 * Math.sin(k * Math.PI), 0]); }
    case 8: return P([3.2, 0.3, -3], 0.4, 0, [0, -0.3, 0]);
    case 9: return P([0, 2.4, -4], 0.4, 0, [0, 0, 0]);
    case 10: return P([0.05, 0.42, 0], 0.62, 1, [0, -0.06, 0]);
    default: return P([0.2, 0.5, -1.6], 0.55, 0.3, [0, Math.sin(t * 0.3) * 0.4, 0]);
  }
}
function pose(c: number, t: number): Pose {
  const i = Math.max(0, Math.min(11, Math.floor(c)));
  const b = easeInOut(seg(c - i, 0.3, 0.72));
  const a = rest(i, c, t), z = rest(Math.min(11, i + 1), c, t);
  const m = (x: number, y: number) => lerp(x, y, b);
  return { p: [m(a.p[0], z.p[0]), m(a.p[1], z.p[1]), m(a.p[2], z.p[2])], r: [m(a.r[0], z.r[0]), m(a.r[1], z.r[1]), m(a.r[2], z.r[2])], s: m(a.s, z.s), o: m(a.o, z.o) };
}

const RED = COL.bad, GREEN = COL.ok;
export function HeroInvoice() {
  const g = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const price = useRef<Mesh>(null);
  const qty = useRef<Mesh>(null);
  const stamp = useRef<Mesh>(null);
  const map = useTex(invoiceTexture);
  const stampMap = useTex(() => stampTexture([`${APPROVER.name} · L1`, day(S.approval.approvedOn)]));
  useFrame(({ clock }) => {
    const c = story.c, o = g.current;
    if (!o) return;
    const q = pose(c, clock.elapsedTime);
    o.position.set(...q.p); o.rotation.set(...q.r); o.scale.setScalar(q.s);
    fade(o, q.o);
    // chapter 4: price cell red, qty cell amber; chapter 5: price resolves to green
    const on4 = seg(c, 3.85, 4.05) * (1 - seg(c, 5.55, 5.8));
    const toGreen = seg(c, 4.75, 4.86);
    if (price.current) {
      const m = price.current.material as MeshBasicMaterial;
      m.color.copy(RED).lerp(GREEN, toGreen).multiplyScalar(1.25);
      m.opacity = 0.42 * on4 * q.o;
    }
    if (qty.current) (qty.current.material as MeshBasicMaterial).opacity = 0.32 * seg(c, 3.9, 4.1) * (1 - seg(c, 4.6, 4.8)) * q.o;
    // approval stamp lands in chapter 7 and stays
    if (stamp.current) {
      const k = seg(c, 6.9, 6.98);
      stamp.current.scale.setScalar(lerp(1.7, 1, easeOut(k)));
      (stamp.current.material as MeshBasicMaterial).opacity = k * q.o;
      stamp.current.visible = k > 0.01;
    }
    // active glow: reading, matching and approval
    if (glow.current) {
      const a = Math.max(seg(c, 1.6, 2) * (1 - seg(c, 2.4, 2.7)), seg(c, 9.6, 10) * (1 - seg(c, 10.5, 10.8)), 0.25 * (1 - seg(c, 0.3, 0.7)));
      (glow.current.material as MeshBasicMaterial).opacity = 0.55 * a * q.o;
    }
  });
  const cw = 1.6;
  return (
    <group ref={g}>
      <Card map={map} glow={C.accent} glowRef={glow}>
        <Cell cellRef={price} x={colX(COLS.rate - 60, cw)} y={rowY(ROWS[0])} w={0.36} h={0.12} color={C.bad} />
        <Cell cellRef={qty} x={colX(COLS.qty - 60, cw)} y={rowY(ROWS[2])} w={0.36} h={0.12} color={C.warn} />
        <mesh ref={stamp} position={[0.12, -0.32, 0.01]}>
          <planeGeometry args={[1.25, 0.51]} />
          <meshBasicMaterial map={stampMap} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      </Card>
    </group>
  );
}

function dotTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d")!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.5)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(cv);
}

/** Fine particle field. Dense around the hero at the start, a sparse depth cue afterwards. Laid out with a fixed seed. */
export function Particles({ count = 1400 }: { count?: number }) {
  const ref = useRef<Points>(null);
  const sprite = useTex(dotTexture);
  const geo = useMemo(() => {
    const r = rng(7);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 1.8 + Math.pow(r(), 0.7) * 6.5;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * rad * 1.4;
      pos[i * 3 + 1] = u * rad * 0.7;
      pos[i * 3 + 2] = Math.sin(th) * s * rad - 1.5;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    return g;
  }, [count]);
  useFrame(({ clock }) => {
    const p = ref.current;
    if (!p) return;
    const c = story.c;
    p.rotation.y = clock.elapsedTime * 0.012 + c * 0.22;
    p.rotation.x = c * 0.03;
    const m = p.material as unknown as { opacity: number; size: number };
    // additive specks vanish on a pale background, so light mode draws them normally and fainter
    m.opacity = (lerp(0.85, 0.32, seg(c, 0.2, 0.9)) + 0.4 * seg(c, 10.4, 11)) * (isLight ? 0.55 : 1);
    m.size = lerp(0.04, 0.028, seg(c, 0.2, 0.9));
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={sprite} color={isLight ? new Color(C.accent) : hdr(C.accentHi, 1.05)} size={0.04} sizeAttenuation transparent depthWrite={false} blending={isLight ? NormalBlending : AdditiveBlending} toneMapped={false} />
    </points>
  );
}
