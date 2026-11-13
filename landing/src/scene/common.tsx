// Shared 3D building blocks: glass document cards, billboard labels, growing tubes.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { CanvasTexture, Color, CatmullRomCurve3, TubeGeometry, Vector3, type Group, type Texture, type Mesh, type Curve } from "three";

/** Create a texture once and dispose of it when the component unmounts (chapters mount lazily). */
export function useTex<T extends Texture | { map: Texture }>(make: () => T): T {
  const t = useMemo(make, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { ((t as { map?: Texture }).map ?? (t as Texture)).dispose(); }, [t]);
  return t;
}

/** A list of textures (or labels with a map), disposed together on unmount. */
export function useTexList<T extends Texture | { map: Texture }>(make: () => T[]): T[] {
  const list = useMemo(make, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => list.forEach((t) => ((t as { map?: Texture }).map ?? (t as Texture)).dispose()), [list]);
  return list;
}

/** HDR colour: values above 1 cross the bloom threshold, so only "active" elements glow. */
export const hdr = (hex: string, k: number) => new Color(hex).multiplyScalar(k);

/** Soft rounded-rectangle halo shared by every glowing card (one small texture, made once). */
let haloTex: CanvasTexture | undefined;
function halo() {
  if (haloTex) return haloTex;
  const cv = document.createElement("canvas"); cv.width = 200; cv.height = 250;
  const ctx = cv.getContext("2d")!;
  ctx.filter = "blur(16px)"; ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.roundRect(40, 40, 120, 170, 10); ctx.fill();
  ctx.filter = "none"; ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath(); ctx.roundRect(46, 46, 108, 158, 6); ctx.fill();
  haloTex = new CanvasTexture(cv);
  return haloTex;
}

export const GLASS = { color: "#0e1626", roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 1.1 };

interface CardProps { map: Texture; w?: number; h?: number; glow?: string; glowRef?: React.Ref<Mesh>; children?: ReactNode; opacity?: number }
/** A thin glass slab with a drawn face. Children are placed in face space (z just above the face). */
export function Card({ map, w = 1.6, h = 2.1, glow, glowRef, children, opacity = 0.94 }: CardProps) {
  return (
    <group>
      {glow && (
        <mesh ref={glowRef} position={[0, 0, -0.04]}>
          <planeGeometry args={[w + 0.9, h + 0.9]} />
          <meshBasicMaterial map={halo()} color={hdr(glow, 1.5)} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <RoundedBox args={[w, h, 0.035]} radius={0.03} smoothness={3}>
        <meshPhysicalMaterial {...GLASS} transparent opacity={opacity} />
      </RoundedBox>
      <mesh position={[0, 0, 0.0185]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <group position={[0, 0, 0.022]}>{children}</group>
    </group>
  );
}

/** Rounded highlight cell over a document row; colour and opacity are driven by the parent each frame. */
export function Cell({ x, y, w, h, color, cellRef }: { x: number; y: number; w: number; h: number; color: string; cellRef: React.Ref<Mesh> }) {
  return (
    <mesh ref={cellRef} position={[x, y, 0.002]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial color={hdr(color, 1.25)} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** A plane that always faces the camera. */
export function Billboard({ children, ...p }: { children: ReactNode; position?: [number, number, number] }) {
  const g = useRef<Group>(null);
  useFrame(({ camera }) => { g.current?.quaternion.copy(camera.quaternion); });
  return <group ref={g} {...p}>{children}</group>;
}

export function Label({ map, aspect, height = 0.32, position, align = "center" }: { map: Texture; aspect: number; height?: number; position?: [number, number, number]; align?: "left" | "center" }) {
  const w = height * aspect;
  return (
    <mesh position={position}>
      <planeGeometry args={[w, height]} />
      <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
      {align === "left" && null}
    </mesh>
  );
}

/** Tube along points whose visible length is set by `progress` through the draw range (thick, bloom-friendly lines). */
export function useTube(points: Vector3[] | Curve<Vector3>, radius = 0.012, segments = 96) {
  const geo = useMemo(() => {
    const curve = Array.isArray(points) ? new CatmullRomCurve3(points, false, "centripetal") : points;
    return new TubeGeometry(curve, segments, radius, 6, false);
  }, [points, radius, segments]);
  useEffect(() => () => geo.dispose(), [geo]);
  const total = geo.index ? geo.index.count : 0;
  const setProgress = (p: number) => geo.setDrawRange(0, Math.floor((total / 6) * Math.max(0, Math.min(1, p))) * 6);
  return { geo, setProgress };
}
