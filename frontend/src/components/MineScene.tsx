import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STATE_COLOR } from "../lib/format";
import { useI18n } from "../i18n";
import type { MineMap, MineSegment, NavLive, Snapshot, Vec3 } from "../types";

export const EXAG = 3; // vertical exaggeration so depth differences are visible
export type ColorMode = "state" | "mapping" | "height" | "temp" | "ch4";
export interface SceneOpts {
  labels: boolean; hazards: boolean; workers: boolean; rover: boolean; route: boolean; sensors: boolean; cloud: boolean; trajectory: boolean; colorMode: ColorMode;
}
export const DEFAULT_OPTS: SceneOpts = { labels: false, hazards: true, workers: true, rover: true, route: true, sensors: true, cloud: true, trajectory: true, colorMode: "state" };
export interface ExtraRoute { path: Vec3[]; color: string; dashed?: boolean; width?: number }

const P = (v: number[]) => new THREE.Vector3(v[0], v[1] * EXAG, v[2]);
const CENTER = new THREE.Vector3(175, -30 * EXAG * 0.5, 55);

/** blue -> cyan -> green -> yellow -> orange -> red ramp, u in [0,1] */
export function ramp(u: number): THREE.Color {
  const stops = [[0.0, "#2563eb"], [0.25, "#22d3ee"], [0.5, "#34d399"], [0.72, "#facc15"], [0.86, "#fb923c"], [1.0, "#ef4444"]] as const;
  const x = Math.min(1, Math.max(0, u));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const a = new THREE.Color(stops[i - 1][1]), b = new THREE.Color(stops[i][1]);
      return a.lerp(b, (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}
export const Y_MIN = -42, Y_MAX = 2;
const heightU = (y: number) => 1 - (y - Y_MIN) / (Y_MAX - Y_MIN); // deeper = higher "value" (red)
export const TEMP_RANGE: [number, number] = [22, 32];
export const CH4_RANGE: [number, number] = [0, 2.5];

function segColor(seg: MineSegment, snap: Snapshot | null, mode: ColorMode): THREE.Color {
  const live = snap?.segments[seg.id];
  if (mode === "state") return new THREE.Color(live ? STATE_COLOR[live.state] : "#64748b");
  if (mode === "mapping") {
    const m = live?.mapping.state;
    return new THREE.Color(m === "explored" ? "#2dd4bf" : m === "partial" ? "#22d3ee" : "#475569");
  }
  if (mode === "temp") { const v = live?.values.temp; return v === undefined ? new THREE.Color("#475569") : ramp((v - TEMP_RANGE[0]) / (TEMP_RANGE[1] - TEMP_RANGE[0])); }
  if (mode === "ch4") { const v = live?.values.ch4; return v === undefined ? new THREE.Color("#475569") : ramp((v - CH4_RANGE[0]) / (CH4_RANGE[1] - CH4_RANGE[0])); }
  return new THREE.Color("#94a3b8");
}

function midPoint(seg: MineSegment): THREE.Vector3 {
  return P(seg.polyline[Math.floor(seg.polyline.length / 2)]);
}

function Tunnel({ seg, snap, opts, selected, onSelect }: { seg: MineSegment; snap: Snapshot | null; opts: SceneOpts; selected: boolean; onSelect: (id: string) => void }) {
  const live = snap?.segments[seg.id];
  const pts = useMemo(() => seg.polyline.map(P), [seg]);
  const geo = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(10, pts.length * 3), Math.max(seg.width_m * 0.5, 1.5), 10, false), [pts, seg.width_m]);
  const col = segColor(seg, snap, opts.colorMode);
  const unexplored = live?.mapping.state === "unexplored";
  const hazard = opts.hazards && live && (live.avoid || live.state === "WARNING" || live.state === "UNKNOWN");
  const hazRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => { if (hazRef.current) hazRef.current.opacity = 0.16 + 0.12 * Math.sin(clock.elapsedTime * 3); });
  const vertexColors = useMemo(() => (opts.colorMode === "height" ? seg.polyline.map((p) => { const c = ramp(heightU(p[1])); return [c.r, c.g, c.b] as [number, number, number]; }) : undefined), [seg, opts.colorMode]);
  const hz = live?.state === "DANGER" || live?.obstructed ? "#f87171" : live?.state === "WARNING" ? "#fbbf24" : "#94a3b8";
  return (
    <group>
      <mesh geometry={geo} onClick={(e: any) => { e.stopPropagation(); onSelect(seg.id); }}
        onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "auto")}>
        <meshBasicMaterial color={selected ? "#22d3ee" : "#6b8299"} transparent opacity={selected ? 0.22 : 0.07} depthWrite={false} wireframe={selected} />
      </mesh>
      <Line points={pts} color={vertexColors ? undefined : col} vertexColors={vertexColors} lineWidth={selected ? 5 : unexplored ? 2 : 3.5}
        dashed={unexplored} dashSize={4} gapSize={4} transparent opacity={unexplored ? 0.55 : 1} />
      {hazard && (
        <mesh geometry={geo} scale={[1.7, 1.7, 1.7]} position={[0, 0, 0]}>
          <meshBasicMaterial ref={hazRef} color={hz} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      )}
      {seg.restricted && <Line points={pts} color="#a78bfa" lineWidth={1.5} dashed dashSize={1.5} gapSize={5} />}
      {opts.labels && (
        <Html position={midPoint(seg).add(new THREE.Vector3(0, 6, 0))} center distanceFactor={260} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-slate-200">{seg.id}</div>
        </Html>
      )}
    </group>
  );
}

