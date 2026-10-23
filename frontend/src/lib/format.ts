export const fmtTime = (iso?: string | null) => (iso ? iso.slice(11, 19) : "--:--:--");
export const fmtDateTime = (iso?: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : "—");
export const epochToTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
export const epochToHM = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
export const fmtNum = (v: number | null | undefined, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(d));
export const fmtDur = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};
export const trendArrow = (d: number | null | undefined, eps = 0) => (d === null || d === undefined ? "→" : d > eps ? "↑" : d < -eps ? "↓" : "→");

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
export function downloadText(name: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const STATE_COLOR: Record<string, string> = { SAFE: "#34d399", WARNING: "#fbbf24", DANGER: "#f87171", UNKNOWN: "#94a3b8" };
export const SEV_COLOR: Record<string, string> = { critical: "#f87171", warning: "#fbbf24", info: "#22d3ee" };
export const GAS_COLOR: Record<string, string> = { ch4: "#22d3ee", co: "#fbbf24", o2: "#34d399", co2: "#a78bfa", h2s: "#fb7185", temp: "#fb923c", rh: "#38bdf8", pressure: "#c4b5fd" };
