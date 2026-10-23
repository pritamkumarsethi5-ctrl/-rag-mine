import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell, AreaChart, Area } from "recharts";
import { useI18n } from "../i18n";
import { GAS_COLOR, epochToHM, epochToTime } from "../lib/format";
import { GAS_INFO, type GasKey, type HistoryResult, type Snapshot } from "../types";

const axis = { stroke: "#4b5e72", fontSize: 11, tickLine: false } as const;
const tip = { contentStyle: { background: "#0d151e", border: "1px solid #223142", borderRadius: 8, fontSize: 12, color: "#e6edf3" }, labelStyle: { color: "#8a9bad" } };

function rows(h: HistoryResult, keys: string[], field: "v" | "avg" | "min" | "max" = "v") {
  return h.t.map((t, i) => {
    const r: Record<string, number | null> = { t };
    keys.forEach((k) => { r[k] = h.series[k]?.[field][i] ?? null; });
    return r;
  });
}

/** One metric, one unit, with warning / critical threshold reference lines. */
export function MetricChart({ data, metric, thresholds, height = 220, color, field = "v", area = false, decimals }: {
  data: HistoryResult | null; metric: string; thresholds?: Snapshot["thresholds"][GasKey]; height?: number; color?: string; field?: "v" | "avg"; area?: boolean; decimals?: number;
}) {
  const { t } = useI18n();
  if (!data || !data.t.length) return <div className="flex items-center justify-center text-xs text-mute" style={{ height }}>{t("common.loading")}</div>;
  const unit = data.units[metric];
  const col = color ?? GAS_COLOR[metric] ?? "#22d3ee";
  const d = rows(data, [metric], field);
  const dec = decimals ?? (metric in GAS_INFO ? GAS_INFO[metric as GasKey].decimals : 1);
  const refs: { y: number; c: string; l: string }[] = [];
  if (thresholds) {
    const add = (y: number | null | undefined, c: string, l: string) => { if (y !== null && y !== undefined) refs.push({ y, c, l }); };
    add(thresholds.warn_high, "#fbbf24", t("chart.warn")); add(thresholds.crit_high, "#f87171", t("chart.crit"));
    add(thresholds.warn_low, "#fbbf24", t("chart.warn")); add(thresholds.crit_low, "#f87171", t("chart.crit"));
  }
  const vals = d.map((r) => r[metric]).filter((v): v is number => v !== null);
  const lo = Math.min(...vals, ...refs.map((r) => r.y)), hi = Math.max(...vals, ...refs.map((r) => r.y));
  const pad = (hi - lo) * 0.08 || 0.1;
  const Chart: any = area ? AreaChart : LineChart;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={d} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#1b2836" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={epochToHM} {...axis} minTickGap={40} />
          <YAxis {...axis} width={52} domain={[lo - pad, hi + pad]} tickFormatter={(v: number) => v.toFixed(dec)} label={{ value: unit, angle: -90, position: "insideLeft", fill: "#6b7f94", fontSize: 10, dx: 12 }} />
          <Tooltip {...tip} labelFormatter={(v: number) => epochToTime(v)} formatter={(v: number) => [`${v.toFixed(dec)} ${unit}`, metric]} />
          {refs.map((r, i) => <ReferenceLine key={i} y={r.y} stroke={r.c} strokeDasharray="5 4" label={{ value: `${r.l} ${r.y}`, fill: r.c, fontSize: 10, position: "insideTopRight" }} />)}
          {area
            ? <Area type="monotone" dataKey={metric} stroke={col} fill={col + "33"} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            : <Line type="monotone" dataKey={metric} stroke={col} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/** Dimensionless multi-gas chart: every gas is scaled by ITS OWN warning limit, so no units are mixed. */
export function loadRatio(gas: GasKey, v: number, th: Snapshot["thresholds"][GasKey]): number {
  if (gas === "o2") {
    const lo = th.warn_low ?? 19.5;
    return (20.9 - v) / Math.max(20.9 - lo, 0.01);
  }
  return v / Math.max(th.warn_high ?? 1, 1e-9);
}
export function MultiGasChart({ data, thresholds, height = 260, gases }: { data: HistoryResult | null; thresholds: Snapshot["thresholds"]; height?: number; gases: GasKey[] }) {
  const { t } = useI18n();
  if (!data || !data.t.length) return <div className="flex items-center justify-center text-xs text-mute" style={{ height }}>{t("common.loading")}</div>;
  const d = data.t.map((tt, i) => {
    const r: Record<string, number | null> = { t: tt };
    gases.forEach((g) => { const v = data.series[g]?.v[i]; r[g] = v === null || v === undefined ? null : +loadRatio(g, v, thresholds[g]).toFixed(3); });
    return r;
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={d} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#1b2836" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={epochToHM} {...axis} minTickGap={40} />
          <YAxis {...axis} width={44} domain={[0, (m: number) => Math.max(1.2, Math.ceil(m * 10) / 10)]} />
          <Tooltip {...tip} labelFormatter={(v: number) => epochToTime(v)} formatter={(v: number, n: string) => [`${(+v).toFixed(2)} ×`, GAS_INFO[n as GasKey]?.formula ?? n]} />
          <ReferenceLine y={1} stroke="#fbbf24" strokeDasharray="5 4" label={{ value: t("chart.warnLimit"), fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }} />
          {gases.map((g) => <Line key={g} type="monotone" dataKey={g} name={g} stroke={GAS_COLOR[g]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Spark({ values, color = "#22d3ee", height = 34 }: { values: (number | null)[]; color?: string; height?: number }) {
  const d = values.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Area type="monotone" dataKey="v" stroke={color} fill={color + "22"} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleBars({ data, x, bars, height = 200, colors, stacked = false, xFormatter }: {
  data: Record<string, any>[]; x: string; bars: string[]; height?: number; colors: string[]; stacked?: boolean; xFormatter?: (v: any) => string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#1b2836" vertical={false} />
          <XAxis dataKey={x} {...axis} tickFormatter={xFormatter} minTickGap={20} />
          <YAxis {...axis} allowDecimals={false} width={36} />
          <Tooltip {...tip} labelFormatter={xFormatter} cursor={{ fill: "#ffffff08" }} />
          {bars.map((b, i) => <Bar key={b} dataKey={b} stackId={stacked ? "s" : undefined} fill={colors[i]} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ValueBars({ data, height = 220, unit, refs, decimals = 2 }: {
  data: { id: string; label: string; value: number | null; color: string }[]; height?: number; unit: string; refs?: { y: number; c: string; l: string }[]; decimals?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#1b2836" vertical={false} />
          <XAxis dataKey="label" {...axis} interval={0} fontSize={10} />
          <YAxis {...axis} width={48} tickFormatter={(v: number) => v.toFixed(decimals)} label={{ value: unit, angle: -90, position: "insideLeft", fill: "#6b7f94", fontSize: 10, dx: 12 }} />
          <Tooltip {...tip} cursor={{ fill: "#ffffff08" }} formatter={(v: number) => [`${(+v).toFixed(decimals)} ${unit}`]} />
          {refs?.map((r, i) => <ReferenceLine key={i} y={r.y} stroke={r.c} strokeDasharray="5 4" label={{ value: r.l, fill: r.c, fontSize: 10, position: "insideTopRight" }} />)}
          <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {data.map((d) => <Cell key={d.id} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CoverageChart({ data, height = 200 }: { data: { t: number; coverage_pct: number }[]; height?: number }) {
  if (!data.length) return <div className="flex items-center justify-center text-xs text-mute" style={{ height }}>—</div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#1b2836" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={epochToHM} {...axis} minTickGap={40} />
          <YAxis {...axis} width={40} domain={[0, 100]} unit="%" />
          <Tooltip {...tip} labelFormatter={(v: number) => epochToTime(v)} formatter={(v: number) => [`${(+v).toFixed(1)} %`]} />
          <Area type="stepAfter" dataKey="coverage_pct" stroke="#2dd4bf" fill="#2dd4bf22" strokeWidth={2} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Top-down trajectory (x = east, z = north) coloured by time like the reference path image. */
export function TrajectoryChart({ points, height = 240, current }: { points: number[][]; height?: number; current?: number[] }) {
  const d = points.map((p, i) => ({ x: p[0], z: p[2], i }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={d} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#1b2836" />
          <XAxis dataKey="x" type="number" domain={["dataMin - 10", "dataMax + 10"]} {...axis} unit=" m" />
          <YAxis dataKey="z" type="number" domain={["dataMin - 10", "dataMax + 10"]} {...axis} width={48} unit=" m" />
          <Tooltip {...tip} formatter={(v: number) => `${(+v).toFixed(1)} m`} />
          <Line type="linear" dataKey="z" stroke="#2dd4bf" strokeWidth={2} dot={false} isAnimationActive={false} />
          {current && <ReferenceLine x={current[0]} stroke="#22d3ee" strokeDasharray="3 3" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
