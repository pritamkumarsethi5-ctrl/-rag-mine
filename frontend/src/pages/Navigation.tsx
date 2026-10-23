import { useEffect, useMemo, useState } from "react";
import { ArrowUp, CornerUpLeft, CornerUpRight, Flag, Pause, Play, RefreshCw, Square, AlertTriangle, Siren, RotateCw } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { DEFAULT_OPTS, MineScene, type ExtraRoute } from "../components/MineScene";
import { Bar, Card, PageHeader, Pill, SimNotice } from "../components/ui";
import { fmtDur, fmtNum } from "../lib/format";
import { instructionText } from "../lib/text";
import { useStore } from "../store";
import type { Instruction, RoutePreview } from "../types";

function TurnIcon({ i }: { i: Instruction }) {
  const s = 18;
  if (i.type === "arrive") return <Flag size={s} className="text-ok" />;
  if (i.type === "reroute") return <RotateCw size={s} className="text-warn" />;
  if (i.type === "turn") return i.turn?.includes("left") ? <CornerUpLeft size={s} /> : <CornerUpRight size={s} />;
  return <ArrowUp size={s} />;
}

export default function NavigationPage() {
  const { t, name } = useI18n();
  const { snap, mine, run, notify, selectedWorker, selectWorker, selectSegment, selectedSegment } = useStore();
  const [dest, setDest] = useState("J-04");
  const [preview, setPreview] = useState<{ routes: RoutePreview[]; message: string | null; blocked: string[] } | null>(null);
  const wid = selectedWorker ?? snap?.workers[0]?.id ?? "W-101";
  const w = snap?.workers.find((x) => x.id === wid);
  const nav = snap?.navigation.find((n) => n.worker_id === wid) ?? null;
  const sigKey = snap ? `${wid}|${dest}|${w?.segment_id}|${snap.safety.counts.danger}|${snap.safety.counts.warning}|${snap.safety.counts.unknown}|${snap.scenarios.length}|${Math.round((w?.route_remaining_m ?? 0) / 25)}` : "";
  useEffect(() => {
    if (!snap) return;
    const mode = nav?.mode ?? "normal";
    api.routes(wid, mode === "emergency" ? null : dest, mode).then((r) => setPreview({ routes: r.routes, message: r.message, blocked: r.blocked_segments })).catch(() => setPreview(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigKey]);
  const extra: ExtraRoute[] = useMemo(() => !preview || nav ? [] : preview.routes.map((r, i) => ({ path: r.path, color: i === 0 ? "#22d3ee" : "#a78bfa", dashed: i === 1, width: i === 0 ? 6 : 4 })), [preview, nav]);
  if (!snap || !mine) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const dests = mine.nodes.filter((n) => n.id !== w?.destination);
  const primary = preview?.routes[0];
  const noRoute = nav ? !nav.found : preview ? !preview.routes[0]?.found : false;
  const instr = nav?.instructions ?? primary?.instructions ?? [];
  const next = instr.find((i) => i.type !== "start" && i.type !== "reroute") ?? instr[0];
  const act = (a: "pause" | "resume" | "stop" | "recalculate") => run(() => api.navControl(wid, a));
  const start = (mode: "normal" | "emergency", alt = false) => run(async () => { const r = await api.navStart(wid, mode === "emergency" ? null : dest, mode, alt); if (r?.message) notify(t("route.none")); });
  return (
    <div>
      <PageHeader title={t("nav.navigation")} sub={t("navp.sub")} />
      <div className="mb-3"><SimNotice /></div>
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card title={t("navp.setup")}>
            <div className="space-y-3 text-xs">
              <label className="block text-mute">{t("navp.worker")}
                <select className="input mt-1 w-full" value={wid} onChange={(e) => selectWorker(e.target.value)}>{snap.workers.map((x) => <option key={x.id} value={x.id}>{x.callsign} · {x.id} · {x.segment_id}</option>)}</select></label>
              <div className="rounded-lg border border-line px-2.5 py-2"><div className="lbl">{t("navp.position")}</div><div className="mt-0.5">{w ? `${name(w.segment_id)} (${w.segment_id})` : "—"} <span className="text-mute">· {t("common.simulated")}</span></div></div>
              <label className="block text-mute">{t("navp.destination")}
                <select className="input mt-1 w-full" value={dest} onChange={(e) => setDest(e.target.value)} disabled={nav?.mode === "emergency"}>{dests.map((n) => <option key={n.id} value={n.id}>{name(n.id, n.name)}{n.checkpoint ? ` · ${n.checkpoint}` : ""}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-primary" onClick={() => start("normal")} disabled={snap.emergency.evacuation}><Play size={14} />{t("navp.start")}</button>
                <button className="btn" onClick={() => start("normal", true)} disabled={snap.emergency.evacuation || !(preview && preview.routes.length > 1)}>{t("navp.startAlt")}</button>
                <button className="btn" onClick={() => act(nav?.paused ? "resume" : "pause")} disabled={!nav}>{nav?.paused ? <Play size={14} /> : <Pause size={14} />}{nav?.paused ? t("navp.resume") : t("navp.pause")}</button>
                <button className="btn" onClick={() => act("recalculate")} disabled={!nav}><RefreshCw size={14} />{t("navp.recalc")}</button>
                <button className="btn" onClick={() => act("stop")} disabled={!nav || nav.system}><Square size={14} />{t("navp.stop")}</button>
                <button className="btn btn-danger" onClick={() => start("emergency")} disabled={snap.emergency.evacuation}><Siren size={14} />{t("navp.emergency")}</button>
              </div>
            </div>
          </Card>
          {(noRoute || (w && !w.exit.found)) && (
            <div className="rounded-xl border border-crit/60 bg-crit/15 p-3 text-sm font-bold tracking-wide text-crit" role="alert"><AlertTriangle className="mr-2 inline" size={17} />{t("route.none")}
              <div className="mt-1 text-[11px] font-normal text-red-200">{t("route.noneHelp")}</div></div>)}
          <Card title={t("navp.summary")}>
            {nav ? (<div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap gap-1.5"><Pill color={nav.mode === "emergency" ? "#f87171" : "#22d3ee"}>{nav.mode === "emergency" ? t("navp.emergencyMode") : t("navp.normalMode")}</Pill><Pill color="#94a3b8">{t(`navstatus.${nav.status}`)}</Pill>{nav.paused && <Pill color="#fbbf24">{t("navp.paused")}</Pill>}</div>
              <div className="grid grid-cols-3 gap-2"><div><div className="lbl">{t("navp.distance")}</div><div className="text-lg font-semibold tabular-nums">{fmtNum(nav.remaining_m, 0)} m</div></div><div><div className="lbl">{t("navp.eta")}</div><div className="text-lg font-semibold tabular-nums">{fmtDur(nav.eta_s)}</div></div><div><div className="lbl">{t("navp.dest")}</div><div className="font-medium">{name(nav.dest_node, nav.dest_name)}</div></div></div>
              <div><div className="mb-1 flex justify-between text-mute"><span>{t("navp.progress")}</span><span className="tabular-nums">{Math.round(nav.progress * 100)}%</span></div><Bar pct={nav.progress * 100} color="#22d3ee" /></div>
              {nav.warnings.map((x) => <div key={x.segment_id} className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-warn">⚠ {t(`routewarn.${x.reason}`, { seg: name(x.segment_id) })}</div>)}
            </div>) : primary?.found ? (<div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2"><div><div className="lbl">{t("navp.shortest")}</div><div className="text-lg font-semibold tabular-nums">{fmtNum(primary.distance_m, 0)} m · {fmtDur(primary.eta_s)}</div></div>
                {preview!.routes[1] && <div><div className="lbl">{t("navp.alternate")}</div><div className="text-lg font-semibold tabular-nums text-violet-300">{fmtNum(preview!.routes[1].distance_m, 0)} m · {fmtDur(preview!.routes[1].eta_s)}</div></div>}</div>
              {primary.warnings.map((x) => <div key={x.segment_id} className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-warn">⚠ {t(`routewarn.${x.reason}`, { seg: name(x.segment_id) })}</div>)}
              <div className="text-[11px] text-mute">{t("navp.previewHint")}</div></div>) : <div className="text-xs text-mute">{t("navp.idle")}</div>}
            {preview && preview.blocked.length > 0 && <div className="mt-2 text-[11px] text-mute">{t("navp.avoided")}: {preview.blocked.join(", ")} ({t("navp.avoidedWhy")})</div>}
          </Card>
          <Card title={t("navp.exit")}>
            {w?.exit.found ? <div className="text-xs"><div className="font-medium">{name(w.exit.dest_node)}</div><div className="text-mute">{Math.round(w.exit.distance_m)} m · {fmtDur(w.exit.eta_s)} · {w.exit.segments.join(" → ")}</div></div> : <div className="text-xs font-semibold text-crit">{t("route.none")}</div>}
          </Card>
        </div>
        <div className="space-y-4">
          <MineScene mine={mine} snap={snap} className="h-[46vh] min-h-[340px]" navRoute={nav} extraRoutes={extra} selectedSegment={selectedSegment} onSelectSegment={selectSegment}
            opts={{ ...DEFAULT_OPTS, trajectory: false, labels: true, cloud: false, sensors: false }} onSelectWorker={selectWorker} />
          <Card title={t("navp.instructions")} right={nav?.rerouted_recently ? <Pill color="#fbbf24">{t("nav.i.reroute")}</Pill> : null}>
            {next && nav && <div className="mb-3 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 p-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/20 text-accent"><TurnIcon i={next} /></span><div className="min-w-0 flex-1"><div className="lbl">{t("navp.next")}</div><div className="text-sm font-semibold">{instructionText(t, name, next)}</div>{next.at_distance_m !== undefined && next.type !== "arrive" && <div className="text-[11px] text-mute">{t("navp.inM", { d: Math.round(next.at_distance_m) })}</div>}</div></div>}
            <ol className="space-y-1.5">
              {instr.map((i, k) => <li key={k} className="flex items-center gap-3 rounded-lg border border-line px-2.5 py-2 text-xs"><span className="text-mute"><TurnIcon i={i} /></span><span className="flex-1">{instructionText(t, name, i)}</span>{i.at_distance_m !== undefined && i.type !== "reroute" && <span className="tabular-nums text-mute">{Math.round(i.at_distance_m)} m</span>}</li>)}
              {!instr.length && <li className="text-xs text-mute">{noRoute ? t("route.none") : t("navp.idle")}</li>}
            </ol>
            <p className="mt-2 text-[10.5px] text-mute">{t("navp.derived")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
