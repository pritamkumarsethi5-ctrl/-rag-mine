import type { AlertItem, Instruction, Reason } from "../types";

type T = (k: string, v?: Record<string, string | number | null | undefined>) => string;
type N = (id: string | null | undefined, fb?: string | null) => string;

export function gasSentence(t: T, name: N, p: { metric?: string; value?: number; unit?: string; threshold?: number; direction?: string; severity?: string; segment_id?: string | null; stale?: boolean }) {
  return t("alert.d.gas", {
    gas: t(`gas.${p.metric}`), value: p.value, unit: p.unit, threshold: p.threshold,
    dir: t(`dir.${p.direction ?? "high"}`), level: t(`lvl.${p.severity === "critical" ? "critical" : "warning"}`),
    seg: p.segment_id ? `${name(p.segment_id)} (${p.segment_id})` : "—",
  }) + (p.stale ? " " + t("alert.d.stale") : "");
}

export function alertDescription(t: T, name: N, a: AlertItem): string {
  const p = a.params;
  switch (a.category) {
    case "critical_gas": case "gas_warning": case "oxygen_range":
      return gasSentence(t, name, { ...p, severity: a.severity, segment_id: a.segment_id });
    case "sensor_unavailable": return t("alert.d.sensor_unavailable", { sensor: p.sensor_id, seg: name(a.segment_id) });
    case "stale_telemetry": return t("alert.d.stale_telemetry", { sensor: p.sensor_id, age: p.age_s ? Math.round(p.age_s) : "—" });
    case "rover_obstacle": return t(`alert.d.rover_obstacle.${p.kind}`, { seg: name(a.segment_id) });
    case "worker_hazard": return t(p.inside ? "alert.d.worker_hazard.inside" : "alert.d.worker_hazard", { worker: p.worker_id, dist: p.distance_m, seg: name(p.hazard_segment ?? a.segment_id) });
    case "route_blocked":
      if (p.kind === "tunnel_blocked") return t("alert.d.route.tunnel", { seg: name(a.segment_id) });
      if (p.kind === "no_route") return t("alert.d.route.none", { worker: p.worker_id });
      return t("alert.d.route.rerouted", { worker: p.worker_id, dest: name(p.dest) });
    case "comm_lost":
      if (p.kind === "zone") return t("alert.d.comm.zone", { zone: t(`zone.${p.zone}`) });
      if (p.kind === "worker") return t("alert.d.comm.worker", { worker: p.worker_id, age: p.age_s });
      return t("alert.d.comm.rover", { age: p.age_s });
    case "mapping_event": return t("alert.d.mapping", { seg: name(a.segment_id), pct: p.coverage_pct });
    case "evacuation": return t("alert.d.evacuation", { n: p.workers, m: p.evacuated });
    default: return a.category;
  }
}

export function reasonText(t: T, name: N, r: Reason): string {
  switch (r.code) {
    case "gas_critical": case "gas_warning": return gasSentence(t, name, { ...r, severity: r.code === "gas_critical" ? "critical" : "warning" });
    case "sensor_unavailable": return t("alert.d.sensor_unavailable", { sensor: r.sensor_id, seg: name(r.segment_id) });
    case "stale_telemetry": return t("alert.d.stale_telemetry", { sensor: r.sensor_id, age: r.age_s ? Math.round(r.age_s) : "—" });
    case "no_sensor": return t("reason.no_sensor");
    case "invalid_reading": return t("reason.invalid", { gas: t(`gas.${r.metric}`) });
    case "tunnel_blocked": return t("alert.d.route.tunnel", { seg: name(r.segment_id) });
    case "restricted_area": return t("reason.restricted");
    default: return r.code;
  }
}

export function instructionText(t: T, name: N, i: Instruction): string {
  const d = Math.round(i.distance_m ?? 0);
  switch (i.type) {
    case "start": return t("nav.i.start", { seg: name(i.segment_id, i.segment_name), d });
    case "turn": return t("nav.i.turn", { turn: t(`turn.${i.turn}`), jn: name(i.junction_id, i.junction_name), seg: name(i.segment_id, i.segment_name), d });
    case "continue": return t("nav.i.continue", { jn: name(i.junction_id, i.junction_name), seg: name(i.segment_id, i.segment_name), d });
    case "arrive": return t("nav.i.arrive", { dest: name(i.node_id, i.node_name) });
    case "reroute": return t("nav.i.reroute");
    default: return i.text;
  }
}
