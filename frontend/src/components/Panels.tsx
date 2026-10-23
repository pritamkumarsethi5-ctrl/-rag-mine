import { useMemo } from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { fmtDur, fmtNum, fmtTime } from "../lib/format";
import { routesFromSegment } from "../lib/graph";
import { reasonText } from "../lib/text";
import { useStore } from "../store";
import { GAS_INFO, GAS_KEYS, type WorkerLive } from "../types";
import { Pill, StateBadge } from "./ui";

export function SegmentPanel({ id, onClose }: { id: string; onClose?: () => void }) {
  const { t, name } = useI18n();
  const { snap, mine, selectSegment } = useStore();
  const live = snap?.segments[id];
  const seg = mine?.segments.find((s) => s.id === id);
  const routes = useMemo(() => (mine && snap ? routesFromSegment(mine, snap, id) : []), [mine, snap, id]);
  if (!live || !seg || !snap) return null;
  const th = snap.thresholds;
  return (
    <div className="card p-3.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div><div className="text-sm font-semibold">{name(id, live.name)}</div><div className="text-mute">{t("seg.id")}: {id} · {t(`zone.${live.zone}`)}</div></div>
        <div className="flex items-center gap-2"><StateBadge state={live.state} />{onClose && <button onClick={onClose} className="text-mute hover:text-ink" aria-label="close"><X size={15} /></button>}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {live.restricted && <Pill color="#a78bfa">{t("seg.restricted")}</Pill>}
        {live.obstructed && <Pill color="#fbbf24">{t("seg.blocked")}</Pill>}
        {live.avoid && <Pill color="#f87171">{t("seg.avoid")}</Pill>}
        {!live.traversable && !live.avoid && !live.restricted && <Pill color="#94a3b8">{t("seg.nonTraversable")}</Pill>}
        {live.traversable && <Pill color="#34d399">{t("seg.traversable")}</Pill>}
        <Pill color="#22d3ee">{t(`mapping.${live.mapping.state}`)} · {Math.round(live.mapping.ratio * 100)}%</Pill>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1.5">
        <div><dt className="lbl">{t("seg.length")}</dt><dd>{fmtNum(live.length_m, 0)} m</dd></div>
        <div><dt className="lbl">{t("seg.width")}</dt><dd>{fmtNum(live.width_m, 1)} m</dd></div>
        <div><dt className="lbl">{t("seg.sensor")}</dt><dd>{live.sensor_id}</dd></div>
      </dl>
      <div className="mt-3 lbl">{t("seg.readings")} <span className="normal-case text-warn">({t("common.simulated")})</span></div>
      <table className="mt-1 w-full"><tbody>
        {GAS_KEYS.map((g) => {
          const v = live.values[g];
          const hit = live.reasons.find((r) => r.metric === g && (r.code === "gas_critical" || r.code === "gas_warning"));
          return <tr key={g}><td className="py-0.5 text-mute">{GAS_INFO[g].formula} <span className="text-[10px]">{t(`gas.${g}`)}</span></td>
            <td className="py-0.5 text-right tabular-nums" style={{ color: hit ? (hit.code === "gas_critical" ? "#f87171" : "#fbbf24") : undefined }}>{fmtNum(v, GAS_INFO[g].decimals)} {GAS_INFO[g].unit}</td>
            <td className="py-0.5 pl-2 text-right text-[10px] text-mute">{th[g].warn_high ?? "—"}/{th[g].crit_high ?? "—"}</td></tr>;
        })}
        <tr><td className="py-0.5 text-mute">{t("env.temp")}</td><td className="py-0.5 text-right tabular-nums">{fmtNum(live.values.temp, 1)} °C</td><td /></tr>
        <tr><td className="py-0.5 text-mute">{t("env.rh")}</td><td className="py-0.5 text-right tabular-nums">{fmtNum(live.values.rh, 1)} %</td><td /></tr>
        <tr><td className="py-0.5 text-mute">{t("env.pressure")}</td><td className="py-0.5 text-right tabular-nums">{fmtNum(live.values.pressure, 1)} hPa</td><td /></tr>
      </tbody></table>
      <div className="mt-0.5 text-[10px] text-mute">{t("seg.thrNote")} · {t("seg.lastUpdate")}: {fmtTime(live.last_update)}</div>
      {live.reasons.filter((r) => r.severity !== "info").length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="lbl">{t("seg.reasons")}</div>
          {live.reasons.filter((r) => r.severity !== "info").map((r, i) => <div key={i} className="rounded-md border border-line bg-bg/60 px-2 py-1.5 text-[11.5px]">{reasonText(t, name, r)}</div>)}
          <div className="text-[11px] text-accent">→ {t(`action.${live.reasons.find((r) => r.action)?.action ?? "investigate_remotely"}`)}</div>
        </div>
      )}
      <div className="mt-3 lbl">{t("seg.connected")}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">{live.connected.map((c) => <button key={c} onClick={() => selectSegment(c)} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] hover:border-accent/60">{c} · {name(c, snap.segments[c]?.name)}</button>)}</div>
      <div className="mt-3 lbl">{t("seg.routes")}</div>
      <ul className="mt-1 space-y-1">
        {routes.map((r) => <li key={r.exit} className="flex items-center justify-between rounded-md border border-line px-2 py-1">
          <span>{name(r.exit)}</span>
          {r.reachable ? <span className="tabular-nums text-ok">{Math.round(r.distance_m)} m · {r.segments.length} {t("seg.legs")}</span> : <span className="text-crit">{t("route.noneShort")}</span>}
        </li>)}
      </ul>
    </div>
  );
}

