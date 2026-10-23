import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Card, PageHeader, Pill } from "../components/ui";
import { fmtDateTime, fmtTime } from "../lib/format";
import { useStore } from "../store";

type Lvl = "online" | "degraded" | "offline" | "simulated";
const COL: Record<Lvl, string> = { online: "#34d399", degraded: "#fbbf24", offline: "#f87171", simulated: "#22d3ee" };

export default function Health() {
  const { t, name } = useI18n();
  const { snap, conn, lastMsgAt } = useStore();
  const [backend, setBackend] = useState<Lvl>("offline");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    const ping = () => fetch("/api/health").then((r) => r.json()).then((d) => alive && setBackend(d.status === "ok" ? "online" : "degraded")).catch(() => alive && setBackend("offline"));
    ping();
    const a = window.setInterval(ping, 4000), b = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); };
  }, []);
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const h = snap.health;
  const wsAge = lastMsgAt ? (now - lastMsgAt) / 1000 : Infinity;
  const ws: Lvl = conn !== "online" ? "offline" : wsAge > 5 ? "degraded" : "online";
  const engine: Lvl = snap.running ? "simulated" : "degraded";
  const sensors: Lvl = h.sensors.fault + h.sensors.stale > 0 ? "degraded" : "simulated";
  const cards: { k: string; lvl: Lvl; detail: string }[] = [
    { k: "frontend", lvl: "online", detail: t("health.frontendDetail") },
    { k: "backend", lvl: backend, detail: "FastAPI · /api/health" },
    { k: "websocket", lvl: ws, detail: `${t("health.lastMsg")}: ${Number.isFinite(wsAge) ? `${wsAge.toFixed(1)} s` : "—"}` },
    { k: "engine", lvl: engine, detail: snap.running ? t("health.engineRunning", { s: snap.speed }) : t("health.enginePaused") },
    { k: "telemetry", lvl: h.max_telemetry_age_s !== null && h.max_telemetry_age_s > 15 ? "degraded" : "simulated", detail: `${t("health.maxAge")}: ${h.max_telemetry_age_s ?? "—"} s (${t("common.simulatedClock")})` },
    { k: "sensors", lvl: sensors, detail: `${h.sensors.ok}/${h.sensors_total} ${t("sstatus.ok")} · ${h.sensors.stale} ${t("sstatus.stale")} · ${h.sensors.fault} ${t("sstatus.fault")}` },
    { k: "storage", lvl: h.persistence.enabled ? (h.persistence.ok ? "online" : "degraded") : "simulated", detail: h.persistence.enabled ? `SQLite · ${h.persistence.rows_written ?? 0} ${t("health.rows")}` : `${t("health.memoryOnly")} · ${h.history_samples} ${t("health.samples")}` },
    { k: "hardware", lvl: "simulated", detail: t("health.hwDetail") },
  ];
  return (
    <div>
      <PageHeader title={t("nav.health")} sub={t("health.sub")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => <div key={c.k} className="card p-3.5"><div className="flex items-center justify-between"><span className="text-[13px] font-semibold">{t(`health.${c.k}`)}</span><Pill color={COL[c.lvl]}>{t(`level.${c.lvl}`)}</Pill></div><div className="mt-2 text-[11.5px] text-mute">{c.detail}</div></div>)}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="card p-3.5"><div className="lbl">{t("health.lastSuccess")}</div><div className="mt-1 font-mono text-sm">{lastMsgAt ? new Date(lastMsgAt).toLocaleTimeString() : "—"} <span className="text-mute">({t("health.browserClock")})</span></div></div>
        <div className="card p-3.5"><div className="lbl">{t("health.simClock")}</div><div className="mt-1 font-mono text-sm">{fmtDateTime(snap.sim_time)} UTC</div></div>
        <div className="card p-3.5"><div className="lbl">{t("health.rejected")}</div><div className="mt-1 font-mono text-sm">{h.rejected_frames}</div></div>
      </div>
      <Card className="mt-4" title={t("health.sensorTable")} pad={false}>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">{t("health.sensor")}</th><th className="th">{t("env.location")}</th><th className="th">{t("alerts.zone")}</th><th className="th">{t("health.status")}</th><th className="th">{t("seg.lastUpdate")}</th></tr></thead><tbody>
          {Object.values(snap.segments).map((s) => <tr key={s.id}><td className="td font-mono">{s.sensor_id}</td><td className="td">{name(s.id, s.name)}</td><td className="td">{t(`zone.${s.zone}`)}</td><td className="td"><Pill color={s.sensor_status === "ok" ? "#34d399" : s.sensor_status === "fault" ? "#f87171" : "#fbbf24"}>{t(`sstatus.${s.sensor_status}`)}</Pill> <Pill color="#22d3ee">{t("level.simulated")}</Pill></td><td className="td tabular-nums">{fmtTime(s.last_update)}</td></tr>)}
        </tbody></table></div>
      </Card>
      <p className="mt-3 text-[11px] text-mute">{t("health.hwNote")} {h.hardware.note}</p>
    </div>
  );
}
