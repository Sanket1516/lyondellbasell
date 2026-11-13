// Chapter scenery. Each part is mounted only while its chapter is near (see Scene.tsx) and disposes of what it made.
// Every transform below is a function of story.c; repeated meshes are instanced.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, Curve, InstancedMesh, LineBasicMaterial, LineSegments, Object3D, Quaternion, SRGBColorSpace, Vector3,
  type Group, type Mesh, type MeshBasicMaterial, type MeshPhysicalMaterial,
} from "three";
import { Billboard, Card, Cell, GLASS, hdr, Label, useTex, useTexList, useTube } from "./common";
import { act, easeBack, easeInOut, easeOut, enter, exit, fade, lerp, rng, seg, story, vis } from "./motion";
import {
  C, COLS, DOC, INTEL, ROWS, amendmentTexture, chipTexture, colX, gaugeLabelTexture, grnTexture, hashBlockTexture, intelTexture,
  labelTexture, pillTexture, poTexture, rowY,
} from "./textures";
import { APPROVER, CLERK, S, inr, rs } from "../content";

const tmp = new Object3D();
const BAD = new Color(C.bad), OK = new Color(C.ok), ACC = new Color(C.accent), DIM = new Color("#3a4a63");

// ============================================================== 1. the problem: invoices pile up, red marks appear
export function Problem() {
  const g = useRef<Group>(null);
  const slabs = useRef<InstancedMesh>(null);
  const marks = useRef<InstancedMesh>(null);
  const N = 42;
  const layout = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: N }, (_, k) => {
      const pile = k % 3, h = Math.floor(k / 3);
      const flag = r() < 0.36 ? (r() < 0.6 ? "bad" : "warn") : null;
      return { x: (pile - 1) * 1.55 + (r() - 0.5) * 0.1, y: -1.15 + h * 0.055, z: (r() - 0.5) * 0.12, ry: (r() - 0.5) * 0.5, rz: (r() - 0.5) * 0.05, d: (k / N) * 0.62, flag };
    });
  }, []);
  useEffect(() => {
    const m = marks.current!;
    layout.forEach((l, k) => m.setColorAt(k, l.flag === "bad" ? hdr(C.bad, 1.4) : l.flag === "warn" ? hdr(C.warn, 1.0) : new Color(0, 0, 0)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [layout]);
  useFrame(() => {
    const c = story.c;
    fade(g.current, vis(c, 1));
    if (!g.current?.visible) return;
    const t = seg(c, 0.45, 1.0);
    const out = exit(c, 1);
    layout.forEach((l, k) => {
      const p = easeOut(seg(t, l.d, l.d + 0.28));
      tmp.position.set(l.x, l.y + (1 - p) * 3.6 - out * 1.2, l.z);
      tmp.rotation.set(0, l.ry + (1 - p) * 1.2, l.rz + (1 - p) * 0.4);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      slabs.current!.setMatrixAt(k, tmp.matrix);
      const mk = l.flag ? easeBack(seg(t, l.d + 0.28, l.d + 0.38)) : 0;
      tmp.position.y += 0.02;
      tmp.translateZ(0.42);
      tmp.translateX(-0.3);
      tmp.scale.set(mk, mk, mk);
      tmp.updateMatrix();
      marks.current!.setMatrixAt(k, tmp.matrix);
    });
    slabs.current!.instanceMatrix.needsUpdate = true;
    marks.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={g} position={[0.1, 0, 0]}>
      <instancedMesh ref={slabs} args={[undefined, undefined, N]}>
        <boxGeometry args={[1.2, 0.03, 0.86]} />
        <meshPhysicalMaterial {...GLASS} color="#1a2538" transparent opacity={0.96} />
      </instancedMesh>
      <instancedMesh ref={marks} args={[undefined, undefined, N]}>
        <boxGeometry args={[0.42, 0.036, 0.05]} />
        <meshBasicMaterial toneMapped={false} transparent />
      </instancedMesh>
    </group>
  );
}

// ============================================================== 2. upload and read: scan beam, six chips fly out
const CHIPS: { label: string; value: string; px: number; py: number }[] = [
  { label: "Vendor", value: S.hero.supplier, px: 200, py: 208 },
  { label: "PO number", value: S.hero.po, px: 120, py: 316 },
  { label: "Items", value: "AX-40 · C-12 · DR-200", px: 160, py: ROWS[0] },
  { label: "Quantities", value: S.hero.lines.map((l) => `${inr(l.qty)} ${l.uom}`).join(" · "), px: COLS.qty - 60, py: ROWS[1] },
  { label: "Prices", value: S.hero.lines.map((l) => rs(l.unitPrice)).join(" · "), px: COLS.rate - 50, py: ROWS[2] },
  { label: "Tax", value: `GST ${S.hero.taxPct}% · ${rs(S.hero.taxInr)}`, px: 600, py: 812 },
];
const HERO2 = new Vector3(-0.85, 0, 0.4);
export function Upload() {
  const g = useRef<Group>(null);
  const beam = useRef<Group>(null);
  const chips = useRef<(Mesh | null)[]>([]);
  const chipMaps = useTexList(() => CHIPS.map((x) => chipTexture(x.label, x.value)));
  const glowMap = useTex(() => {
    const cv = document.createElement("canvas"); cv.width = 4; cv.height = 128;
    const ctx = cv.getContext("2d")!; const gr = ctx.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, "rgba(61,139,255,0)"); gr.addColorStop(0.5, "rgba(61,139,255,0.55)"); gr.addColorStop(1, "rgba(61,139,255,0)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, 128);
    return new CanvasTexture(cv);
  });
  useFrame(() => {
    const c = story.c;
    fade(g.current, vis(c, 2));
    if (!g.current?.visible) return;
    const t = act(c, 2, -0.42, 0.0);
    const beamY = lerp(1.08, -1.08, easeInOut(t));
    if (beam.current) { beam.current.position.y = beamY; beam.current.visible = t > 0.001 && t < 0.999; }
    const out = exit(c, 2);
    CHIPS.forEach((ch, k) => {
      const m = chips.current[k];
      if (!m) return;
      const sy = rowY(ch.py), sx = HERO2.x + colX(ch.px);
      const launch = (1.08 - sy) / 2.16; // beam reaches this row
      const p = easeBack(seg(t, launch * 0.9, launch * 0.9 + 0.22));
      const tx = 1.3, ty = 0.98 - k * 0.39;
      m.position.set(lerp(sx, tx, p), lerp(sy, ty, p) + out * 0.6, lerp(HERO2.z + 0.05, 0.55, p) + out * 0.8);
      m.scale.setScalar(lerp(0.35, 1, Math.min(1, p)));
      (m.material as MeshBasicMaterial).opacity = Math.min(1, p * 2) * vis(c, 2) * (1 - out);
    });
  });
  return (
    <group ref={g}>
      <group ref={beam} position={[HERO2.x, 1, HERO2.z + 0.06]}>
        <mesh><planeGeometry args={[1.82, 0.014]} /><meshBasicMaterial color={hdr(C.accentHi, 3)} toneMapped={false} transparent /></mesh>
        <mesh><planeGeometry args={[1.82, 0.36]} /><meshBasicMaterial map={glowMap} transparent depthWrite={false} toneMapped={false} /></mesh>
      </group>
      {CHIPS.map((_, k) => (
        <mesh key={k} ref={(el) => { chips.current[k] = el; }}>
          <planeGeometry args={[1.19, 0.28]} />
          <meshBasicMaterial map={chipMaps[k]} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ============================================================== 3. six sources orbit a core and feed it
export function Sources() {
  const g = useRef<Group>(null);
  const nodes = useRef<(Group | null)[]>([]);
  const pulses = useRef<InstancedMesh>(null);
  const core = useRef<Mesh>(null);
  const ring = useRef<Group>(null);
  const labels = useTexList(() => S.sources.map((x) => labelTexture(x.label, `${inr(x.records)} records`, { align: "center", w: 560 })));
  const coreLabel = useTex(() => labelTexture("PlantPay core", "one canonical model", { align: "center", w: 600 }));
  const lines = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(6 * 2 * 3), 3));
    return new LineSegments(geo, new LineBasicMaterial({ color: hdr(C.accent, 1.3), transparent: true, opacity: 0.75, toneMapped: false }));
  }, []);
  useEffect(() => () => { lines.geometry.dispose(); (lines.material as LineBasicMaterial).dispose(); }, [lines]);
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const c = story.c;
    fade(g.current, vis(c, 3));
    if (!g.current?.visible) return;
    const e = enter(c, 3), t = act(c, 3, -0.45, 0.05);
    const spin = (c - 3) * 1.1;
    const pos = lines.geometry.attributes.position as BufferAttribute;
    S.sources.forEach((_, k) => {
      const a = (k / 6) * Math.PI * 2 + spin;
      const R = lerp(5.2, 1, e);
      v.set(Math.cos(a) * 2.2 * R, Math.sin(a * 2 + 0.6) * 0.22 + 0.15, Math.sin(a) * 1.3 * R);
      nodes.current[k]?.position.copy(v);
      const reach = easeOut(seg(t, 0.05 + k * 0.05, 0.35 + k * 0.05));
      pos.setXYZ(k * 2, v.x, v.y, v.z);
      pos.setXYZ(k * 2 + 1, lerp(v.x, 0, reach), lerp(v.y, 0, reach), lerp(v.z, 0, reach));
      const u = (((c - 2.5) * 2.4 + k / 6) % 1 + 1) % 1;
      tmp.position.set(lerp(v.x, 0, u), lerp(v.y, 0, u), lerp(v.z, 0, u));
      tmp.scale.setScalar(reach > 0.98 ? 1 : 0.001);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      pulses.current?.setMatrixAt(k, tmp.matrix);
    });
    pos.needsUpdate = true;
    if (pulses.current) pulses.current.instanceMatrix.needsUpdate = true;
    if (core.current) core.current.scale.setScalar(0.8 + 0.35 * seg(t, 0.4, 0.8));
    if (ring.current) { ring.current.rotation.x = 1.2 + (c - 3) * 0.4; ring.current.rotation.z = (c - 3) * 1.4; }
  });
  return (
    <group ref={g} position={[0.2, -0.05, 0]}>
      <primitive object={lines} />
      <mesh ref={core}><icosahedronGeometry args={[0.34, 3]} /><meshBasicMaterial color={hdr(C.accent, 2.6)} toneMapped={false} transparent /></mesh>
      <mesh><icosahedronGeometry args={[0.62, 1]} /><meshBasicMaterial color={C.accentHi} wireframe transparent opacity={0.35} /></mesh>
      <group ref={ring}>
        <mesh><torusGeometry args={[0.92, 0.008, 8, 128]} /><meshBasicMaterial color={hdr(C.accentHi, 2)} toneMapped={false} transparent /></mesh>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}><torusGeometry args={[1.1, 0.005, 8, 128]} /><meshBasicMaterial color={C.accent} transparent opacity={0.6} /></mesh>
      </group>
      <Billboard position={[0, -0.95, 0]}><Label {...coreLabel} height={0.3} /></Billboard>
      <instancedMesh ref={pulses} args={[undefined, undefined, 6]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshBasicMaterial color={hdr(C.accentHi, 3)} toneMapped={false} transparent />
      </instancedMesh>
      {S.sources.map((x, k) => (
        <group key={x.id} ref={(el) => { nodes.current[k] = el; }}>
          <RoundedBox args={[0.34, 0.34, 0.34]} radius={0.06} smoothness={3}>
            <meshPhysicalMaterial {...GLASS} color="#15233a" transparent opacity={0.95} />
          </RoundedBox>
          <mesh><sphereGeometry args={[0.08, 16, 16]} /><meshBasicMaterial color={hdr(C.accent, 2.4)} toneMapped={false} transparent /></mesh>
          <Billboard position={[0, 0.4, 0]}><Label {...labels[k]} height={0.3} /></Billboard>
        </group>
      ))}
    </group>
  );
}

// ============================================================== 4 + 5. three-way match, then the contract amendment explains it
export function Documents() {
  const po = useRef<Group>(null), grn = useRef<Group>(null), amd = useRef<Group>(null), badge = useRef<Mesh>(null), scan = useRef<Mesh>(null);
  const poPrice = useRef<Mesh>(null), grnQty = useRef<Mesh>(null), poNote = useRef<Mesh>(null), evid = useRef<Mesh>(null);
  const redLink = useRef<Mesh>(null), greenLink = useRef<Mesh>(null), amberLink = useRef<Mesh>(null);
  const poMap = useTex(poTexture), grnMap = useTex(grnTexture), amdMap = useTex(amendmentTexture);
  const flagged = useTex(() => pillTexture("FLAGGED", C.bad, `Price ${S.match.trio.invoice} vs PO ${S.match.trio.po}: 3.5% over 2%`));
  const notUpdated = useTex(() => pillTexture("PO NOT UPDATED", C.warn, "still ₹398 since 18-Sep-2026"));
  const evidence = useTex(() => pillTexture("EVIDENCE-SUPPORTED", C.ok, `${S.rootCause.evidenceCount} records agree`));
  const SC = 0.86;
  // world positions of the AX-40 price cells (hero invoice at x -1.95, PO at 0) and the amendment card
  const invCell = new Vector3(-1.8 + colX(COLS.rate - 60) * SC, rowY(ROWS[0]) * SC, 0.05);
  const poCell = new Vector3(colX(COLS.rate - 60) * SC, rowY(ROWS[0]) * SC, 0.05);
  const amdPt = new Vector3(1.8 - 0.55 * SC, 0.25, 0.25);
  const red = useTube(useMemo(() => [invCell.clone(), new Vector3(-0.95, invCell.y + 0.32, 0.4), poCell.clone()], []), 0.012); // eslint-disable-line react-hooks/exhaustive-deps
  const green = useTube(useMemo(() => [amdPt.clone(), new Vector3(0, 1.45, 0.7), invCell.clone()], []), 0.014); // eslint-disable-line react-hooks/exhaustive-deps
  const amber = useTube(useMemo(() => [amdPt.clone().add(new Vector3(0, -0.1, 0)), new Vector3(0.95, 0.15, 0.5), poCell.clone()], []), 0.01); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    const c = story.c;
    const v4 = vis(c, 4), v5 = vis(c, 5);
    const both = Math.max(v4, v5, Math.min(seg(c, 3.4, 3.7), 1 - seg(c, 5.3, 5.62)));
    // PO: in for both chapters
    const e4 = enter(c, 4);
    if (po.current) { po.current.position.set(lerp(3, 0, e4), lerp(-0.5, 0, e4), lerp(-2.5, 0, e4)); po.current.rotation.y = lerp(-0.7, 0, e4); fade(po.current, both); }
    if (grn.current) {
      const e = easeOut(seg(c, 3.45, 3.85)), x = easeInOut(seg(c, 4.3, 4.65));
      grn.current.position.set(lerp(4.6, 1.8, e) + x * 1.8, lerp(-0.6, 0, e) - x * 2.2, lerp(-3, 0, e) - x * 1.5);
      grn.current.rotation.y = lerp(-0.9, 0, e) - x * 0.6;
      fade(grn.current, v4 * (1 - x));
    }
    if (amd.current) {
      const e = easeOut(seg(c, 4.45, 4.85));
      amd.current.position.set(lerp(3.6, 1.8, e), lerp(2.8, 0.25, e), lerp(-1.4, 0, e));
      amd.current.rotation.set(lerp(-0.5, 0, e), lerp(-0.6, 0, e), lerp(0.2, 0, e));
      fade(amd.current, Math.min(e * 1.2, 1) * (1 - seg(c, 5.3, 5.62)));
    }
    // chapter 4: a scan line visits each row; the price row turns red; the verdict badge appears
    const t4 = act(c, 4, -0.42, 0.0);
    if (scan.current) {
      scan.current.position.y = rowY(lerp(ROWS[0] - 40, ROWS[2] + 40, easeInOut(seg(t4, 0, 0.45)))) * SC;
      (scan.current.material as MeshBasicMaterial).opacity = 0.9 * Math.sin(Math.PI * seg(t4, 0, 0.45)) * v4;
    }
    const red4 = seg(t4, 0.45, 0.6) * (1 - seg(c, 5.55, 5.8));
    if (poPrice.current) {
      const m = poPrice.current.material as MeshBasicMaterial;
      m.color.copy(BAD).lerp(new Color(C.warn), seg(c, 4.75, 4.86)).multiplyScalar(1.25);
      m.opacity = 0.42 * red4 * both;
    }
    if (grnQty.current) (grnQty.current.material as MeshBasicMaterial).opacity = 0.32 * seg(t4, 0.45, 0.6) * v4;
    red.setProgress(easeOut(seg(t4, 0.5, 0.7)) * (1 - seg(c, 4.6, 4.9)));
    if (redLink.current) (redLink.current.material as MeshBasicMaterial).opacity = v4;
    if (badge.current) {
      const k = seg(t4, 0.65, 0.85);
      badge.current.scale.setScalar(lerp(0.6, 1, easeBack(k)));
      (badge.current.material as MeshBasicMaterial).opacity = k * v4;
      badge.current.visible = k * v4 > 0.01;
    }
    // chapter 5: the amendment explains the gap
    const t5 = act(c, 5, -0.4, 0.0);
    green.setProgress(easeOut(seg(t5, 0.05, 0.4)));
    amber.setProgress(easeOut(seg(t5, 0.25, 0.55)));
    if (greenLink.current) (greenLink.current.material as MeshBasicMaterial).opacity = v5;
    if (amberLink.current) (amberLink.current.material as MeshBasicMaterial).opacity = v5 * 0.9;
    for (const [ref, k] of [[poNote, seg(t5, 0.5, 0.7)], [evid, seg(t5, 0.65, 0.85)]] as const) {
      if (!ref.current) continue;
      ref.current.scale.setScalar(lerp(0.7, 1, easeBack(k)));
      (ref.current.material as MeshBasicMaterial).opacity = k * v5;
      ref.current.visible = k * v5 > 0.01;
    }
  });
  const pillH = 0.42;
  return (
    <group>
      <group ref={po} scale={SC}>
        <Card map={poMap}>
          <Cell cellRef={poPrice} x={colX(COLS.rate - 60)} y={rowY(ROWS[0])} w={0.36} h={0.12} color={C.bad} />
        </Card>
      </group>
      <group ref={grn} scale={SC}>
        <Card map={grnMap}>
          <Cell cellRef={grnQty} x={colX(COLS.qty - 60)} y={rowY(ROWS[2])} w={0.36} h={0.12} color={C.warn} />
        </Card>
      </group>
      <group ref={amd} scale={SC}>
        <Card map={amdMap} h={1.6 * (760 / DOC.w)} />
      </group>
      <mesh ref={scan} position={[0, 0, 0.12]}>
        <planeGeometry args={[5.0, 0.012]} />
        <meshBasicMaterial color={hdr(C.accentHi, 2.6)} toneMapped={false} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={redLink} geometry={red.geo}><meshBasicMaterial color={hdr(C.bad, 2)} toneMapped={false} transparent /></mesh>
      <mesh ref={greenLink} geometry={green.geo}><meshBasicMaterial color={hdr(C.ok, 2)} toneMapped={false} transparent /></mesh>
      <mesh ref={amberLink} geometry={amber.geo}><meshBasicMaterial color={hdr(C.warn, 1.6)} toneMapped={false} transparent /></mesh>
      <mesh ref={badge} position={[0, 1.42, 0.35]}>
        <planeGeometry args={[pillH * flagged.aspect * 1.25, pillH * 1.25]} />
        <meshBasicMaterial map={flagged.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={poNote} position={[0.75, -1.32, 0.4]}>
        <planeGeometry args={[pillH * notUpdated.aspect, pillH]} />
        <meshBasicMaterial map={notUpdated.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={evid} position={[-1.55, -1.32, 0.45]}>
        <planeGeometry args={[pillH * evidence.aspect, pillH]} />
        <meshBasicMaterial map={evidence.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ============================================================== 6. risk signals: relationship graph + duplicate ghost
export function Risk() {
  const g = useRef<Group>(null), graph = useRef<Group>(null), vNodes = useRef<InstancedMesh>(null), aNodes = useRef<InstancedMesh>(null);
  const ghost = useRef<Group>(null), orig = useRef<Group>(null), score = useRef<Mesh>(null), labels = useRef<Group>(null);
  const R = S.risk;
  const lay = useMemo(() => {
    const r = rng(23);
    const ids = R.graph.vendors.map((v) => v.id);
    const flagged = R.graph.links.filter((l) => l.account === R.graph.flaggedAccount).map((l) => l.vendor);
    const legit = R.graph.links.filter((l) => l.account === R.graph.legitAccount).map((l) => l.vendor);
    const pos = new Map<string, Vector3>();
    const rest = ids.filter((id) => !flagged.includes(id));
    rest.forEach((id, i) => {
      const k = i + 0.5, n = rest.length;
      const phi = Math.acos(1 - (2 * k) / n), th = Math.PI * (1 + Math.sqrt(5)) * k;
      const p = new Vector3(Math.cos(th) * Math.sin(phi), Math.cos(phi) * 0.7, Math.sin(th) * Math.sin(phi)).multiplyScalar(1.85 + r() * 0.25);
      if (p.z > 0.9) p.z -= 1.6; // keep the front clear for the highlighted pair
      pos.set(id, p);
    });
    pos.set(flagged[0], new Vector3(-0.75, 0.42, 1.25));
    pos.set(flagged[1], new Vector3(0.7, -0.2, 1.2));
    if (legit.length === 2) { pos.set(legit[0], new Vector3(1.55, 0.95, -0.9)); pos.set(legit[1], new Vector3(1.95, 0.25, -0.7)); }
    const accts = new Map<string, Vector3>();
    for (const l of R.graph.links) {
      const owners = R.graph.links.filter((x) => x.account === l.account).map((x) => pos.get(x.vendor)!);
      const mid = owners.reduce((a, b) => a.clone().add(b), new Vector3()).multiplyScalar(1 / owners.length);
      accts.set(l.account, owners.length > 1 ? mid.add(new Vector3(0, 0.38, 0.25)) : mid.clone().multiplyScalar(1.22));
    }
    return { pos, accts, flagged, legit, ids };
  }, [R]);
  const edges = useMemo(() => {
    const p: number[] = [], col: number[] = [];
    for (const l of R.graph.links) {
      const a = lay.pos.get(l.vendor)!, b = lay.accts.get(l.account)!;
      p.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const cl = l.account === R.graph.flaggedAccount ? hdr(C.warn, 1.1) : l.account === R.graph.legitAccount ? new Color("#6f8bb0") : new Color("#2c3a52");
      col.push(cl.r, cl.g, cl.b, cl.r, cl.g, cl.b);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    return new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false }));
  }, [lay, R]);
  useEffect(() => () => { edges.geometry.dispose(); (edges.material as LineBasicMaterial).dispose(); }, [edges]);
  const accList = useMemo(() => [...lay.accts.entries()], [lay]);
  const lblA = useTex(() => labelTexture(R.shared.a, "holds account …" + R.shared.account.slice(-4), { w: 620 }));
  const lblB = useTex(() => labelTexture(R.shared.b, "same account", { w: 620 }));
  const lblL = useTex(() => labelTexture("Dahej group", "shared, confirmed legitimate", { w: 620, color: "#a9b8cc" }));
  const dupMap = useTex(() => miniDoc(R.duplicate.original, "Deccan Valve & Fittings", "14-Oct-2026", "Paid", C.band.inv));
  const ghostMap = useTex(() => miniDoc(R.duplicate.copy, "Deccan Valve & Fittings", "09-Nov-2026", "New", C.warn));
  const scoreMap = useTex(() => pillTexture(`${R.duplicate.score} / 100`, C.warn, "possible duplicate · person decides"));
  useFrame(() => {
    const c = story.c, v = vis(c, 6), t = act(c, 6, -0.42, 0.02);
    fade(g.current, v);
    if (!g.current?.visible) return;
    if (graph.current) { graph.current.rotation.y = (c - 6) * 0.5; graph.current.scale.setScalar(lerp(0.6, 1, enter(c, 6))); }
    const hi = seg(t, 0.25, 0.45);
    lay.ids.forEach((id, k) => {
      tmp.position.copy(lay.pos.get(id)!); tmp.rotation.set(0, 0, 0);
      const isF = lay.flagged.includes(id);
      tmp.scale.setScalar(isF ? 1 + 0.6 * hi : 1);
      tmp.updateMatrix(); vNodes.current!.setMatrixAt(k, tmp.matrix);
      vNodes.current!.setColorAt(k, isF ? DIM.clone().lerp(hdr(C.warn, 1.05), hi) : lay.legit.includes(id) ? new Color("#7d93b3") : DIM);
    });
    accList.forEach(([acct, p], k) => {
      tmp.position.copy(p); tmp.rotation.set(0.6, 0.6, 0);
      const isF = acct === R.graph.flaggedAccount;
      tmp.scale.setScalar(isF ? 1 + 0.9 * hi : 0.8);
      tmp.updateMatrix(); aNodes.current!.setMatrixAt(k, tmp.matrix);
      aNodes.current!.setColorAt(k, isF ? new Color("#3a4a63").lerp(hdr(C.warn, 1.1), hi) : new Color("#26344b"));
    });
    for (const m of [vNodes.current!, aNodes.current!]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    (edges.material as LineBasicMaterial).opacity = v * lerp(0.5, 1, hi);
    if (labels.current) fade(labels.current, v * seg(t, 0.35, 0.5));
    // duplicate: the copy slides over the original
    const d = easeInOut(seg(t, 0.45, 0.75));
    if (ghost.current) ghost.current.position.set(lerp(1.1, 0.07, d), lerp(0.75, -0.06, d), 0.06);
    if (orig.current) fade(orig.current, v);
    if (ghost.current) fade(ghost.current, v * 0.62);
    if (score.current) {
      const k = seg(t, 0.75, 0.9);
      (score.current.material as MeshBasicMaterial).opacity = k * v;
      score.current.scale.setScalar(lerp(0.7, 1, easeBack(k)));
      score.current.visible = k * v > 0.01;
    }
  });
  const fA = lay.pos.get(lay.flagged[0])!, fB = lay.pos.get(lay.flagged[1])!, fAcc = lay.accts.get(R.graph.flaggedAccount)!;
  const lp = lay.legit.length ? lay.accts.get(R.graph.legitAccount!) : undefined;
  return (
    <group ref={g}>
      <group ref={graph} position={[-0.35, 0.25, -0.3]}>
        <primitive object={edges} />
        <instancedMesh ref={vNodes} args={[undefined, undefined, lay.ids.length]}>
          <sphereGeometry args={[0.075, 16, 16]} /><meshBasicMaterial toneMapped={false} transparent />
        </instancedMesh>
        <instancedMesh ref={aNodes} args={[undefined, undefined, accList.length]}>
          <boxGeometry args={[0.075, 0.075, 0.075]} /><meshBasicMaterial toneMapped={false} transparent />
        </instancedMesh>
        <group ref={labels}>
          <Billboard position={[fA.x - 0.05, fA.y + 0.28, fA.z]}><Label {...lblA} height={0.3} /></Billboard>
          <Billboard position={[fB.x + 0.05, fB.y - 0.3, fB.z]}><Label {...lblB} height={0.3} /></Billboard>
          {lp && <Billboard position={[lp.x, lp.y + 0.28, lp.z]}><Label {...lblL} height={0.24} /></Billboard>}
          <mesh position={[fAcc.x, fAcc.y, fAcc.z]}><torusGeometry args={[0.16, 0.006, 8, 48]} /><meshBasicMaterial color={hdr(C.warn, 1.2)} toneMapped={false} transparent /></mesh>
        </group>
      </group>
      <group position={[1.75, -1.3, 0.7]} scale={0.42}>
        <group ref={orig}><Card map={dupMap} /></group>
        <group ref={ghost}><Card map={ghostMap} opacity={0.5} /></group>
        <mesh ref={score} position={[0.1, 1.55, 0.3]}>
          <planeGeometry args={[0.85 * scoreMap.aspect, 0.85]} />
          <meshBasicMaterial map={scoreMap.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function miniDoc(number: string, party: string, date: string, status: string, band: string) {
  const cv = document.createElement("canvas"); cv.width = DOC.w; cv.height = DOC.h;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = band; ctx.fillRect(0, 0, DOC.w, 16);
  const t = (s: string, x: number, y: number, px: number, color = C.ink, w = 500, fam = '"Inter Variable", sans-serif') => { ctx.font = `${w} ${px}px ${fam}`; ctx.fillStyle = color; ctx.fillText(s, x, y); };
  t("TAX INVOICE", 56, 92, 24, C.soft, 600);
  t(number, 56, 168, 66, C.ink, 600, '"Archivo Variable", sans-serif');
  t(party, 56, 228, 30);
  t("PO 4500001240", 56, 330, 30, C.soft);
  t(date, 56, 380, 30, C.soft);
  t("Total", 56, 760, 30, C.soft);
  t(S.risk.duplicate.total, 56, 840, 64, C.ink, 600, '"Archivo Variable", sans-serif');
  t(status, 56, 940, 32, status === "Paid" ? C.ok : C.warn, 600);
  return makeTex(cv);
}
function makeTex(cv: HTMLCanvasElement) { const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t; }

// ============================================================== 7. approval: role gates, threshold marker, stamp
const AXIS = { x0: -3.1, x1: 3.1, y: -1.75 };
const ax = (inrV: number) => lerp(AXIS.x0, AXIS.x1, inrV / S.approval.l1Max);
export function Approval() {
  const g = useRef<Group>(null), gate1 = useRef<Group>(null), gate2 = useRef<Group>(null), fill = useRef<Mesh>(null), marker = useRef<Mesh>(null), comment = useRef<Mesh>(null);
  const g1 = useTex(() => labelTexture("AP Clerk", `${CLERK.name} · limit ${rs(CLERK.limit)}`, { align: "center", w: 720 }));
  const g2 = useTex(() => labelTexture("Approver L1", `${APPROVER.name} · limit ${rs(APPROVER.limit)}`, { align: "center", w: 720 }));
  const mk = useTex(() => labelTexture(rs(S.approval.clerkMax), "clerk limit: above it, an approver signs", { w: 760, color: C.warn, titlePx: 40 }));
  const amt = useTex(() => labelTexture(rs(S.hero.totalInr), "this invoice", { w: 420, color: C.accentHi, titlePx: 40 }));
  const lim = useTex(() => labelTexture(rs(S.approval.l1Max), "L1 limit", { w: 420, align: "right", color: C.soft, titlePx: 34 }));
  const cm = useTex(() => pillTexture("COMMENT", C.accentHi, "PO amended per C-22. GRN posted per DN-5521."));
  const track = useTube(useMemo(() => [new Vector3(-3.4, -0.62, 0), new Vector3(3.4, -0.62, 0)], []), 0.01, 32);
  useEffect(() => track.setProgress(1), [track]);
  const gateMats = useRef<MeshBasicMaterial[][]>([[], []]);
  useFrame(() => {
    const c = story.c, v = vis(c, 7), t = act(c, 7, -0.45, 0.02);
    fade(g.current, v);
    if (!g.current?.visible) return;
    const k = easeInOut(t), hx = (lerp(-2.55, 2.25, k) - 0.1) / 0.8;
    const f = easeOut(seg(c, 6.55, 6.75));
    if (fill.current) { fill.current.scale.x = Math.max(0.001, (ax(S.hero.totalInr) - AXIS.x0) * f); }
    if (marker.current) (marker.current.material as MeshBasicMaterial).color.copy(new Color(C.warn)).multiplyScalar(1 + 1.2 * seg(f, 0.05, 0.2));
    [[gate1, -0.9], [gate2, 1.45]].forEach(([ref, gx], i) => {
      const passed = seg(hx, (gx as number) - 0.05, (gx as number) + 0.25);
      for (const m of gateMats.current[i]) m.color.copy(ACC).lerp(OK, passed).multiplyScalar(1.2 + 1.4 * Math.sin(Math.PI * passed));
      void ref;
    });
    if (comment.current) {
      const ck = seg(hx, -0.7, -0.3);
      (comment.current.material as MeshBasicMaterial).opacity = ck * v;
      comment.current.position.y = lerp(1.6, 1.78, ck);
      comment.current.visible = ck * v > 0.01;
    }
  });
  const Gate = ({ x, i, map }: { x: number; i: number; map: { map: import("three").Texture; aspect: number } }) => (
    <group position={[x, 0.12, 0]} ref={i === 0 ? gate1 : gate2}>
      {[[-0.62, 0, 0.035, 1.55], [0.62, 0, 0.035, 1.55], [0, 0.76, 1.27, 0.035]].map(([px, py, w, h], j) => (
        <mesh key={j} position={[px, py, 0]}>
          <boxGeometry args={[w, h, 0.035]} />
          <meshBasicMaterial ref={(m) => { if (m && !gateMats.current[i].includes(m)) gateMats.current[i].push(m); }} color={hdr(C.accent, 1.2)} toneMapped={false} transparent />
        </mesh>
      ))}
      <Label {...map} height={0.34} position={[0, 1.12, 0]} />
    </group>
  );
  return (
    <group ref={g} position={[0.1, 0, 0]} scale={0.8}>
      <mesh geometry={track.geo}><meshBasicMaterial color={hdr(C.accent, 1.1)} toneMapped={false} transparent opacity={0.7} /></mesh>
      <Gate x={-0.9} i={0} map={g1} />
      <Gate x={1.45} i={1} map={g2} />
      {/* amount axis: ₹0 to the L1 limit, with the clerk-limit marker */}
      <mesh position={[0, AXIS.y, 0]}><planeGeometry args={[AXIS.x1 - AXIS.x0, 0.05]} /><meshBasicMaterial color="#1c2a40" transparent /></mesh>
      <mesh ref={fill} position={[AXIS.x0, AXIS.y, 0.005]}>
        <planeGeometry args={[1, 0.05]} onUpdate={(geo) => geo.translate(0.5, 0, 0)} />
        <meshBasicMaterial color={hdr(C.accent, 1.6)} toneMapped={false} transparent />
      </mesh>
      <mesh ref={marker} position={[ax(S.approval.clerkMax), AXIS.y + 0.1, 0.01]}><planeGeometry args={[0.03, 0.42]} /><meshBasicMaterial color={C.warn} toneMapped={false} transparent /></mesh>
      <Label {...mk} height={0.3} position={[ax(S.approval.clerkMax) + mk.aspect * 0.15 - 0.02, AXIS.y - 0.34, 0]} />
      <Label {...amt} height={0.28} position={[ax(S.hero.totalInr), AXIS.y + 0.34, 0]} />
      <Label {...lim} height={0.24} position={[AXIS.x1 - lim.aspect * 0.12, AXIS.y - 0.32, 0]} />
      <mesh ref={comment} position={[-0.9, 1.75, 0.4]}>
        <planeGeometry args={[0.36 * cm.aspect, 0.36]} />
        <meshBasicMaterial map={cm.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ============================================================== 8. intelligence: criticality gauge + risk bars (AI-assisted)
class Arc extends Curve<Vector3> {
  constructor(private r: number, private a0: number, private a1: number) { super(); }
  getPoint(t: number, target = new Vector3()) { const a = lerp(this.a0, this.a1, t); return target.set(Math.cos(a) * this.r, Math.sin(a) * this.r, 0); }
}
export function Intelligence() {
  const g = useRef<Group>(null), bars = useRef<(Mesh | null)[]>([]), tag = useRef<Mesh>(null);
  const A0 = Math.PI * 1.25, A1 = -Math.PI * 0.25;
  const trackArc = useMemo(() => new Arc(1.0, A0, A1), [A0, A1]);
  const track = useTube(trackArc, 0.035, 120);
  const fillT = useTube(useMemo(() => new Arc(1.0, A0, A1), [A0, A1]), 0.05, 120);
  useEffect(() => track.setProgress(1), [track]);
  const panel = useTex(intelTexture);
  const gauge = useTex(gaugeLabelTexture);
  const aiTag = useTex(() => pillTexture("AI-ASSISTED", C.accentHi, "predicts and explains; rules decide"));
  const PW = 2.25, PH = PW * (INTEL.h / INTEL.w);
  useFrame(() => {
    const c = story.c, v = vis(c, 8), t = act(c, 8, -0.42, 0.0);
    fade(g.current, v);
    if (!g.current?.visible) return;
    fillT.setProgress(easeOut(seg(t, 0, 0.5)) * (S.intelligence.criticality.score / 100));
    INTEL.bars.forEach((b, k) => {
      const m = bars.current[k];
      if (!m) return;
      const p = easeOut(seg(t, 0.15 + k * 0.05, 0.55 + k * 0.05));
      m.scale.x = Math.max(0.001, ((b.x1 - b.x0) / INTEL.w) * PW * b.value * p);
    });
    if (tag.current) (tag.current.material as MeshBasicMaterial).opacity = seg(t, 0.5, 0.7) * v;
  });
  return (
    <group ref={g} position={[0.1, 0.05, 0]}>
      <group position={[-1.3, 0.15, 0]}>
        <mesh geometry={track.geo}><meshBasicMaterial color="#1c2a40" transparent /></mesh>
        <mesh geometry={fillT.geo}><meshBasicMaterial color={hdr(C.accent, 1.8)} toneMapped={false} transparent /></mesh>
        <mesh position={[0, -0.05, 0]}><planeGeometry args={[1.6, 1.12]} /><meshBasicMaterial map={gauge} transparent depthWrite={false} toneMapped={false} /></mesh>
      </group>
      <group position={[1.35, 0, 0]}>
        <mesh><planeGeometry args={[PW, PH]} /><meshBasicMaterial map={panel} transparent depthWrite={false} toneMapped={false} /></mesh>
        {INTEL.bars.map((b, k) => (
          <mesh key={k} ref={(el) => { bars.current[k] = el; }} position={[(b.x0 / INTEL.w - 0.5) * PW, (0.5 - b.y / INTEL.h) * PH, 0.004]}>
            <planeGeometry args={[1, (18 / INTEL.h) * PH]} onUpdate={(geo) => geo.translate(0.5, 0, 0)} />
            <meshBasicMaterial color={b.tone === C.warn ? hdr(C.warn, 1.3) : hdr(C.accent, 1.3)} toneMapped={false} transparent />
          </mesh>
        ))}
        <mesh ref={tag} position={[0.1, PH / 2 + 0.3, 0.02]}>
          <planeGeometry args={[0.4 * aiTag.aspect, 0.4]} />
          <meshBasicMaterial map={aiTag.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

// ============================================================== 9. trust: hash chain assembles, is tampered, detects, is repaired
export function Trust() {
  const g = useRef<Group>(null), blocks = useRef<(Group | null)[]>([]), faces = useRef<(Mesh | null)[]>([]), links = useRef<InstancedMesh>(null);
  const ping = useRef<(Mesh | null)[]>([]), status = useRef<Mesh>(null), statusOk = useRef<Mesh>(null);
  const chain = S.trust.chain;
  const T = chain.findIndex((b) => b.seq === S.trust.tamperedSeq);
  const okMaps = useTexList(() => chain.map((b) => hashBlockTexture(b.seq, b.hash, b.action, "ok")));
  const badMaps = useTexList(() => chain.map((b) => hashBlockTexture(b.seq, b.hash, b.action, "bad")));
  const bad = useTex(() => pillTexture("TAMPER DETECTED", C.bad, S.trust.reason));
  const ok = useTex(() => pillTexture("CHAIN VERIFIED", C.ok, `${inr(S.trust.auditEntries)} audit entries · ${inr(S.trust.workflowEvents)} workflow events`));
  const layout = useMemo(() => {
    const r = rng(5), n = chain.length;
    return chain.map((_, k) => {
      const a = lerp(-0.95, 0.95, k / (n - 1));
      return {
        at: new Vector3(Math.sin(a) * 3.3, 0, -Math.cos(a) * 3.3 + 2.0), ry: -a,
        from: new Vector3((r() - 0.5) * 9, (r() - 0.5) * 5, -3 - r() * 4), fr: new Vector3(r() * 3, r() * 3, r() * 3),
      };
    });
  }, [chain]);
  const glassRefs = useRef<(MeshPhysicalMaterial | null)[]>([]);
  const q = useMemo(() => new Quaternion(), []);
  useFrame(() => {
    const c = story.c, v = vis(c, 9), t = act(c, 9, -0.5, 0.3);
    fade(g.current, v);
    if (!g.current?.visible) return;
    const tamper = seg(t, 0.4, 0.46) * (1 - seg(t, 0.8, 0.88));
    layout.forEach((l, k) => {
      const b = blocks.current[k];
      if (!b) return;
      const p = easeOut(seg(t, k * 0.025, 0.24 + k * 0.025));
      b.position.lerpVectors(l.from, l.at, p);
      b.rotation.set(l.fr.x * (1 - p), l.ry + l.fr.y * (1 - p), l.fr.z * (1 - p));
      if (k === T) { b.position.z += 0.55 * tamper; b.position.y += 0.18 * tamper; b.rotation.z += 0.12 * tamper; }
      const red = k === T ? tamper : k > T ? seg(t, 0.46 + (k - T) * 0.045, 0.5 + (k - T) * 0.045) * (1 - seg(t, 0.8, 0.88)) : 0;
      const f = faces.current[k];
      if (f) (f.material as MeshBasicMaterial).map = red > 0.5 ? badMaps[k] : okMaps[k];
      const gm = glassRefs.current[k];
      if (gm) gm.emissive.copy(new Color("#000000")).lerp(BAD, red * 0.35).lerp(ACC, (1 - red) * 0.08);
      // link to the next block
      if (k < layout.length - 1 && links.current) {
        const a = l.at, z = layout[k + 1].at;
        const lp = Math.min(p, easeOut(seg(t, (k + 1) * 0.025, 0.24 + (k + 1) * 0.025)));
        tmp.position.lerpVectors(a, z, 0.5);
        const dir = new Vector3().subVectors(z, a);
        q.setFromUnitVectors(new Vector3(1, 0, 0), dir.clone().normalize());
        tmp.quaternion.copy(q);
        tmp.scale.set(dir.length() * 0.42 * lp + 0.0001, 1, 1);
        tmp.updateMatrix();
        links.current.setMatrixAt(k, tmp.matrix);
        const lr = k >= T ? seg(t, 0.46 + (k - T) * 0.045, 0.5 + (k - T) * 0.045) * (1 - seg(t, 0.8, 0.88)) : 0;
        links.current.setColorAt(k, hdr(C.accent, 1.6).lerp(hdr(C.bad, 2), lr));
      }
    });
    if (links.current) { links.current.instanceMatrix.needsUpdate = true; if (links.current.instanceColor) links.current.instanceColor.needsUpdate = true; }
    ping.current.forEach((m, j) => {
      if (!m) return;
      const pp = seg(t, 0.46 + j * 0.08, 0.66 + j * 0.08);
      m.scale.setScalar(lerp(0.4, 2.6, easeOut(pp)));
      (m.material as MeshBasicMaterial).opacity = (pp > 0 && pp < 1 ? 1 - pp : 0) * v;
      m.position.copy(layout[T].at).add(new Vector3(0, 0.1, 0.6));
    });
    const sb = seg(t, 0.5, 0.58) * (1 - seg(t, 0.78, 0.84)), so = seg(t, 0.88, 0.96);
    if (status.current) { (status.current.material as MeshBasicMaterial).opacity = sb * v; status.current.visible = sb > 0.01; }
    if (statusOk.current) { (statusOk.current.material as MeshBasicMaterial).opacity = so * v; statusOk.current.visible = so > 0.01; }
  });
  return (
    <group ref={g} position={[0.1, 0.2, -0.4]} scale={0.74}>
      {chain.map((b, k) => (
        <group key={b.seq} ref={(el) => { blocks.current[k] = el; }}>
          <RoundedBox args={[0.98, 0.7, 0.2]} radius={0.04} smoothness={3}>
            <meshPhysicalMaterial ref={(m) => { glassRefs.current[k] = m; }} {...GLASS} color="#111d31" transparent opacity={0.95} />
          </RoundedBox>
          <mesh ref={(el) => { faces.current[k] = el; }} position={[0, 0, 0.102]}>
            <planeGeometry args={[0.96, 0.686]} />
            <meshBasicMaterial map={okMaps[k]} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={links} args={[undefined, undefined, chain.length - 1]}>
        <boxGeometry args={[1, 0.035, 0.035]} /><meshBasicMaterial toneMapped={false} transparent />
      </instancedMesh>
      {[0, 1].map((j) => (
        <mesh key={j} ref={(el) => { ping.current[j] = el; }}>
          <torusGeometry args={[0.5, 0.012, 8, 96]} /><meshBasicMaterial color={hdr(C.bad, 2.4)} toneMapped={false} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={status} position={[0, -1.15, 2.4]}>
        <planeGeometry args={[0.42 * bad.aspect, 0.42]} /><meshBasicMaterial map={bad.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={statusOk} position={[0, -1.15, 2.4]}>
        <planeGeometry args={[0.42 * ok.aspect, 0.42]} /><meshBasicMaterial map={ok.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ============================================================== 10. paid: passport milestones fill in
export function Paid() {
  const g = useRef<Group>(null), dots = useRef<InstancedMesh>(null), pill = useRef<Mesh>(null);
  const M = S.paid.milestones, n = M.length;
  const X = (k: number) => lerp(-2.4, 2.4, k / (n - 1)), Y = -1.05;
  const line = useTube(useMemo(() => [new Vector3(-2.4, Y, 0), new Vector3(2.4, Y, 0)], []), 0.014, 64); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useTube(useMemo(() => [new Vector3(-2.4, Y, -0.01), new Vector3(2.4, Y, -0.01)], []), 0.008, 16); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => base.setProgress(1), [base]);
  const labels = useTexList(() => M.map((m) => labelTexture(m.label, undefined, { align: "center", w: 520, titlePx: 34 })));
  const ready = useTex(() => pillTexture("READY FOR PAYMENT", C.ok, `${rs(S.hero.totalInr)} · due 25-Dec-2026`));
  useFrame(() => {
    const c = story.c, v = vis(c, 10), t = act(c, 10, -0.42, 0.0);
    fade(g.current, v);
    if (!g.current?.visible) return;
    const p = easeInOut(seg(t, 0.05, 0.75));
    line.setProgress(p);
    M.forEach((_, k) => {
      const on = seg(p, k / (n - 1) - 0.02, k / (n - 1) + 0.04);
      tmp.position.set(X(k), Y, 0.01); tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1 + 0.35 * Math.sin(Math.PI * on));
      tmp.updateMatrix(); dots.current!.setMatrixAt(k, tmp.matrix);
      dots.current!.setColorAt(k, new Color("#2a3a55").lerp(hdr(C.ok, 1.25), on));
    });
    dots.current!.instanceMatrix.needsUpdate = true;
    if (dots.current!.instanceColor) dots.current!.instanceColor.needsUpdate = true;
    if (pill.current) {
      const k = seg(t, 0.78, 0.92);
      (pill.current.material as MeshBasicMaterial).opacity = k * v;
      pill.current.scale.setScalar(lerp(0.75, 1, easeBack(k)));
      pill.current.visible = k * v > 0.01;
    }
  });
  return (
    <group ref={g} position={[0.1, 0, 0]}>
      <mesh geometry={base.geo}><meshBasicMaterial color="#1c2a40" transparent /></mesh>
      <mesh geometry={line.geo}><meshBasicMaterial color={hdr(C.ok, 1.2)} toneMapped={false} transparent /></mesh>
      <instancedMesh ref={dots} args={[undefined, undefined, n]}>
        <sphereGeometry args={[0.085, 20, 20]} /><meshBasicMaterial toneMapped={false} transparent />
      </instancedMesh>
      {M.map((m, k) => <Label key={m.id} {...labels[k]} height={0.2} position={[X(k), Y - (k % 2 ? 0.46 : 0.27), 0]} />)}
      <mesh ref={pill} position={[0.05, 1.72, 0.3]}>
        <planeGeometry args={[0.42 * ready.aspect, 0.42]} /><meshBasicMaterial map={ready.map} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

