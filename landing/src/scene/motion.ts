// Scroll-to-story mapping and the small amount of maths every scene part shares.
// `story.target` is written by the scroll handler (chapter coordinate: 0 = hero settled, 1 = problem settled, ...).
// `story.c` is the damped value the scene renders. Everything in the scene is a pure function of `story.c`,
// so scrolling back plays the story backwards and nothing moves on its own.
export const story = { target: 0, c: 0, pointerX: 0, pointerY: 0 };

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 before a, 1 after b, linear between. */
export const seg = (c: number, a: number, b: number) => clamp01((c - a) / (b - a));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeBack = (t: number) => { const s = 1.4; const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
/** Frame-rate independent damping. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Visibility of chapter i: fades in over [i-0.62, i-0.3], fully on around i, fades out over [i+0.3, i+0.62]. */
export function vis(c: number, i: number): number {
  return easeInOut(seg(c, i - 0.62, i - 0.3)) * (1 - easeInOut(seg(c, i + 0.3, i + 0.62)));
}
/** Entrance (0..1) and exit (0..1) progress of chapter i. */
export const enter = (c: number, i: number) => easeOut(seg(c, i - 0.7, i - 0.2));
export const exit = (c: number, i: number) => easeInOut(seg(c, i + 0.25, i + 0.7));
/** The chapter's own action, scrubbed while its text is on screen. */
export const act = (c: number, i: number, a = -0.3, b = 0.3) => seg(c, i + a, i + b);

/** Deterministic PRNG (mulberry32) so every load lays out the same piles, graphs and particles. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sets opacity on every material under an object, relative to each material's design opacity. */
import type { Object3D, Material } from "three";
export function fade(obj: Object3D | null, o: number) {
  if (!obj) return;
  obj.visible = o > 0.003;
  if (!obj.visible) return;
  obj.traverse((n) => {
    const m = (n as unknown as { material?: Material | Material[] }).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (mat.userData.base === undefined) { mat.userData.base = mat.opacity; mat.transparent = true; }
      mat.opacity = mat.userData.base * o;
    }
  });
}
