import type { Analytics, HistoryResult, MineMap, RoutePreview } from "./types";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (body as any).detail;
    throw new Error(typeof d === "string" ? d : JSON.stringify(d ?? res.statusText));
  }
  return body as T;
}
const post = <T,>(p: string, b?: unknown) => req<T>(p, { method: "POST", body: b === undefined ? undefined : JSON.stringify(b) });

export const api = {
  mineMap: () => req<MineMap>("/api/mine/map"),
  history: (p: { metrics: string[]; sensor?: string; range?: string; from?: string; to?: string; max_points?: number }) => {
    const q = new URLSearchParams({ metrics: p.metrics.join(",") });
    if (p.sensor && p.sensor !== "all") q.set("sensor", p.sensor);
    if (p.range) q.set("range", p.range);
    if (p.from) q.set("from", p.from);
    if (p.to) q.set("to", p.to);
    if (p.max_points) q.set("max_points", String(p.max_points));
    return req<HistoryResult>(`/api/telemetry/history?${q}`);
  },
  analytics: (range: string) => req<Analytics>(`/api/analytics?range=${encodeURIComponent(range)}`),
  routes: (worker_id: string, dest: string | null, mode: "normal" | "emergency") =>
    req<{ routes: RoutePreview[]; message: string | null; blocked_segments: string[] }>(
      `/api/routes?worker_id=${worker_id}&mode=${mode}${dest ? `&dest=${encodeURIComponent(dest)}` : ""}`),
  rover: () => req<{ rover: { trajectory: number[][] } }>("/api/rover"),
  start: () => post("/api/simulation/start"),
  pause: () => post("/api/simulation/pause"),
  reset: () => post("/api/simulation/reset"),
  speed: (speed: number) => post("/api/simulation/speed", { speed }),
  scenario: (scenario: string, extra: { segment_id?: string; gas?: string; zone?: string } = {}) =>
    post("/api/simulation/scenario", { scenario, ...extra }),
  roverCommand: (command: string) => post("/api/rover/command", { command }),
  navStart: (worker_id: string, dest_node: string | null, mode: "normal" | "emergency", alternate = false) =>
    post<{ message: string | null }>("/api/navigation/start", { worker_id, dest_node, mode, alternate }),
  navControl: (worker_id: string, action: "pause" | "resume" | "stop" | "recalculate") => post("/api/navigation/control", { worker_id, action }),
  ack: (id: string) => post(`/api/alerts/${id}/acknowledge`),
  resolve: (id: string) => post(`/api/alerts/${id}/resolve`),
  putThreshold: (gas: string, vals: Record<string, number>) => req("/api/thresholds", { method: "PUT", body: JSON.stringify({ gas, ...vals }) }),
  resetThresholds: () => post("/api/thresholds/reset"),
  alerts: (q: { severity?: string; category?: string; status?: string; q?: string }) => {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v && p.set(k, v));
    p.set("limit", "300");
    return req<{ alerts: import("./types").AlertItem[]; counts: any }>(`/api/alerts?${p}`);
  },
};
