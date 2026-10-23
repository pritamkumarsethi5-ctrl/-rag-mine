import { useEffect, useState } from "react";
import { Check, CheckCheck, Download } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Card, PageHeader, SevBadge } from "../components/ui";
import { downloadText, fmtDateTime, fmtTime, toCsv } from "../lib/format";
import { alertDescription } from "../lib/text";
import { useStore } from "../store";
import type { AlertItem } from "../types";

const CATS = ["critical_gas", "gas_warning", "oxygen_range", "sensor_unavailable", "stale_telemetry", "rover_obstacle", "worker_hazard", "route_blocked", "comm_lost", "mapping_event", "evacuation"];

export default function Alerts() {
  const { t, name } = useI18n();
  const { snap, run, notify } = useStore();
  const [q, setQ] = useState(""), [sev, setSev] = useState(""), [cat, setCat] = useState(""), [status, setStatus] = useState("active");
  const [items, setItems] = useState<AlertItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const seq = snap?.seq ?? 0;
  useEffect(() => {
    let alive = true;
    api.alerts({ severity: sev, category: cat, status: status === "all" ? "" : status, q }).then((r) => alive && setItems(r.alerts)).catch(() => undefined);
    return () => { alive = false; };
  }, [q, sev, cat, status, Math.floor(seq / 2)]);
  const a = items.find((x) => x.id === sel) ?? null;
  const c = snap?.alerts.counts;
  const exportCsv = () => downloadText("ragmine_alerts_SIMULATED.csv", toCsv(["id", "sim_time", "severity", "category", "zone", "segment", "related", "status", "description"],
    items.map((x) => [x.id, x.time, x.severity, x.category, x.zone, x.segment_id, x.related ? `${x.related.type}:${x.related.id}` : null, x.status, alertDescription((k, v) => t(k, v), name, x)])));
  return (
    <div>
      <PageHeader title={t("nav.alerts")} sub={t("alerts.sub")} right={<button className="btn" onClick={exportCsv}><Download size={14} />{t("common.exportCsv")}</button>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[[t("alerts.active"), c?.active ?? 0, "#22d3ee"], [t("sev.critical"), c?.critical ?? 0, "#f87171"], [t("sev.warning"), c?.warning ?? 0, "#fbbf24"], [t("alerts.unack"), c?.unacknowledged ?? 0, "#94a3b8"]].map(([l, v, col]) => (
          <div key={String(l)} className="card p-3"><div className="lbl">{l}</div><div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: col as string }}>{v}</div></div>))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">{t("alerts.allSev")}</option>{["critical", "warning", "info"].map((s) => <option key={s} value={s}>{t(`sev.${s}`)}</option>)}</select>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t("alerts.allCat")}</option>{CATS.map((s) => <option key={s} value={s}>{t(`cat.${s}`)}</option>)}</select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{["active", "open", "acknowledged", "resolved", "all"].map((s) => <option key={s} value={s}>{t(`astatus.${s}`)}</option>)}</select>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card pad={false}>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr>{["ID", t("alerts.time"), t("alerts.severity"), t("alerts.category"), t("alerts.zone"), t("alerts.description"), t("alerts.status"), ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead><tbody>
            {items.map((x) => (
              <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer hover:bg-panel2 ${x.id === sel ? "bg-accent/10" : ""} ${x.severity === "critical" && x.status !== "resolved" ? "bg-crit/10" : ""}`}>
                <td className="td font-mono text-[11px]">{x.id}</td><td className="td tabular-nums">{fmtTime(x.time)}</td><td className="td"><SevBadge sev={x.severity} /></td>
                <td className="td">{t(`cat.${x.category}`)}</td><td className="td">{x.zone ? t(`zone.${x.zone}`) : "—"}</td>
                <td className="td max-w-[340px]"><span className="line-clamp-2">{alertDescription(t, name, x)}</span></td>
                <td className="td">{t(`astatus.${x.status}`)}{x.status !== "resolved" && !x.condition_active && x.persistent !== false ? <div className="text-[10px] text-warn">{t("alerts.cleared")}</div> : null}</td>
                <td className="td" onClick={(e) => e.stopPropagation()}><div className="flex gap-1">
                  <button className="btn !px-1.5 !py-0.5" title={t("alerts.ack")} disabled={x.status !== "open"} onClick={() => run(() => api.ack(x.id))}><Check size={13} /></button>
                  <button className="btn !px-1.5 !py-0.5" title={t("alerts.resolve")} disabled={x.status === "resolved"} onClick={() => run(async () => { await api.resolve(x.id); notify(t("alerts.resolved")); })}><CheckCheck size={13} /></button></div></td>
              </tr>))}
            {!items.length && <tr><td className="td text-mute" colSpan={8}>{t("alerts.none")}</td></tr>}
          </tbody></table></div>
        </Card>
        <div>
          {a ? (
            <Card title={`${a.id} · ${t(`cat.${a.category}`)}`} right={<SevBadge sev={a.severity} />}>
              <dl className="space-y-2.5 text-xs">
                <div><dt className="lbl">{t("alerts.description")}</dt><dd className="mt-0.5 text-[13px]">{alertDescription(t, name, a)}</dd></div>
                <div className="rounded-lg border border-accent/30 bg-accent/10 p-2.5"><dt className="lbl text-accent">{t("alerts.recommended")}</dt><dd className="mt-0.5">{t(`alert.r.${a.category}`)}</dd></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><dt className="lbl">{t("alerts.time")}</dt><dd className="tabular-nums">{fmtDateTime(a.time)}</dd></div>
                  <div><dt className="lbl">{t("alerts.zone")}</dt><dd>{a.zone ? t(`zone.${a.zone}`) : "—"}</dd></div>
                  <div><dt className="lbl">{t("alerts.segment")}</dt><dd>{a.segment_id ? `${name(a.segment_id)} (${a.segment_id})` : "—"}</dd></div>
                  <div><dt className="lbl">{t("alerts.related")}</dt><dd>{a.related ? `${t(`rel.${a.related.type}`)} ${a.related.id}` : "—"}</dd></div>
                  <div><dt className="lbl">{t("alerts.status")}</dt><dd>{t(`astatus.${a.status}`)}</dd></div>
                  <div><dt className="lbl">{t("alerts.ackAt")}</dt><dd className="tabular-nums">{a.acknowledged_at ? fmtDateTime(a.acknowledged_at) : "—"}</dd></div>
                  <div className="col-span-2"><dt className="lbl">{t("alerts.resolvedAt")}</dt><dd className="tabular-nums">{a.resolved_at ? `${fmtDateTime(a.resolved_at)} · ${a.resolved_by === "auto" ? t("alerts.byAuto") : t("alerts.byOperator")}` : "—"}</dd></div>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-snug text-warn">{t("alerts.ackNote")}</p>
              <div className="mt-3 flex gap-2"><button className="btn" disabled={a.status !== "open"} onClick={() => run(() => api.ack(a.id))}><Check size={14} />{t("alerts.ack")}</button><button className="btn btn-primary" disabled={a.status === "resolved"} onClick={() => run(() => api.resolve(a.id))}><CheckCheck size={14} />{t("alerts.resolve")}</button></div>
            </Card>) : <Card><div className="text-xs text-mute">{t("alerts.pick")}</div></Card>}
        </div>
      </div>
    </div>
  );
}
