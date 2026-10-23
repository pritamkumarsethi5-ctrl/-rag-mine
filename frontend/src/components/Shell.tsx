import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, Bell, Bot, ChevronDown, Cpu, Gauge, HardHat, HeartPulse, LayoutDashboard, Languages, Map as MapIcon, Navigation, Pause, Play, RotateCcw, ShieldAlert, SlidersHorizontal, Siren, User, Wifi, WifiOff, Wind, X } from "lucide-react";
import { api } from "../api";
import { LANGS, useI18n } from "../i18n";
import { fmtDateTime, fmtTime } from "../lib/format";
import { useStore } from "../store";
import { SevBadge, StateBadge } from "./ui";

export const PAGES = [
  { id: "overview", icon: LayoutDashboard },
  { id: "map", icon: MapIcon },
  { id: "gas", icon: Wind },
  { id: "workers", icon: HardHat },
  { id: "rover", icon: Bot },
  { id: "navigation", icon: Navigation },
  { id: "alerts", icon: Siren },
  { id: "history", icon: Activity },
  { id: "health", icon: HeartPulse },
  { id: "settings", icon: SlidersHorizontal },
] as const;
export type PageId = (typeof PAGES)[number]["id"];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#0f2230" stroke="#22d3ee55" /><path d="M6 25 16 7l10 18z" fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinejoin="round" /><circle cx="16" cy="20" r="2.2" fill="#2dd4bf" /></svg>
      <div className="leading-tight"><div className="text-[15px] font-bold tracking-wide">RAG-Mine</div><div className="text-[9px] uppercase tracking-[0.18em] text-mute">Safety · Mapping · Guidance</div></div>
    </div>
  );
}