/** Synthetic point cloud sampled from the tunnel geometry; visible only where the simulated rover has mapped. NOT LiDAR. */
function PointCloud({ mine, snap, colorMode, density }: { mine: MineMap; snap: Snapshot | null; colorMode: ColorMode; density: number }) {
  const data = useMemo(() => {
    const pos: number[] = [], off: number[] = [], segIdx: number[] = [], hts: number[] = [];
    const ids: string[] = [];
    mine.segments.forEach((seg, si) => {
      ids.push(seg.id);
      let seed = 1234 + si * 977;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const cum = [0];
      for (let i = 1; i < seg.polyline.length; i++) cum.push(cum[i - 1] + Math.hypot(...(seg.polyline[i].map((c, k) => c - seg.polyline[i - 1][k]) as number[])));
      const total = cum[cum.length - 1];
      const n = Math.ceil(total * density);
      for (let k = 0; k < n; k++) {
        const s = rnd() * total;
        let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
        const u = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
        const a = seg.polyline[i - 1], b = seg.polyline[i];
        const c = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
        const tx = b[0] - a[0], tz = b[2] - a[2], tl = Math.hypot(tx, tz) || 1;
        const sx = -tz / tl, sz = tx / tl; // horizontal side vector
        const ang = rnd() * Math.PI * 2, r = (seg.width_m / 2) * (0.88 + 0.12 * rnd());
        const lateral = Math.cos(ang) * r, vert = Math.sin(ang) * r * 0.75;
        pos.push(c[0] + sx * lateral, (c[1] + vert) * EXAG, c[2] + sz * lateral);
        off.push(s); segIdx.push(si); hts.push(c[1] + vert);
      }
    });
    return { pos: new Float32Array(pos), off: new Float32Array(off), segIdx: Uint16Array.from(segIdx), hts: Float32Array.from(hts), ids };
  }, [mine, density]);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(data.pos.length), 3));
    g.setAttribute("vis", new THREE.BufferAttribute(new Float32Array(data.off.length), 1));
    return g;
  }, [data]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uSize: { value: density > 6 ? 2.0 : 3.0 } },
    vertexShader: "attribute vec3 aColor; attribute float vis; varying vec3 vC; varying float vV; uniform float uSize; void main(){ vC=aColor; vV=vis; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = vis>0.5 ? uSize*(320.0/-mv.z) : 0.0; gl_Position=projectionMatrix*mv; }",
    fragmentShader: "varying vec3 vC; varying float vV; void main(){ if(vV<0.5) discard; vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; gl_FragColor=vec4(vC,0.85); }",
  }), [density]);

  const exploredKey = snap ? mine.segments.map((s) => (snap.segments[s.id]?.mapping.intervals ?? []).map((i) => i.join("-")).join(",")).join("|") : "";
  const stateKey = snap ? mine.segments.map((s) => snap.segments[s.id]?.state).join("") : "";
  const valKey = snap && (colorMode === "temp" || colorMode === "ch4") ? mine.segments.map((s) => snap.segments[s.id]?.values[colorMode]?.toFixed(1)).join() : "";
  useEffect(() => {
    if (!snap) return;
    const vis = geo.getAttribute("vis") as THREE.BufferAttribute;
    const col = geo.getAttribute("aColor") as THREE.BufferAttribute;
    const segCols = data.ids.map((id) => segColor(mine.segments.find((s) => s.id === id)!, snap, colorMode));
    const ivs = data.ids.map((id) => snap.segments[id]?.mapping.intervals ?? []);
    for (let p = 0; p < data.off.length; p++) {
      const si = data.segIdx[p], o = data.off[p];
      vis.setX(p, ivs[si].some(([a, b]) => o >= a && o <= b) ? 1 : 0);
      const c = colorMode === "height" || colorMode === "mapping" ? ramp(heightU(data.hts[p])) : segCols[si].clone().multiplyScalar(0.75 + 0.25 * ((p * 37) % 10) / 10);
      col.setXYZ(p, c.r, c.g, c.b);
    }
    vis.needsUpdate = true; col.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploredKey, colorMode, geo, data, mine, stateKey, valKey]);
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

