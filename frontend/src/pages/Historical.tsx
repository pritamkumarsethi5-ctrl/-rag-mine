import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { CoverageChart, MetricChart, SimpleBars } from "../components/charts";
import { Card, PageHeader, SimNotice } from "../components/ui";
import { downloadText, epochToHM, fmtTime, toCsv, fmtNum } from "../lib/format";
import { useHistory } from "../lib/useHistory";
import { useStore } from "../store";
import { GAS_INFO, GAS_KEYS, type Analytics, type GasKey } from "../types";
import { RangePicker, useRange } from "./Gas";

export default function Historical() {
  const { t, name } = useI18n();
  const { snap } = useStore();
  const r = useRange(snap?.sim_time);
  const [gas, setGas] = useState<GasKey>("ch4");
  const [dataset, setDataset] = useState("gas");
  const [an, setAn] = useState<Analytics | null>(null);
  const q = { ...r.query, every: 5000, max_points: 200 };
  const g = useHistory({ metrics: [...GAS_KEYS], ...q });
  const e = useHistory({ metrics: ["temp", "rh", "pressure"], ...q });
  const rangeKey = r.range === "custom" ? "6h" : r.range;
  useEffect(() => {
    let alive = true;
    const load = () => api.analytics(rangeKey).then((d) => alive && setAn(d)).catch(() => undefined);
    load();
    const id = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [rangeKey]);
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const th = snap.thresholds;
  const exportCsv = () => {
    if (dataset === "gas" || dataset === "env") {
      const h = dataset === "gas" ? g.data : e.data;
      if (!h) return;
      const ms = Object.keys(h.series);
      downloadText(`ragmine_${dataset}_SIMULATED.csv`, toCsv(["sim_time_utc", "data_source", ...ms.map((m) => `${m} (${h.units[m]})`)], h.t.map((tt, i) => [new Date(tt * 1000).toISOString(), "SIMULATED", ...ms.map((m) => h.series[m].v[i])])));
    } else if (an && dataset === "events") downloadText("ragmine_events_SIMULATED.csv", toCsv(["sim_time_utc", "warning_events", "critical_events"], an.event_buckets.map((b) => [new Date(b.t * 1000).toISOString(), b.warning, b.critical])));
    else if (an && dataset === "coverage") downloadText("ragmine_coverage_SIMULATED.csv", toCsv(["sim_time_utc", "coverage_pct", "explored_m"], an.coverage.map((c) => [new Date(c.t * 1000).toISOString(), c.coverage_pct, c.explored_m])));
    else if (an && dataset === "hazard") downloadText("ragmine_hazard_distribution_SIMULATED.csv", toCsv(["segment", "name", "warning_s", "critical_s"], an.hazard_distribution.map((h) => [h.segment_id, h.name, h.warning_s, h.critical_s])));
    else if (an && dataset === "exposure") downloadText("ragmine_worker_exposure_SIMULATED.csv", toCsv(["sim_time", "worker", "segment", "state"], an.exposure.map((x) => [x.time, x.worker_id, x.segment_id, x.state])));
  };
  return (
    <div>
      <PageHeader title={t("nav.history")} sub={t("hist.sub")} right={<>
        <select className="input" value={dataset} onChange={(e2) => setDataset(e2.target.value)}>{["gas", "env", "events", "coverage", "hazard", "exposure"].map((d) => <option key={d} value={d}>{t(`hist.ds.${d}`)}</option>)}</select>
        <button className="btn" onClick={exportCsv}><Download size={14} />{t("common.exportCsv")}</button></>} />
      <div className="mb-3 flex flex-wrap items-center gap-3"><RangePicker r={r} t={t} /><span className="text-[11px] text-mute">{g.data ? `${g.data.samples} ${t("hist.records")} · ${fmtTime(g.data.from)}–${fmtTime(g.data.to)}` : ""}</span></div>
      <div className="mb-3"><SimNotice k="hist.notice" /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("hist.gas")} right={<select className="input !py-1" value={gas} onChange={(e2) => setGas(e2.target.value as GasKey)}>{GAS_KEYS.map((k) => <option key={k} value={k}>{GAS_INFO[k].formula} ({GAS_INFO[k].unit})</option>)}</select>}>
          <MetricChart data={g.data} metric={gas} thresholds={th[gas]} height={230} />
          {g.data?.stats[gas] && <div className="mt-1 text-[11px] text-mute tabular-nums">{t("stat.min")} {fmtNum(g.data.stats[gas]!.min, 2)} · {t("stat.max")} {fmtNum(g.data.stats[gas]!.max, 2)} · {t("stat.avg")} {fmtNum(g.data.stats[gas]!.avg, 2)} {GAS_INFO[gas].unit}</div>}
        </Card>
        <Card title={t("hist.events")}>
          <div className="mb-1 flex gap-4 text-xs"><span><b className="text-warn tabular-nums">{an?.events.warning ?? 0}</b> {t("sev.warning")}</span><span><b className="text-crit tabular-nums">{an?.events.critical ?? 0}</b> {t("sev.critical")}</span><span className="text-mute">{t("hist.eventDef")}</span></div>
          <SimpleBars data={an?.event_buckets ?? []} x="t" bars={["warning", "critical"]} colors={["#fbbf24", "#f87171"]} stacked xFormatter={(v: number) => epochToHM(v)} height={200} />
        </Card>
        <Card title={`${t("env.temp")} (°C)`}><MetricChart data={e.data} metric="temp" height={190} area /></Card>
        <Card title={`${t("env.rh")} (%)`}><MetricChart data={e.data} metric="rh" height={190} area /></Card>
        <Card title={`${t("env.pressure")} (hPa)`}><MetricChart data={e.data} metric="pressure" height={190} area /></Card>
        <Card title={t("hist.coverage")} right={<span className="text-[11px] text-mute">{t("hist.sessionOnly")}</span>}><CoverageChart data={an?.coverage ?? []} height={190} />
          <div className="text-[11px] text-mute">{t("hist.odometer")}: {fmtNum(an?.rover_history.odometer_m, 0)} m · {an?.rover_history.trajectory_points ?? 0} {t("map.points")}</div></Card>
        <Card title={t("hist.hazardDist")} className="lg:col-span-2">
          <SimpleBars height={220} data={(an?.hazard_distribution ?? []).map((h) => ({ ...h, label: h.segment_id, warning_min: +(h.warning_s / 60).toFixed(1), critical_min: +(h.critical_s / 60).toFixed(1) }))} x="label" bars={["warning_min", "critical_min"]} colors={["#fbbf24", "#f87171"]} stacked />
          <div className="text-[11px] text-mute">{t("hist.minutes")}</div>
        </Card>
        <Card title={t("hist.exposure")} className="lg:col-span-2" right={<span className="text-xs text-mute">{an?.exposure_total ?? 0} · {t("hist.sessionOnly")}</span>} pad={false}>
          <div className="max-h-[260px] overflow-auto"><table className="w-full"><thead><tr><th className="th">{t("alerts.time")}</th><th className="th">{t("workers.callsign")}</th><th className="th">{t("worker.segment")}</th><th className="th">{t("alerts.severity")}</th></tr></thead><tbody>
            {[...(an?.exposure ?? [])].reverse().map((x, i) => <tr key={i}><td className="td tabular-nums">{fmtTime(x.time)}</td><td className="td">{x.worker_id}</td><td className="td">{name(x.segment_id)} ({x.segment_id})</td><td className="td">{t(`state.${x.state}`)}</td></tr>)}
            {!an?.exposure.length && <tr><td className="td text-mute" colSpan={4}>{t("hist.noExposure")}</td></tr>}
          </tbody></table></div>
        </Card>
      </div>
    </div>
  );
}
