import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Home, Map as MapIcon, Pause, Play, Square } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { TrajectoryChart } from "../components/charts";
import { DEFAULT_OPTS, MineScene } from "../components/MineScene";
import { Bar, Card, PageHeader, Pill, SimNotice } from "../components/ui";
import { fmtDateTime, fmtNum, fmtTime } from "../lib/format";
import { useStore } from "../store";

export default function Rover() {
  const { t, name } = useI18n();
  const { snap, mine, run } = useStore();
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const r = snap.rover, m = snap.mapping;
  const cmd = (c: string) => run(() => api.roverCommand(c));
  const B = ({ c, icon, label, cls = "" }: { c: string; icon: ReactNode; label: string; cls?: string }) => <button className={`btn ${cls}`} onClick={() => cmd(c)}>{icon}{label}</button>;
  return (
    <div>
      <PageHeader title={t("nav.rover")} sub={t("rover.sub")} right={<Pill color="#fbbf24">{t("rover.adapter")}: {t("rover.adapterSim")}</Pill>} />
      <div className="mb-3"><SimNotice k="rover.notice" /></div>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              [t("rover.id"), r.id], [t("rover.mode"), t(`rmode.${r.mode}`)], [t("rover.task"), t(`rtask.${r.task}`)],
              [t("rover.connection"), t(`rconn.${r.connection}`)], [t("rover.segment"), `${name(r.segment_id)} (${r.segment_id})`], [t("rover.heading"), `${fmtNum(r.heading, 0)}°`],
              [t("rover.speed"), `${fmtNum(r.speed_mps, 2)} m/s`], [t("rover.odometer"), `${fmtNum(r.odometer_m, 0)} m`],
            ].map(([l, v]) => <div key={String(l)} className="card p-3"><div className="lbl">{l}</div><div className={`mt-1 text-[15px] font-semibold ${l === t("rover.connection") && r.connection === "lost" ? "text-warn" : ""}`}>{v}</div></div>)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title={t("rover.battery")}><div className="flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums">{r.battery_pct.toFixed(1)}%</span>{r.mode === "docked" && <Pill color="#2dd4bf">{t("rtask.charging")}</Pill>}{r.low_battery_return && <Pill color="#fbbf24">{t("rover.lowBattery")}</Pill>}</div><div className="mt-2"><Bar pct={r.battery_pct} color={r.battery_pct < 25 ? "#f87171" : "#2dd4bf"} /></div></Card>
            <Card title={t("rover.mapping")}><div className="flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums">{m.coverage_pct.toFixed(1)}%</span><Pill color={r.mapping ? "#34d399" : "#94a3b8"}>{r.mapping ? t("rover.mappingOn") : t("rover.mappingOff")}</Pill></div><div className="mt-2"><Bar pct={m.coverage_pct} color="#22d3ee" /></div><div className="mt-1.5 text-[11px] text-mute">{t("rover.lastTelemetry")}: {fmtDateTime(r.last_telemetry)} {r.connection === "lost" && <span className="text-warn">· {t("rover.age", { s: Math.round(r.age_s) })}</span>}</div></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t("rover.trajectory2d")} right={<span className="text-[11px] text-mute">{r.traj_count} {t("map.points")}</span>}><TrajectoryChart points={r.trajectory} current={r.pos} height={250} /><p className="mt-1 text-[10.5px] text-mute">{t("rover.xzNote")}</p></Card>
            <MineScene mine={mine} snap={snap} className="h-[310px]" opts={{ ...DEFAULT_OPTS, workers: false, labels: false, cloud: false, sensors: false }} />
          </div>
        </div>
        <div className="space-y-4">
          <Card title={t("rover.controls")}>
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">{t("rover.simOnly")}</div>
            <div className="mx-auto mt-3 grid max-w-[220px] grid-cols-3 gap-2">
              <span /><B c="forward" icon={<ArrowUp size={16} />} label="" cls="!py-2.5" /><span />
              <B c="turn_left" icon={<ArrowLeft size={16} />} label="" cls="!py-2.5" /><B c="stop" icon={<Square size={15} />} label="" cls="!py-2.5 btn-danger" /><B c="turn_right" icon={<ArrowRight size={16} />} label="" cls="!py-2.5" />
              <span /><B c="backward" icon={<ArrowDown size={16} />} label="" cls="!py-2.5" /><span />
            </div>
            <div className="mt-1 text-center text-[10.5px] text-mute">{t("rover.dpad")}</div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <B c="start_mapping" icon={<Play size={14} />} label={t("rover.cmd.start_mapping")} cls="btn-primary" />
              <B c="pause_mapping" icon={<Pause size={14} />} label={t("rover.cmd.pause_mapping")} />
              <B c="return_to_base" icon={<Home size={14} />} label={t("rover.cmd.return_to_base")} />
            </div>
            <p className="mt-3 text-[10.5px] leading-snug text-mute">{t("rover.hwNote")}</p>
          </Card>
          <Card title={t("rover.obstacles")}>
            <ul className="space-y-1.5 text-xs">{[...r.obstacles].reverse().map((o, i) => <li key={i} className="flex justify-between rounded-lg border border-line px-2.5 py-1.5"><span>{t(`alert.d.rover_obstacle.${o.kind}`, { seg: name(o.segment_id) })}</span><span className="tabular-nums text-mute">{fmtTime(o.time)}</span></li>)}
              {!r.obstacles.length && <li className="text-mute">{t("rover.noObstacles")}</li>}</ul>
          </Card>
          <Card title={t("rover.mappingStatus")}>
            <ul className="space-y-1 text-xs">{Object.values(snap.segments).map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><span className="w-12 font-mono text-mute">{s.id}</span><div className="flex-1"><Bar pct={s.mapping.ratio * 100} color={s.mapping.state === "explored" ? "#2dd4bf" : "#22d3ee"} /></div><span className="w-20 text-right text-mute">{t(`mapping.${s.mapping.state}`)}</span></li>)}</ul>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-mute"><MapIcon size={12} />{t("map.notSlam")}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