export function Sidebar({ page, go, open, close }: { page: PageId; go: (p: PageId) => void; open: boolean; close: () => void }) {
  const { t } = useI18n();
  const { snap } = useStore();
  const n = snap?.alerts.counts.active ?? 0;
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={close} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[228px] shrink-0 flex-col border-r border-line bg-[#0c141d] transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center justify-between border-b border-line px-4"><Logo /><button className="lg:hidden text-mute" onClick={close} aria-label="close"><X size={18} /></button></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
          {PAGES.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => { go(id); close(); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition ${page === id ? "bg-accent/15 text-accent" : "text-mute hover:bg-panel2 hover:text-ink"}`}>
              <Icon size={17} /><span className="flex-1">{t(`nav.${id}`)}</span>
              {id === "alerts" && n > 0 && <span className="rounded-full bg-crit/20 px-1.5 text-[10px] font-bold text-crit">{n}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-line p-3 text-[10.5px] leading-snug text-mute">{t("footer.sim")}</div>
      </aside>
    </>
  );
}

function Menu({ button, children, align = "right" }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{button}</div>
      {open && <div className={`absolute top-full z-50 mt-2 min-w-[220px] rounded-xl border border-line bg-panel p-1.5 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function TopBar({ openMenu, openSim, go }: { openMenu: () => void; openSim: () => void; go: (p: PageId) => void }) {
  const { t, lang, setLang } = useI18n();
  const { snap, conn } = useStore();
  const n = snap?.alerts.counts.active ?? 0;
  const crit = snap?.alerts.counts.critical ?? 0;
  const connColor = conn === "online" ? "#34d399" : conn === "connecting" ? "#fbbf24" : "#f87171";
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-[#0c141d]/95 px-3 backdrop-blur sm:gap-3 sm:px-4">
      <button className="rounded-lg border border-line p-1.5 text-mute lg:hidden" onClick={openMenu} aria-label="menu"><span className="block h-3 w-4 border-y-2 border-mute before:mt-[3px] before:block before:border-t-2 before:border-mute" /></button>
      <div className="hidden sm:block lg:hidden"><Logo /></div>
      <div className="hidden min-w-[150px] md:block">
        <div className="lbl">{t("top.simTime")}</div>
        <div className="font-mono text-[13px] tabular-nums text-ink">{fmtDateTime(snap?.sim_time)} <span className="text-mute">UTC</span></div>
      </div>
      <span className="rounded-md border border-warn/50 bg-warn/15 px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-warn">{t("top.simMode")}</span>
      <div className="hidden lg:block">
        <select className="input !py-1 text-xs" aria-label={t("top.site")} defaultValue="A">
          <option value="A">{t("top.siteA")}</option>
          <option value="B" disabled>{t("top.siteB")}</option>
        </select>
      </div>
      <div className="flex-1" />
      <div className="hidden items-center gap-1.5 text-xs sm:flex" title={`WebSocket: ${conn}`} style={{ color: connColor }}>
        {conn === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{t(`conn.${conn}`)}</span>
      </div>
      <button onClick={openSim} className="btn btn-primary !py-1"><Cpu size={15} /><span className="hidden sm:inline">{t("top.controls")}</span></button>
      <Menu button={
        <button className="relative rounded-lg border border-line p-1.5 text-mute hover:text-ink" aria-label={t("top.notifications")}>
          <Bell size={17} />
          {n > 0 && <span className={`absolute -right-1.5 -top-1.5 min-w-[17px] rounded-full px-1 text-center text-[10px] font-bold text-black ${crit ? "bg-crit" : "bg-warn"}`}>{n}</span>}
        </button>}>
        {(close) => (
          <div className="w-[320px] max-w-[88vw]">
            <div className="flex items-center justify-between px-2 py-1.5"><span className="text-xs font-semibold">{t("top.activeAlerts", { n })}</span><button className="text-[11px] text-accent" onClick={() => { go("alerts"); close(); }}>{t("common.viewAll")}</button></div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {(snap?.alerts.recent ?? []).filter((a) => a.status !== "resolved" && a.severity !== "info").slice(0, 8).map((a) => (
                <button key={a.id} onClick={() => { go("alerts"); close(); }} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel2">
                  <AlertTriangle size={14} className={a.severity === "critical" ? "text-crit" : "text-warn"} />
                  <span className="min-w-0 flex-1 text-xs"><span className="block truncate font-medium">{t(`cat.${a.category}`)}</span><span className="text-[10.5px] text-mute">{a.id} · {fmtTime(a.time)}</span></span>
                  <SevBadge sev={a.severity} />
                </button>
              ))}
              {n === 0 && <div className="px-2 py-4 text-center text-xs text-mute">{t("alerts.none")}</div>}
            </div>
          </div>
        )}
      </Menu>
      <Menu button={<button className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-xs text-ink hover:border-accent/50" aria-label={t("top.language")}><Languages size={15} /><span>{LANGS.find((l) => l.code === lang)?.native}</span><ChevronDown size={13} className="text-mute" /></button>}>
        {(close) => <>{LANGS.map((l) => (
          <button key={l.code} onClick={() => { setLang(l.code); close(); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-panel2 ${l.code === lang ? "text-accent" : ""}`}><span>{l.native}</span><span className="text-[11px] text-mute">{l.english}</span></button>
        ))}</>}
      </Menu>
      <Menu button={<button className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 hover:border-accent/50" aria-label={t("top.profile")}><span className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-accent"><User size={14} /></span></button>}>
        {() => <div className="w-56 p-2 text-xs"><div className="text-sm font-semibold">{t("top.operator")}</div><div className="text-mute">{t("top.role")}</div><div className="mt-2 border-t border-line pt-2 text-[11px] text-mute">{t("top.fictional")}</div></div>}
      </Menu>
    </header>
  );
}

export function Banners({ go }: { go: (p: PageId) => void }) {
  const { t, name } = useI18n();
  const { snap } = useStore();
  if (!snap) return null;
  const danger = snap.safety.state === "DANGER";
  const em = snap.emergency;
  return (
    <div className="space-y-2">
      {danger && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-crit/60 bg-crit/15 p-3 animate-pulseRing" role="alert">
          <ShieldAlert className="mt-0.5 text-crit" size={22} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-bold uppercase tracking-wide text-crit">{t("emergency.title")}</div>
            <div className="mt-0.5 text-red-100">
              {t("emergency.affected")}: {em.hazards.filter((h) => h.state === "DANGER").map((h) => `${name(h.segment_id, h.name)} (${h.segment_id})`).join(", ") || "—"}
              {em.affected_workers.length > 0 && <> · {t("emergency.workers")}: {em.affected_workers.join(", ")}</>}
              {em.rover_affected && <> · {t("emergency.rover")}</>}
            </div>
            <div className="mt-1 text-xs text-red-200/90">{t("action.follow_emergency_procedure")}</div>
          </div>
          <button className="btn btn-danger" onClick={() => go("navigation")}>{t("emergency.exitRoutes")}</button>
        </div>
      )}
      {em.evacuation && <div className="rounded-xl border border-crit/50 bg-crit/10 px-3 py-2 text-xs text-red-100">🚨 {t("emergency.evac")}</div>}
    </div>
  );
}

const SCENARIOS = ["warning", "critical_gas", "sensor_failure", "comm_loss", "blocked_tunnel", "evacuation"] as const;
export function SimPanel({ open, close }: { open: boolean; close: () => void }) {
  const { t, name } = useI18n();
  const { snap, mine, run, notify } = useStore();
  const [seg, setSeg] = useState("");
  const [gas, setGas] = useState("ch4");
  const [zone, setZone] = useState("East");
  if (!open) return null;
  const needsSeg = (s: string) => ["warning", "critical_gas", "sensor_failure", "blocked_tunnel"].includes(s);
  const fire = (s: string) => run(async () => {
    await api.scenario(s, { ...(needsSeg(s) && seg ? { segment_id: seg } : {}), ...(s === "warning" || s === "critical_gas" ? { gas } : {}), ...(s === "comm_loss" ? { zone } : {}) });
    notify(t(`sim.fired.${s}`));
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={close}>
      <div className="h-full w-[380px] max-w-full overflow-y-auto border-l border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">{t("sim.title")}</h2><button onClick={close} aria-label="close" className="text-mute hover:text-ink"><X size={18} /></button></div>
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">{t("sim.notice")}</div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="btn btn-primary" disabled={snap?.running} onClick={() => run(api.start)}><Play size={14} />{snap?.running ? t("sim.running") : t("sim.start")}</button>
          <button className="btn" disabled={!snap?.running} onClick={() => run(api.pause)}><Pause size={14} />{t("sim.pause")}</button>
          <button className="btn btn-danger" onClick={() => run(async () => { await api.reset(); notify(t("sim.resetDone")); })}><RotateCcw size={14} />{t("sim.reset")}</button>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2"><button className="btn" disabled={snap?.running} onClick={() => run(api.start)}>{t("sim.resume")}</button><span /><span /></div>
        <div className="mt-4"><div className="lbl mb-1.5">{t("sim.speed")}</div>
          <div className="flex flex-wrap gap-1.5">{(snap?.speeds ?? [1, 2, 5, 10, 30, 60]).map((s) => (
            <button key={s} onClick={() => run(() => api.speed(s))} className={`btn !px-2.5 ${snap?.speed === s ? "btn-primary" : ""}`}>{s}×</button>))}</div>
          <p className="mt-1 text-[11px] text-mute">{t("sim.speedNote")}</p>
        </div>
        <div className="mt-5"><div className="lbl mb-1.5">{t("sim.scenarios")}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-mute">{t("sim.segment")}
              <select className="input mt-1 w-full" value={seg} onChange={(e) => setSeg(e.target.value)}><option value="">{t("sim.default")}</option>{mine?.segments.map((s) => <option key={s.id} value={s.id}>{s.id} · {name(s.id, s.name)}</option>)}</select></label>
            <label className="text-[11px] text-mute">{t("sim.gas")}
              <select className="input mt-1 w-full" value={gas} onChange={(e) => setGas(e.target.value)}>{["ch4", "co", "h2s", "o2"].map((g) => <option key={g} value={g}>{t(`gas.${g}`)}</option>)}</select></label>
            <label className="col-span-2 text-[11px] text-mute">{t("sim.zone")}
              <select className="input mt-1 w-full" value={zone} onChange={(e) => setZone(e.target.value)}>{["Main", "North", "South", "East"].map((z) => <option key={z} value={z}>{t(`zone.${z}`)}</option>)}</select></label>
          </div>
          <div className="mt-2.5 space-y-1.5">
            {SCENARIOS.map((s) => <button key={s} className={`btn w-full justify-start ${s === "critical_gas" || s === "evacuation" ? "btn-danger" : ""}`} onClick={() => fire(s)}>{t(`sim.sc.${s}`)}</button>)}
            <button className="btn w-full justify-start btn-primary" onClick={() => fire("clear")}>{t("sim.sc.clear")}</button>
          </div>
        </div>
        <div className="mt-5"><div className="lbl mb-1.5">{t("sim.active")}</div>
          {snap?.scenarios.length ? <ul className="space-y-1 text-xs">{snap.scenarios.map((s) => <li key={s.id} className="rounded-lg border border-line px-2.5 py-1.5">{t(`sim.sc.${s.kind === "gas" ? (s.until ? "warning" : "critical_gas") : s.kind === "sensor_failure" ? "sensor_failure" : s.kind === "comm_loss" ? "comm_loss" : s.kind === "blocked_tunnel" ? "blocked_tunnel" : "evacuation"}`)} {s.segment_id ? `· ${s.segment_id}` : ""} {s.zone ? `· ${t(`zone.${s.zone}`)}` : ""} {s.gas ? `· ${t(`gas.${s.gas}`)}` : ""}</li>)}</ul>
            : <div className="text-xs text-mute">{t("sim.noneActive")}</div>}
          {snap && snap.ambient.length > 0 && <div className="mt-2 text-[11px] text-mute">{t("sim.ambient", { n: snap.ambient.length })}</div>}
        </div>
        <div className="mt-5 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs"><span className="text-mute">{t("top.simTime")}</span><span className="font-mono">{fmtDateTime(snap?.sim_time)}</span></div>
        {snap && <div className="mt-2 flex items-center justify-between"><span className="text-xs text-mute">{t("kpi.safety")}</span><StateBadge state={snap.safety.state} /></div>}
      </div>
    </div>
  );
}
