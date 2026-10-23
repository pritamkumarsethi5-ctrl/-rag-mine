import { useEffect, useRef, useState } from "react";
import { Camera, Pause, Play, RotateCcw, Repeat } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { DEFAULT_OPTS, MapLegend, MineScene, type ColorMode, type SceneOpts } from "../components/MineScene";
import { SegmentPanel, WorkerCard } from "../components/Panels";
import type { PageId } from "../components/Shell";
import { Bar, Card, PageHeader, Segmented, SimNotice, Toggle } from "../components/ui";
import { fmtDateTime, fmtNum } from "../lib/format";
import { useStore } from "../store";

export default function LiveMap({ go }: { go: (p: PageId) => void }) {
  const { t, name } = useI18n();
  const { snap, mine, selectedSegment, selectSegment, selectedWorker, selectWorker, run, notify } = useStore();
  const [opts, setOpts] = useState<SceneOpts>(() => { try { return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem("ragmine.mapopts") ?? "{}") }; } catch { return DEFAULT_OPTS; } });
  const [nonce, setNonce] = useState(0);
  const [replay, setReplay] = useState<{ on: boolean; idx: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { try { localStorage.setItem("ragmine.mapopts", JSON.stringify(opts)); } catch { /* ignore */ } }, [opts]);
  const set = <K extends keyof SceneOpts>(k: K, v: SceneOpts[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const traj = snap?.rover.trajectory ?? [];

  useEffect(() => {
    window.clearInterval(timer.current);
    if (replay?.on) {
      timer.current = window.setInterval(() => setReplay((r) => {
        if (!r) return r;
        const next = r.idx + Math.max(1, Math.round(traj.length / 120));
        return next >= traj.length ? { on: false, idx: traj.length } : { on: true, idx: next };
      }), 100);
    }
    return () => window.clearInterval(timer.current);
  }, [replay?.on, traj.length]);

  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const m = snap.mapping;
  const w = snap.workers.find((x) => x.id === selectedWorker);
  const modes: ColorMode[] = ["state", "mapping", "height", "temp", "ch4"];
  return (
    <div>
      <PageHeader title={t("nav.map")} sub={t("map.sub")} right={<Segmented value={opts.colorMode} onChange={(v) => set("colorMode", v)} size="sm" options={modes.map((c) => ({ value: c, label: t(`map.mode.${c}`) }))} />} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <div className="relative">
            <MineScene mine={mine} snap={snap} opts={opts} selectedSegment={selectedSegment} onSelectSegment={selectSegment} onSelectWorker={selectWorker}
              resetNonce={nonce} trajectory={traj} trajectoryCount={replay ? replay.idx : undefined} navRoute={snap.navigation[0] ?? null} className="h-[56vh] min-h-[380px]" />
            <div className="absolute left-3 top-3 flex flex-wrap gap-2">
              <button className="btn !py-1 bg-panel/90" onClick={() => setNonce((n) => n + 1)}><Camera size={14} />{t("map.resetCamera")}</button>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[10.5px] text-slate-300">{t("map.controlsHint")}</div>
            <div className="absolute right-3 top-3 rounded-md border border-warn/40 bg-black/70 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-warn">{t("top.simMode")} · {t("map.synthetic")}</div>
          </div>
          <Card title={t("map.layers")}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
              <Toggle on={opts.labels} onChange={(v) => set("labels", v)} label={t("map.labels")} />
              <Toggle on={opts.hazards} onChange={(v) => set("hazards", v)} label={t("map.hazards")} />
              <Toggle on={opts.workers} onChange={(v) => set("workers", v)} label={t("map.workers")} />
              <Toggle on={opts.rover} onChange={(v) => set("rover", v)} label={t("map.rover")} />
              <Toggle on={opts.route} onChange={(v) => set("route", v)} label={t("map.route")} />
              <Toggle on={opts.sensors} onChange={(v) => set("sensors", v)} label={t("map.sensors")} />
              <Toggle on={opts.cloud} onChange={(v) => set("cloud", v)} label={t("map.cloud")} />
              <Toggle on={opts.trajectory} onChange={(v) => set("trajectory", v)} label={t("map.trajectory")} />
            </div>
          </Card>
          <Card title={t("map.explore")} right={<span className="text-[11px] text-warn">{t("map.notSlam")}</span>}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 flex items-baseline justify-between"><span className="text-xs text-mute">{t("map.coverage")}</span><span className="text-xl font-semibold tabular-nums">{m.coverage_pct.toFixed(1)}%</span></div>
                <Bar pct={m.coverage_pct} color="#2dd4bf" />
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="lbl">{t("map.total")}</dt><dd className="tabular-nums">{fmtNum(m.total_m, 0)} m</dd></div>
                  <div><dt className="lbl">{t("map.explored")}</dt><dd className="tabular-nums">{fmtNum(m.explored_m, 0)} m</dd></div>
                  <div><dt className="lbl">{t("map.remaining")}</dt><dd className="tabular-nums">{fmtNum(m.remaining_m, 0)} m</dd></div>
                  <div><dt className="lbl">{t("map.current")}</dt><dd>{name(m.current_segment)}</dd></div>
                  <div className="col-span-2"><dt className="lbl">{t("map.lastMapped")}</dt><dd className="tabular-nums">{fmtDateTime(m.last_mapped)}</dd></div>
                </dl>
                {m.restricted_unexplored_m > 0 && <p className="mt-2 text-[11px] text-mute">{t("map.restrictedNote", { m: Math.round(m.restricted_unexplored_m) })}</p>}
                <p className="mt-1 text-[10.5px] text-mute">{m.definition}</p>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={() => run(() => api.roverCommand("start_mapping"))} disabled={snap.rover.mode === "auto"}><Play size={14} />{snap.rover.mode === "paused" && m.explored_m > 0 ? t("map.resume") : t("map.start")}</button>
                  <button className="btn" onClick={() => run(() => api.roverCommand("pause_mapping"))} disabled={snap.rover.mode === "paused"}><Pause size={14} />{t("sim.pause")}</button>
                  <button className="btn btn-danger" onClick={() => run(async () => { await api.reset(); notify(t("sim.resetDone")); })}><RotateCcw size={14} />{t("sim.reset")}</button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5"><span className="lbl mr-1">{t("sim.speed")}</span>{snap.speeds.map((s) => <button key={s} className={`btn !px-2 !py-1 ${snap.speed === s ? "btn-primary" : ""}`} onClick={() => run(() => api.speed(s))}>{s}×</button>)}</div>
                {!snap.running && <div className="text-[11px] text-warn">{t("map.simPaused")} <button className="underline" onClick={() => run(api.start)}>{t("sim.start")}</button></div>}
                <div className="rounded-lg border border-line p-2.5">
                  <div className="mb-1.5 flex items-center justify-between"><span className="lbl">{t("map.replay")}</span><span className="text-[11px] tabular-nums text-mute">{replay ? `${replay.idx}/${traj.length}` : `${traj.length} ${t("map.points")}`}</span></div>
                  <div className="flex items-center gap-2">
                    <button className="btn !py-1" disabled={traj.length < 2} onClick={() => setReplay({ on: true, idx: 1 })}><Repeat size={13} />{t("map.replayPlay")}</button>
                    {replay && <button className="btn !py-1" onClick={() => setReplay((r) => (r ? { ...r, on: !r.on } : r))}>{replay.on ? t("sim.pause") : t("map.resume")}</button>}
                    {replay && <button className="btn !py-1" onClick={() => setReplay(null)}>{t("map.live")}</button>}
                  </div>
                  {replay && <input type="range" className="mt-2 w-full accent-cyan-400" min={1} max={Math.max(traj.length, 2)} value={replay.idx} onChange={(e) => setReplay({ on: false, idx: +e.target.value })} />}
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-3">
          <Card><MapLegend mode={opts.colorMode} /></Card>
          {w && <WorkerCard w={w} onClose={() => selectWorker(null)} onNavigate={() => go("navigation")} />}
          {selectedSegment ? <SegmentPanel id={selectedSegment} onClose={() => selectSegment(null)} /> : <Card><div className="text-xs text-mute">{t("map.clickHint")}</div></Card>}
          <SimNotice />
        </div>
      </div>
    </div>
  );
}
