import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { DEFAULT_OPTS, MineScene } from "../components/MineScene";
import { WorkerCard } from "../components/Panels";
import type { PageId } from "../components/Shell";
import { Card, PageHeader, Pill, SimNotice, StateBadge } from "../components/ui";
import { fmtTime } from "../lib/format";
import { useStore } from "../store";

export default function Workers({ go }: { go: (p: PageId) => void }) {
  const { t, name } = useI18n();
  const { snap, mine, selectedWorker, selectWorker, selectSegment } = useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [zone, setZone] = useState("all");
  const [sort, setSort] = useState<"hazard" | "update" | "id">("hazard");
  const rows = useMemo(() => {
    if (!snap) return [];
    const ql = q.toLowerCase();
    const r = snap.workers.filter((w) =>
      (!ql || `${w.id} ${w.callsign} ${w.segment_id} ${name(w.segment_id)}`.toLowerCase().includes(ql)) &&
      (status === "all" || (status === "stale" ? w.stale : w.status === status)) && (zone === "all" || w.zone === zone));
    return [...r].sort((a, b) => sort === "hazard" ? (a.hazard?.distance_m ?? 1e9) - (b.hazard?.distance_m ?? 1e9) : sort === "update" ? b.age_s - a.age_s : a.id.localeCompare(b.id));
  }, [snap, q, status, zone, sort, name]);
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const sel = snap.workers.find((w) => w.id === selectedWorker) ?? null;
  const near = snap.workers.filter((w) => w.hazard?.near).length;
  return (
    <div>
      <PageHeader title={t("nav.workers")} sub={t("workers.sub")} />
      <div className="mb-3"><SimNotice k="notice.workers" /></div>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[[t("workers.total"), snap.workers.length, "#22d3ee"], [t("workers.stale"), snap.workers.filter((w) => w.stale).length, "#fbbf24"], [t("workers.nearHazard"), near, near ? "#f87171" : "#34d399"], [t("workers.evacuated"), snap.workers.filter((w) => w.evacuated).length, "#34d399"]].map(([l, v, c]) => (
          <div key={String(l)} className="card p-3"><div className="lbl">{l}</div><div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: c as string }}>{v}</div></div>))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title={t("workers.directory")} pad={false} right={
            <div className="flex flex-wrap items-center gap-2">
              <input className="input !py-1" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="input !py-1" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">{t("workers.allStatus")}</option>{["moving", "idle", "holding", "arrived", "no_route", "evacuating", "evacuated", "stale"].map((s) => <option key={s} value={s}>{s === "stale" ? t("worker.stale") : t(`wstatus.${s}`)}</option>)}</select>
              <select className="input !py-1" value={zone} onChange={(e) => setZone(e.target.value)}><option value="all">{t("workers.allZones")}</option>{["Main", "North", "South", "East"].map((z) => <option key={z} value={z}>{t(`zone.${z}`)}</option>)}</select>
              <select className="input !py-1" value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="hazard">{t("workers.sortHazard")}</option><option value="update">{t("workers.sortUpdate")}</option><option value="id">ID</option></select>
            </div>}>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr>{["ID", t("workers.callsign"), t("worker.segment"), t("worker.status"), t("worker.destination"), t("worker.hazard"), t("worker.lastUpdate"), t("worker.evac")].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
              {rows.map((w) => (
                <tr key={w.id} onClick={() => { selectWorker(w.id); }} className={`cursor-pointer hover:bg-panel2 ${w.id === selectedWorker ? "bg-accent/10" : ""}`}>
                  <td className="td font-mono">{w.id}</td><td className="td font-medium">{w.callsign}</td>
                  <td className="td">{name(w.segment_id)} <StateBadge state={w.segment_state} small /></td>
                  <td className="td">{t(`wstatus.${w.status}`)}</td>
                  <td className="td">{w.destination ? name(w.destination, w.destination_name) : "—"}</td>
                  <td className="td tabular-nums">{w.hazard ? <span className={w.hazard.near ? "font-semibold text-crit" : "text-mute"}>{w.hazard.segment_id} · {Math.round(w.hazard.distance_m)} m</span> : "—"}</td>
                  <td className="td tabular-nums">{fmtTime(w.last_update)} {w.stale && <Pill color="#fbbf24">{t("worker.stale")}</Pill>}</td>
                  <td className="td">{w.evacuated ? <Pill color="#34d399">{t("worker.evacuated")}</Pill> : w.nav_mode === "emergency" ? <Pill color="#f87171">{t("worker.evacuating")}</Pill> : "—"}</td>
                </tr>))}
              {!rows.length && <tr><td className="td text-mute" colSpan={8}>{t("common.noResults")}</td></tr>}
            </tbody></table></div>
          </Card>
          <MineScene mine={mine} snap={snap} className="h-[360px]" opts={{ ...DEFAULT_OPTS, trajectory: false, labels: false }} onSelectWorker={selectWorker} onSelectSegment={(id) => { selectSegment(id); if (id) go("map"); }} />
        </div>
        <div className="space-y-3">{sel ? <WorkerCard w={sel} onClose={() => selectWorker(null)} onNavigate={() => go("navigation")} /> : <Card><div className="text-xs text-mute">{t("workers.pick")}</div></Card>}</div>
      </div>
    </div>
  );
}
