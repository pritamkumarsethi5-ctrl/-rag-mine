import { Activity, Bot, Droplets, Gauge, HardHat, Layers, ShieldAlert, Thermometer, AlertTriangle, Wind } from "lucide-react";
import { useI18n } from "../i18n";
import { MultiGasChart } from "../components/charts";
import { MineScene, DEFAULT_OPTS } from "../components/MineScene";
import type { PageId } from "../components/Shell";
import { Bar, Card, KpiCard, SevBadge, StateBadge } from "../components/ui";
import { fmtNum, fmtTime, trendArrow, STATE_COLOR } from "../lib/format";
import { alertDescription } from "../lib/text";
import { useHistory } from "../lib/useHistory";
import { useStore } from "../store";
import { GAS_INFO, GAS_KEYS, type GasKey } from "../types";

export default function Overview({ go }: { go: (p: PageId) => void }) {
  const { t, name } = useI18n();
  const { snap, mine, selectSegment } = useStore();
  const { data } = useHistory({ metrics: [...GAS_KEYS], range: "15m", every: 3000, max_points: 120 });
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const k = snap.kpi, sa = snap.safety, up = snap.sim_time;
  const gasWarn = Object.values(snap.segments).filter((s) => s.reasons.some((r) => r.code === "gas_warning" || r.code === "gas_critical")).length;
  const hazards = snap.emergency.hazards.length;
  const wk = snap.workers;
  const wCount = (f: (w: (typeof wk)[0]) => boolean) => wk.filter(f).length;
  const r = snap.rover, m = snap.mapping;
  const stateNums = { DANGER: sa.counts.danger, WARNING: sa.counts.warning, UNKNOWN: sa.counts.unknown, SAFE: snap.safety.monitoring.segments_total - sa.counts.danger - sa.counts.warning - sa.counts.unknown };
  const nav = snap.navigation;
  const tr = (d: number | null | undefined, dec: number) => d === null || d === undefined ? "—" : `${trendArrow(d, 0.5 * 10 ** -dec)} ${d > 0 ? "+" : ""}${d.toFixed(dec)} / 5 min`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label={t("kpi.safety")} value={t(`state.${sa.state}`)} state={sa.state} icon={<ShieldAlert size={16} />} updated={up} onClick={() => go("alerts")}
          sub={`${t("kpi.monitoring")} ${snap.safety.monitoring.segments_valid}/${snap.safety.monitoring.segments_total}`} />
        <KpiCard label={t("kpi.hazards")} value={hazards} state={hazards ? "DANGER" : "SAFE"} icon={<AlertTriangle size={16} />} updated={up} onClick={() => go("alerts")} sub={t("kpi.hazardsSub")} />
        <KpiCard label={t("kpi.gasWarnings")} value={gasWarn} state={gasWarn ? "WARNING" : "SAFE"} icon={<Wind size={16} />} updated={up} onClick={() => go("gas")} sub={t("kpi.gasWarningsSub")} />
        <KpiCard label={t("kpi.workers")} value={wk.length} icon={<HardHat size={16} />} updated={up} onClick={() => go("workers")}
          state={wCount((w) => w.stale) ? "WARNING" : "SAFE"} sub={`${wCount((w) => w.speed_mps > 0)} ${t("kpi.moving")} · ${wCount((w) => w.stale)} ${t("worker.stale")}`} />
        <KpiCard label={t("kpi.rover")} value={t(`rmode.${r.mode}`)} icon={<Bot size={16} />} updated={r.last_telemetry} onClick={() => go("rover")}
          state={r.connection === "lost" ? "WARNING" : "NA"} sub={`${r.battery_pct.toFixed(0)}% · ${t(`rtask.${r.task}`)}`} />
        <KpiCard label={t("kpi.mapped")} value={`${m.coverage_pct.toFixed(1)}`} unit="%" icon={<Layers size={16} />} updated={m.last_mapped} onClick={() => go("map")}
          sub={`${m.segments_explored}/${m.segments_total} ${t("kpi.segments")} · ${Math.round(m.explored_m)}/${Math.round(m.total_m)} m`} />
        <KpiCard label={t("env.temp")} value={fmtNum(k.env.temp.value, 1)} unit="°C" icon={<Thermometer size={16} />} updated={up} onClick={() => go("gas")} trend={tr(k.env.temp.trend, 1)} />
        <KpiCard label={t("env.rh")} value={fmtNum(k.env.rh.value, 1)} unit="%" icon={<Droplets size={16} />} updated={up} onClick={() => go("gas")} trend={tr(k.env.rh.trend, 1)} />
        <KpiCard label={t("env.pressure")} value={fmtNum(k.env.pressure.value, 1)} unit="hPa" icon={<Gauge size={16} />} updated={up} onClick={() => go("gas")} trend={tr(k.env.pressure.trend, 2)} />
        <KpiCard label={t("kpi.nav")} value={nav.length} icon={<Activity size={16} />} updated={up} onClick={() => go("navigation")}
          sub={nav.length ? nav.map((n) => `${n.worker_id}: ${t(`navstatus.${n.status}`)}`).join(" · ") : t("kpi.navIdle")} />
      </div>
      <p className="text-[11px] text-mute">{t("kpi.defs")}</p>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title={t("ov.gasTrends")} right={<button className="text-[11px] text-accent" onClick={() => go("gas")}>{t("common.details")}</button>}>
          <MultiGasChart data={data} thresholds={snap.thresholds} gases={GAS_KEYS} height={250} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
            {GAS_KEYS.map((g: GasKey) => <span key={g} className="tabular-nums"><b className="text-ink">{GAS_INFO[g].formula}</b> {fmtNum(k.gas[g].value, GAS_INFO[g].decimals)} {GAS_INFO[g].unit} {trendArrow(k.gas[g].trend)}</span>)}
          </div>
          <p className="mt-1 text-[10.5px] text-mute">{t("chart.ratioNote")}</p>
        </Card>
        <Card className="xl:col-span-2" title={t("ov.miniMap")} right={<button className="text-[11px] text-accent" onClick={() => go("map")}>{t("common.open")}</button>} pad={false}>
          <div className="px-3 pb-3"><MineScene mine={mine} snap={snap} mini className="h-[300px]" onSelectSegment={(id) => { selectSegment(id); if (id) go("map"); }}
            opts={{ ...DEFAULT_OPTS, labels: false, sensors: false }} /></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title={t("ov.timeline")}>
          <ul className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
            {[...snap.timeline].reverse().slice(0, 14).map((e, i) => (
              <li key={i} className="flex gap-2 text-xs"><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: e.severity === "critical" ? "#f87171" : e.severity === "warning" ? "#fbbf24" : "#22d3ee" }} />
                <span className="min-w-0 flex-1"><span className="tabular-nums text-mute">{fmtTime(e.time)}</span> {t(`tl.${e.kind}`, { ...e.params, old: e.params.old ? t(`state.${e.params.old}`) : "", new: e.params.new ? t(`state.${e.params.new}`) : "", seg: e.params.segment_id ? name(e.params.segment_id) : "", gas: e.params.gas ? t(`gas.${e.params.gas}`) : "", cat: e.params.category ? t(`cat.${e.params.category}`) : "", zone: e.params.zone ? t(`zone.${e.params.zone}`) : "" })}</span></li>
            ))}
            {!snap.timeline.length && <li className="text-xs text-mute">{t("ov.noEvents")}</li>}
          </ul>
        </Card>
        <Card title={t("ov.recentAlerts")} right={<button className="text-[11px] text-accent" onClick={() => go("alerts")}>{t("common.viewAll")}</button>}>
          <ul className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
            {snap.alerts.recent.filter((a) => a.severity !== "info").slice(0, 8).map((a) => (
              <li key={a.id} className="rounded-lg border border-line px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><SevBadge sev={a.severity} /><b>{t(`cat.${a.category}`)}</b></span><span className="tabular-nums text-mute">{fmtTime(a.time)}</span></div>
                <div className="mt-1 line-clamp-2 text-[11.5px] text-mute">{alertDescription(t, name, a)}</div>
              </li>
            ))}
            {!snap.alerts.recent.some((a) => a.severity !== "info") && <li className="text-xs text-mute">{t("alerts.none")}</li>}
          </ul>
        </Card>
        <Card title={t("ov.hazardDist")}>
          <div className="space-y-2">
            {(["SAFE", "WARNING", "DANGER", "UNKNOWN"] as const).map((s) => (
              <div key={s}><div className="mb-1 flex justify-between text-xs"><StateBadge state={s} small /><span className="tabular-nums text-mute">{stateNums[s]} / {snap.safety.monitoring.segments_total}</span></div>
                <Bar pct={(100 * stateNums[s]) / snap.safety.monitoring.segments_total} color={STATE_COLOR[s]} /></div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">{Object.values(snap.safety.zones).map((z) => (
            <div key={z.zone} className="rounded-lg border border-line p-1.5 text-center"><div className="text-[10px] text-mute">{t(`zone.${z.zone}`)}</div><StateBadge state={z.state} small /></div>))}</div>
        </Card>
        <Card title={t("ov.workerSummary")}>
          <table className="w-full text-xs"><tbody>
            {wk.map((w) => <tr key={w.id} className="border-t border-line/60 first:border-0"><td className="py-1.5 font-medium">{w.callsign}</td><td className="text-mute">{w.segment_id}</td><td>{t(`wstatus.${w.status}`)}</td><td className="text-right">{w.stale ? <span className="text-warn">⚠ {t("worker.stale")}</span> : <StateBadge state={w.segment_state} small />}</td></tr>)}
          </tbody></table>
        </Card>
        <Card title={t("ov.roverStatus")}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div><dt className="lbl">{t("rover.mode")}</dt><dd>{t(`rmode.${r.mode}`)}</dd></div>
            <div><dt className="lbl">{t("rover.task")}</dt><dd>{t(`rtask.${r.task}`)}</dd></div>
            <div><dt className="lbl">{t("rover.segment")}</dt><dd>{name(r.segment_id)}</dd></div>
            <div><dt className="lbl">{t("rover.speed")}</dt><dd>{fmtNum(r.speed_mps, 2)} m/s</dd></div>
          </dl>
          <div className="mt-3"><div className="mb-1 flex justify-between text-xs"><span className="text-mute">{t("rover.battery")}</span><span className="tabular-nums">{r.battery_pct.toFixed(0)}%</span></div><Bar pct={r.battery_pct} color={r.battery_pct < 25 ? "#f87171" : "#2dd4bf"} /></div>
          <div className="mt-3"><div className="mb-1 flex justify-between text-xs"><span className="text-mute">{t("map.coverage")}</span><span className="tabular-nums">{m.coverage_pct.toFixed(1)}%</span></div><Bar pct={m.coverage_pct} color="#22d3ee" /></div>
          <p className="mt-2 text-[10.5px] text-mute">{t("map.notSlam")}</p>
        </Card>
      </div>
    </div>
  );
}