export function WorkerCard({ w, onClose, onNavigate }: { w: WorkerLive; onClose?: () => void; onNavigate?: () => void }) {
  const { t, name } = useI18n();
  return (
    <div className="card p-3.5 text-xs">
      <div className="flex items-start justify-between">
        <div><div className="text-sm font-semibold">{w.callsign} <span className="font-normal text-mute">· {w.id}</span></div><div className="text-mute">{t("common.fictional")}</div></div>
        <div className="flex items-center gap-2"><StateBadge state={w.segment_state} small />{onClose && <button onClick={onClose} className="text-mute hover:text-ink" aria-label="close"><X size={15} /></button>}</div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <div><dt className="lbl">{t("worker.segment")}</dt><dd>{name(w.segment_id)} ({w.segment_id})</dd></div>
        <div><dt className="lbl">{t("worker.status")}</dt><dd>{t(`wstatus.${w.status}`)}</dd></div>
        <div><dt className="lbl">{t("worker.lastUpdate")}</dt><dd className={w.stale ? "text-warn" : ""}>{fmtTime(w.last_update)} {w.stale && `· ${t("worker.stale")}`}</dd></div>
        <div><dt className="lbl">{t("worker.speed")}</dt><dd>{fmtNum(w.speed_mps, 2)} m/s</dd></div>
        <div><dt className="lbl">{t("worker.destination")}</dt><dd>{w.destination ? name(w.destination, w.destination_name) : "—"}</dd></div>
        <div><dt className="lbl">{t("worker.route")}</dt><dd>{w.route_segments.length ? `${w.route_segments.join(" → ")} · ${Math.round(w.route_remaining_m)} m` : "—"}</dd></div>
        <div><dt className="lbl">{t("worker.hazard")}</dt><dd className={w.hazard?.near ? "text-crit" : ""}>{w.hazard ? `${w.hazard.segment_id} · ${Math.round(w.hazard.distance_m)} m` : t("worker.noHazard")}</dd></div>
        <div><dt className="lbl">{t("worker.evac")}</dt><dd>{w.evacuated ? t("worker.evacuated") : w.nav_mode === "emergency" ? t("worker.evacuating") : t("worker.notEvac")}</dd></div>
      </dl>
      <div className="mt-3 rounded-md border border-line bg-bg/60 p-2">
        <div className="lbl">{t("worker.nearestExit")}</div>
        {w.exit.found ? <div className="mt-0.5">{name(w.exit.dest_node)} · {Math.round(w.exit.distance_m)} m · {fmtDur(w.exit.eta_s)}</div> : <div className="mt-0.5 font-semibold text-crit">{t("route.none")}</div>}
      </div>
      {onNavigate && <button className="btn btn-primary mt-3 w-full" onClick={onNavigate}>{t("worker.openNav")}</button>}
    </div>
  );
}