function Pin({ pos, color, label, onClick, size = 3, labelOn = true, ring = false, pulse = false }: { pos: THREE.Vector3; color: string; label: string; onClick?: () => void; size?: number; labelOn?: boolean; ring?: boolean; pulse?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (pulse && ref.current) ref.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 5)); });
  return (
    <group position={pos}>
      <mesh ref={ref} onClick={(e: any) => { e.stopPropagation(); onClick?.(); }} onPointerOver={() => onClick && (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "auto")}>
        <sphereGeometry args={[size, 16, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {ring && <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[size * 1.5, size * 1.8, 24]} /><meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} /></mesh>}
      {labelOn && <Html position={[0, size + 5, 0]} center distanceFactor={240} style={{ pointerEvents: "none" }}><div className="whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ borderLeft: `2px solid ${color}` }}>{label}</div></Html>}
    </group>
  );
}

function RoverMarker({ snap, labelOn }: { snap: Snapshot; labelOn: boolean }) {
  const r = snap.rover;
  const ref = useRef<THREE.Group>(null);
  const target = useMemo(() => P(r.pos).add(new THREE.Vector3(0, 3, 0)), [r.pos]);
  useFrame(() => { if (ref.current) ref.current.position.lerp(target, 0.25); });
  const rad = (r.heading * Math.PI) / 180;
  return (
    <group ref={ref} position={target}>
      <group rotation={[0, rad - Math.PI / 2, 0]}>
        <mesh><boxGeometry args={[7, 3.5, 4.5]} /><meshBasicMaterial color={r.connection === "lost" ? "#fbbf24" : "#2dd4bf"} /></mesh>
        <mesh position={[4.6, 0, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[2.2, 4, 12]} /><meshBasicMaterial color="#e6fffb" /></mesh>
      </group>
      {labelOn && <Html position={[0, 9, 0]} center distanceFactor={240} style={{ pointerEvents: "none" }}><div className="whitespace-nowrap rounded bg-teal-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-teal-100">{r.id}</div></Html>}
    </group>
  );
}

function CameraRig({ nonce, mini }: { nonce: number; mini: boolean }) {
  const { camera, controls } = useThree() as any;
  useEffect(() => {
    camera.position.set(mini ? 170 : 150, mini ? 330 : 300, mini ? 330 : 360);
    camera.lookAt(CENTER);
    if (controls) { controls.target.copy(CENTER); controls.update(); }
  }, [nonce, camera, controls, mini]);
  return null;
}

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

export interface MineSceneProps {
  mine: MineMap | null; snap: Snapshot | null; opts?: SceneOpts; selectedSegment?: string | null; onSelectSegment?: (id: string | null) => void;
  onSelectWorker?: (id: string) => void; extraRoutes?: ExtraRoute[]; trajectory?: number[][]; trajectoryCount?: number; resetNonce?: number;
  mini?: boolean; navRoute?: NavLive | null; className?: string;
}

export function MineScene({ mine, snap, opts = DEFAULT_OPTS, selectedSegment = null, onSelectSegment = () => undefined, onSelectWorker = () => undefined,
  extraRoutes = [], trajectory, trajectoryCount, resetNonce = 0, mini = false, navRoute, className = "" }: MineSceneProps) {
  const { t, name } = useI18n();
  const traj = trajectory ?? snap?.rover.trajectory ?? [];
  const n = Math.min(trajectoryCount ?? traj.length, traj.length);
  const trajPts = useMemo(() => traj.slice(0, n).map(P), [traj, n]);
  const trajCols = useMemo(() => trajPts.map((_, i) => { const c = ramp(i / Math.max(trajPts.length - 1, 1)); return [c.r, c.g, c.b] as [number, number, number]; }), [trajPts]);
  const nodes = mine?.nodes ?? [];
  const fallback = <div className={`flex items-center justify-center rounded-xl border border-line bg-panel p-6 text-center text-xs text-mute ${className}`}>{t("map.webglFail")}</div>;
  if (!mine) return <div className={`flex items-center justify-center rounded-xl border border-line bg-panel text-xs text-mute ${className}`}>{t("common.loading")}</div>;
  return (
    <Boundary fallback={fallback}>
      <div className={`relative overflow-hidden rounded-xl border border-line bg-[#070c12] ${className}`}>
        <Canvas camera={{ fov: 42, near: 1, far: 4000, position: [150, 300, 360] }} dpr={[1, 1.75]} onPointerMissed={() => onSelectSegment(null)} gl={{ antialias: true }}>
          <color attach="background" args={["#070c12"]} />
          <Suspense fallback={null}>
            <gridHelper args={[900, 45, "#16283a", "#0f1c2a"]} position={[175, -150, 55]} />
            {mine.segments.map((s) => <Tunnel key={s.id} seg={s} snap={snap} opts={opts} selected={selectedSegment === s.id} onSelect={onSelectSegment} />)}
            {opts.cloud && <PointCloud mine={mine} snap={snap} colorMode={opts.colorMode} density={mini ? 4 : 12} />}
            {nodes.filter((nd) => nd.emergency_exit || nd.checkpoint || nd.kind === "dead_end").map((nd) => (
              <Pin key={nd.id} pos={P(nd.pos)} size={nd.emergency_exit ? 3.2 : 2} color={nd.emergency_exit ? "#34d399" : nd.kind === "dead_end" ? "#f472b6" : "#a5b4fc"} label={name(nd.id, nd.name)} labelOn={opts.labels && !mini} ring={nd.emergency_exit} />
            ))}
            {opts.sensors && snap && mine.segments.map((s) => {
              const lv = snap.segments[s.id];
              const c = lv.sensor_status === "ok" ? "#38bdf8" : lv.sensor_status === "fault" ? "#f87171" : "#fbbf24";
              return <Pin key={"sn" + s.id} pos={midPoint(s).add(new THREE.Vector3(0, 2, 0))} size={1.6} color={c} label={lv.sensor_id} labelOn={opts.labels && !mini} />;
            })}
            {opts.workers && snap && snap.workers.map((w) => (
              <Pin key={w.id} pos={P(w.pos).add(new THREE.Vector3(0, 4, 0))} size={3} color={w.evacuated ? "#34d399" : w.stale ? "#fbbf24" : w.nav_mode === "emergency" ? "#f87171" : "#e0f2fe"} label={`${w.callsign}`}
                onClick={() => onSelectWorker(w.id)} ring={w.stale || w.hazard?.near === true} pulse={w.stale} labelOn={!mini} />
            ))}
            {opts.rover && snap && <RoverMarker snap={snap} labelOn={!mini} />}
            {opts.trajectory && trajPts.length > 1 && <Line points={trajPts} vertexColors={trajCols} lineWidth={2.5} />}
            {opts.route && navRoute?.found && navRoute.path.length > 1 && <Line points={navRoute.path.map(P)} color={navRoute.mode === "emergency" ? "#f87171" : "#22d3ee"} lineWidth={6} dashed dashSize={6} gapSize={3} />}
            {extraRoutes.filter((r) => r.path.length > 1).map((r, i) => <Line key={i} points={r.path.map(P)} color={r.color} lineWidth={r.width ?? 5} dashed={r.dashed} dashSize={6} gapSize={4} />)}
          </Suspense>
          <OrbitControls makeDefault enableDamping dampingFactor={0.1} maxPolarAngle={Math.PI * 0.49} minDistance={30} maxDistance={1400} target={[CENTER.x, CENTER.y, CENTER.z]} />
          <CameraRig nonce={resetNonce} mini={mini} />
        </Canvas>
      </div>
    </Boundary>
  );
}

export function MapLegend({ mode }: { mode: ColorMode }) {
  const { t } = useI18n();
  const Row = ({ c, l, dashed = false }: { c: string; l: string; dashed?: boolean }) => (
    <div className="flex items-center gap-2"><span className="inline-block h-0 w-5 border-t-[3px]" style={{ borderColor: c, borderStyle: dashed ? "dashed" : "solid" }} /><span>{l}</span></div>
  );
  const gradient = "linear-gradient(90deg,#2563eb,#22d3ee,#34d399,#facc15,#fb923c,#ef4444)";
  return (
    <div className="space-y-2.5 text-[11px] text-mute">
      <div className="lbl">{t("legend.title")}</div>
      {mode === "state" && <div className="space-y-1"><Row c="#34d399" l={t("state.SAFE")} /><Row c="#fbbf24" l={t("state.WARNING")} /><Row c="#f87171" l={t("state.DANGER")} /><Row c="#94a3b8" l={t("state.UNKNOWN")} /></div>}
      {mode === "mapping" && <div className="space-y-1"><Row c="#2dd4bf" l={t("mapping.explored")} /><Row c="#22d3ee" l={t("mapping.partial")} /><Row c="#475569" l={t("mapping.unexplored")} dashed /></div>}
      {mode === "height" && <div><div className="h-2 rounded" style={{ background: gradient }} /><div className="mt-1 flex justify-between"><span>{t("legend.shallow")}</span><span>{t("legend.deep")}</span></div><div className="mt-1 text-amber-300/80">{t("legend.decorative")}</div></div>}
      {mode === "temp" && <div><div className="h-2 rounded" style={{ background: gradient }} /><div className="mt-1 flex justify-between"><span>{TEMP_RANGE[0]} °C</span><span>{TEMP_RANGE[1]} °C</span></div><div className="mt-1">{t("legend.measured")}</div></div>}
      {mode === "ch4" && <div><div className="h-2 rounded" style={{ background: gradient }} /><div className="mt-1 flex justify-between"><span>{CH4_RANGE[0]} %</span><span>{CH4_RANGE[1]} % vol</span></div><div className="mt-1">{t("legend.measured")}</div></div>}
      <div className="space-y-1 border-t border-line pt-2">
        <Row c="#475569" l={t("legend.unexploredDashed")} dashed />
        <Row c="#a78bfa" l={t("legend.restricted")} dashed />
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-100" />{t("legend.worker")}</div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-teal-400" />{t("legend.rover")}</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-400" />{t("legend.sensor")}</div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40" />{t("legend.exit")}</div>
        <Row c="#22d3ee" l={t("legend.route")} dashed />
        <div className="flex items-center gap-2"><span className="h-1.5 w-5 rounded" style={{ background: gradient }} />{t("legend.trajectory")}</div>
      </div>
      <div className="border-t border-line pt-2 text-[10.5px] leading-snug">{t("legend.cloudNote")}</div>
    </div>
  );
}
