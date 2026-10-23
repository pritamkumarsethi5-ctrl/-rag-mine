import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { MetricChart, MultiGasChart, ValueBars } from "../components/charts";
import { Card, PageHeader, Pill, Segmented, SimNotice, StateBadge } from "../components/ui";
import { GAS_COLOR, SEV_COLOR, STATE_COLOR, downloadText, fmtNum, fmtTime, toCsv, epochToTime, trendArrow } from "../lib/format";
import { alertDescription } from "../lib/text";
import { useHistory } from "../lib/useHistory";
import { useStore } from "../store";
import { GAS_INFO, GAS_KEYS, type GasKey, type Snapshot } from "../types";

const RANGES = ["5m", "15m", "1h", "6h", "custom"] as const;

function gasState(g: GasKey, v: number | null, th: Snapshot["thresholds"][GasKey]): "SAFE" | "WARNING" | "DANGER" | "UNKNOWN" {
  if (v === null) return "UNKNOWN";
  if ((th.crit_high != null && v >= th.crit_high) || (th.crit_low != null && v <= th.crit_low)) return "DANGER";
  if ((th.warn_high != null && v >= th.warn_high) || (th.warn_low != null && v <= th.warn_low)) return "WARNING";
  return "SAFE";
}

export function useRange(snapTime?: string) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("15m");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const custom = range === "custom" && from && to ? { from: from + ":00Z", to: to + ":00Z" } : {};
  const defFrom = snapTime ? new Date(Date.parse(snapTime) - 3600e3).toISOString().slice(0, 16) : "";
  const defTo = snapTime ? snapTime.slice(0, 16) : "";
  return { range, setRange, from, to, setFrom, setTo, query: range === "custom" ? custom : { range }, defFrom, defTo };
}

export function RangePicker({ r, t }: { r: ReturnType<typeof useRange>; t: (k: string) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={r.range} onChange={(v) => { r.setRange(v); if (v === "custom") { if (!r.from) r.setFrom(r.defFrom); if (!r.to) r.setTo(r.defTo); } }} size="sm"
        options={RANGES.map((x) => ({ value: x, label: t(`range.${x}`) }))} />
      {r.range === "custom" && <>
        <input type="datetime-local" className="input !py-1" value={r.from} onChange={(e) => r.setFrom(e.target.value)} aria-label="from" />
        <input type="datetime-local" className="input !py-1" value={r.to} onChange={(e) => r.setTo(e.target.value)} aria-label="to" />
        <span className="text-[10.5px] text-mute">UTC · {t("range.customNote")}</span></>}
    </div>
  );
}

export default function Gas() {
  const { t, name } = useI18n();
  const { snap, mine, run, notify } = useStore();
  const [tab, setTab] = useState<"gas" | "env">("gas");
  const [sensor, setSensor] = useState("all");
  const [cmpGas, setCmpGas] = useState<GasKey>("ch4");
  const [edit, setEdit] = useState<GasKey | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const r = useRange(snap?.sim_time);
  const metrics = tab === "gas" ? [...GAS_KEYS] : ["temp", "rh", "pressure"];
  const { data, error } = useHistory({ metrics, sensor, ...r.query, every: 3000, max_points: 200 });
  const sensorIds = useMemo(() => (snap ? Object.values(snap.segments).map((s) => s.sensor_id) : []), [snap]);
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const th = snap.thresholds;
  const exportCsv = () => {
    if (!data) return;
    const ms = Object.keys(data.series);
    downloadText(`ragmine_${tab}_${sensor}_SIMULATED.csv`, toCsv(["sim_time_utc", "data_source", ...ms.map((m) => `${m} (${data.units[m]})`)],
      data.t.map((tt, i) => [new Date(tt * 1000).toISOString(), "SIMULATED", ...ms.map((m) => data.series[m].v[i])])));
  };
  const save = (g: GasKey) => run(async () => {
    const vals: Record<string, number> = {};
    Object.entries(draft).forEach(([k, v]) => { if (v !== "" && !Number.isNaN(+v)) vals[k] = +v; });
    await api.putThreshold(g, vals); setEdit(null); setDraft({}); notify(t("settings.saved"));
  });
  const gasAlerts = snap.alerts.recent.filter((a) => ["critical_gas", "gas_warning", "oxygen_range"].includes(a.category));
  const selSeg = sensor === "all" ? null : Object.values(snap.segments).find((s) => s.sensor_id === sensor);
  const cur = (g: GasKey) => (selSeg ? selSeg.values[g] ?? null : snap.kpi.gas[g].value);

  return (
    <div>
      <PageHeader title={t("nav.gas")} sub={t("gas.sub")} right={<>
        <Segmented value={tab} onChange={setTab} options={[{ value: "gas", label: t("gas.tabGas") }, { value: "env", label: t("gas.tabEnv") }]} />
        <button className="btn" onClick={exportCsv} disabled={!data}><Download size={14} />{t("common.exportCsv")}</button></>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <RangePicker r={r} t={t} />
        <label className="flex items-center gap-2 text-xs text-mute">{t("gas.location")}
          <select className="input !py-1" value={sensor} onChange={(e) => setSensor(e.target.value)}>
            <option value="all">{t("gas.allWorst")}</option>
            {sensorIds.map((s) => <option key={s} value={s}>{s} · {name(s.slice(3))}</option>)}
          </select></label>
      </div>
      {error && <div className="mb-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}

      {tab === "gas" ? (<>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {GAS_KEYS.map((g) => {
            const v = cur(g), st = data?.stats[g], state = gasState(g, v, th[g]);
            return (
              <div key={g} className="card p-3.5">
                <div className="flex items-start justify-between"><div><div className="text-[13px] font-semibold">{t(`gas.${g}`)}</div><div className="text-xs text-mute">{GAS_INFO[g].formula}</div></div><StateBadge state={state} small /></div>
                <div className="mt-2 flex items-baseline gap-1.5"><span className="text-3xl font-semibold tabular-nums" style={{ color: STATE_COLOR[state] }}>{fmtNum(v, GAS_INFO[g].decimals)}</span><span className="text-xs text-mute">{GAS_INFO[g].unit}</span></div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-mute"><span>{st ? `${trendArrow(st.delta, 1e-9)} ${t(`trend.${st.trend}`)}` : "—"}</span><span>{fmtTime(snap.sim_time)}</span></div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[10.5px] text-mute"><span>{t("chart.warn")}: <b className="text-warn">{th[g].warn_high ?? "—"}{th[g].warn_low != null ? ` / ≤${th[g].warn_low}` : ""}</b></span><span>{t("chart.crit")}: <b className="text-crit">{th[g].crit_high ?? "—"}{th[g].crit_low != null ? ` / ≤${th[g].crit_low}` : ""}</b></span></div>
                {!selSeg && snap.kpi.gas[g].segment_id && <div className="mt-1 text-[10.5px] text-mute">{t("gas.worstAt")}: {name(snap.kpi.gas[g].segment_id)}</div>}
                <button className="mt-2 text-[11px] text-accent" onClick={() => { setEdit(edit === g ? null : g); setDraft({}); }}>{t("gas.editThr")}</button>
                {edit === g && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-bg/60 p-2">
                    {(["warn_high", "crit_high", "warn_low", "crit_low"] as const).filter((k) => th[g][k] != null).map((k) => (
                      <label key={k} className="flex items-center justify-between gap-2 text-[11px] text-mute">{t(`thr.${k}`)}
                        <input className="input w-20 !py-0.5" type="number" step="any" defaultValue={th[g][k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} /></label>))}
                    <button className="btn btn-primary w-full !py-1" onClick={() => save(g)}>{t("common.save")}</button>
                    <p className="text-[10px] leading-snug text-warn">{t("thr.disclaimer")}</p>
                  </div>)}
              </div>);
          })}
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card title={t("gas.multi")}><MultiGasChart data={data} thresholds={th} gases={GAS_KEYS} height={260} /><p className="mt-1 text-[10.5px] text-mute">{t("chart.ratioNote")}</p></Card>
          <Card title={t("gas.compare")}>
            <ValueBars height={260} unit={t("chart.ratioUnit")} decimals={2} refs={[{ y: 1, c: "#fbbf24", l: t("chart.warnLimit") }]}
              data={GAS_KEYS.map((g) => { const v = snap.kpi.gas[g].value; const ratio = v === null ? 0 : g === "o2" ? (20.9 - v) / Math.max(20.9 - (th.o2.warn_low ?? 19.5), 0.01) : v / (th[g].warn_high ?? 1); return { id: g, label: GAS_INFO[g].formula, value: +ratio.toFixed(3), color: STATE_COLOR[gasState(g, v, th[g])] }; })} />
          </Card>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {GAS_KEYS.map((g) => (
            <Card key={g} title={`${t(`gas.${g}`)} (${GAS_INFO[g].formula}) · ${GAS_INFO[g].unit}`} right={<span className="text-[11px] text-mute">{sensor === "all" ? t("gas.worstCase") : sensor}</span>}>
              <MetricChart data={data} metric={g} thresholds={th[g]} height={190} />
            </Card>))}
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card title={t("gas.compareLoc")} right={<select className="input !py-1" value={cmpGas} onChange={(e) => setCmpGas(e.target.value as GasKey)}>{GAS_KEYS.map((g) => <option key={g} value={g}>{GAS_INFO[g].formula}</option>)}</select>}>
            <ValueBars unit={GAS_INFO[cmpGas].unit} decimals={GAS_INFO[cmpGas].decimals} height={230}
              refs={[...(th[cmpGas].warn_high != null ? [{ y: th[cmpGas].warn_high!, c: "#fbbf24", l: t("chart.warn") }] : []), ...(th[cmpGas].crit_high != null ? [{ y: th[cmpGas].crit_high!, c: "#f87171", l: t("chart.crit") }] : [])]}
              data={Object.values(snap.segments).map((s) => ({ id: s.id, label: s.id, value: s.values[cmpGas] ?? null, color: STATE_COLOR[gasState(cmpGas, s.values[cmpGas] ?? null, th[cmpGas])] }))} />
          </Card>
          <Card title={t("gas.stats")} pad={false}>
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="th">{t("gas.gas")}</th><th className="th">{t("stat.min")}</th><th className="th">{t("stat.max")}</th><th className="th">{t("stat.avg")}</th><th className="th">{t("stat.trend")}</th></tr></thead><tbody>
              {GAS_KEYS.map((g) => { const s = data?.stats[g]; return <tr key={g}><td className="td font-medium" style={{ color: GAS_COLOR[g] }}>{GAS_INFO[g].formula}</td><td className="td tabular-nums">{s ? fmtNum(s.min, GAS_INFO[g].decimals) : "—"}</td><td className="td tabular-nums">{s ? fmtNum(s.max, GAS_INFO[g].decimals) : "—"}</td><td className="td tabular-nums">{s ? fmtNum(s.avg, GAS_INFO[g].decimals) : "—"}</td><td className="td">{s ? `${trendArrow(s.delta, 1e-9)} ${t(`trend.${s.trend}`)}` : "—"}</td></tr>; })}
            </tbody></table></div>
            <div className="px-4 pb-3 pt-2 text-[10.5px] text-mute">{t("gas.statsNote", { n: data?.samples ?? 0 })}</div>
          </Card>
        </div>
        <Card className="mt-4" title={t("gas.events")} pad={false}>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">{t("alerts.time")}</th><th className="th">{t("alerts.severity")}</th><th className="th">{t("alerts.description")}</th><th className="th">{t("alerts.status")}</th></tr></thead><tbody>
            {gasAlerts.slice(0, 12).map((a) => <tr key={a.id}><td className="td tabular-nums">{fmtTime(a.time)}</td><td className="td"><Pill color={SEV_COLOR[a.severity]}>{t(`sev.${a.severity}`)}</Pill></td><td className="td">{alertDescription(t, name, a)}</td><td className="td text-mute">{t(`astatus.${a.status}`)}</td></tr>)}
            {!gasAlerts.length && <tr><td className="td text-mute" colSpan={4}>{t("alerts.none")}</td></tr>}
          </tbody></table></div>
        </Card>
      </>) : (<>
        <SimNotice k="env.notice" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["temp", "rh", "pressure"] as const).map((k) => { const e = snap.kpi.env[k], st = data?.stats[k]; const unit = { temp: "°C", rh: "%", pressure: "hPa" }[k]; return (
            <div key={k} className="card p-3.5"><div className="lbl">{t(`env.${k}`)} · {k === "pressure" ? "BMP180-like" : "AHT10-like"}</div>
              <div className="mt-1.5 flex items-baseline gap-1.5"><span className="text-3xl font-semibold tabular-nums">{fmtNum(e.value, k === "pressure" ? 1 : 1)}</span><span className="text-xs text-mute">{unit}</span></div>
              <div className="mt-1 text-[11px] text-mute">{t("stat.min")} {st ? fmtNum(st.min, 1) : "—"} · {t("stat.max")} {st ? fmtNum(st.max, 1) : "—"} · {t("stat.avg")} {st ? fmtNum(st.avg, 1) : "—"}</div>
              <div className="text-[11px] text-mute">{st ? `${trendArrow(st.delta, 1e-9)} ${t(`trend.${st.trend}`)}` : ""} · {fmtTime(snap.sim_time)}</div></div>); })}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {(["temp", "rh", "pressure"] as const).map((k) => <Card key={k} title={`${t(`env.${k}`)} (${{ temp: "°C", rh: "%", pressure: "hPa" }[k]})`}><MetricChart data={data} metric={k} height={210} area /></Card>)}
        </div>
        <Card className="mt-4" title={t("env.sensorHealth")} pad={false}>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">{t("health.sensor")}</th><th className="th">{t("env.location")}</th><th className="th">{t("health.status")}</th><th className="th">{t("env.temp")}</th><th className="th">{t("env.rh")}</th><th className="th">{t("env.pressure")}</th><th className="th">{t("seg.lastUpdate")}</th></tr></thead><tbody>
            {Object.values(snap.segments).map((s) => <tr key={s.id}><td className="td font-mono">{s.sensor_id}</td><td className="td">{name(s.id, s.name)}</td><td className="td"><Pill color={s.sensor_status === "ok" ? "#34d399" : s.sensor_status === "fault" ? "#f87171" : "#fbbf24"}>{t(`sstatus.${s.sensor_status}`)}</Pill></td><td className="td tabular-nums">{fmtNum(s.values.temp, 1)}</td><td className="td tabular-nums">{fmtNum(s.values.rh, 1)}</td><td className="td tabular-nums">{fmtNum(s.values.pressure, 1)}</td><td className="td tabular-nums">{fmtTime(s.last_update)}</td></tr>)}
          </tbody></table></div>
          <div className="px-4 pb-3 pt-2 text-[10.5px] text-mute">{t("env.notGas")}</div>
        </Card>
      </>)}
      <div className="mt-4 text-[10.5px] text-mute">{t("thr.disclaimer")} {mine ? "" : ""}</div>
    </div>
  );
}
