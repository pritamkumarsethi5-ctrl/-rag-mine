import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { STATE_COLOR, SEV_COLOR, fmtTime } from "../lib/format";
import type { SafetyState } from "../types";

export function Card({ title, right, children, className = "", pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && <div className="card-h"><span>{title}</span><span className="flex items-center gap-2">{right}</span></div>}
      <div className={pad ? "px-4 pb-4" : ""}>{children}</div>
    </section>
  );
}

export function StateBadge({ state, small = false }: { state: SafetyState | string; small?: boolean }) {
  const { t } = useI18n();
  const c = STATE_COLOR[state] ?? "#94a3b8";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border font-semibold ${small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ color: c, borderColor: c + "66", background: c + "18" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {t(`state.${state}`)}
    </span>
  );
}

export function SevBadge({ sev }: { sev: string }) {
  const { t } = useI18n();
  const c = SEV_COLOR[sev] ?? "#94a3b8";
  return <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ color: c, borderColor: c + "66", background: c + "18" }}>{t(`sev.${sev}`)}</span>;
}

export function Pill({ children, color = "#22d3ee" }: { children: ReactNode; color?: string }) {
  return <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium" style={{ color, borderColor: color + "55", background: color + "14" }}>{children}</span>;
}

export function KpiCard({ label, value, unit, state, trend, updated, onClick, icon, sub }: {
  label: string; value: ReactNode; unit?: string; state?: SafetyState | "NA"; trend?: ReactNode; updated?: string | null; onClick?: () => void; icon?: ReactNode; sub?: ReactNode;
}) {
  const c = state && state !== "NA" ? STATE_COLOR[state] : "#22d3ee";
  return (
    <button onClick={onClick} className="card group relative overflow-hidden p-3.5 text-left transition hover:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/60">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c }} />
      <div className="flex items-start justify-between gap-2">
        <span className="lbl leading-tight">{label}</span>
        <span className="text-mute group-hover:text-accent">{icon}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: state && state !== "NA" ? c : undefined }}>{value}</span>
        {unit && <span className="text-xs text-mute">{unit}</span>}
      </div>
      <div className="mt-1.5 flex min-h-[16px] items-center justify-between gap-2 text-[11px] text-mute">
        <span>{trend ?? sub}</span>
        {updated !== undefined && <span className="tabular-nums">{fmtTime(updated)}</span>}
      </div>
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size = "md" }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line bg-bg">
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => onChange(o.value)}
          className={`${size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} font-medium transition ${o.value === value ? "bg-accent/20 text-accent" : "text-mute hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-mute hover:text-ink">
      <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
        className={`relative h-4 w-7 rounded-full border transition ${on ? "border-accent/60 bg-accent/30" : "border-line bg-bg"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${on ? "left-3.5 bg-accent" : "left-0.5 bg-mute"}`} />
      </button>
      {label}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-24 items-center justify-center text-xs text-mute">{children}</div>;
}

export function Bar({ pct, color = "#22d3ee" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-lg font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-0.5 text-xs text-mute">{sub}</p>}</div>
      <div className="flex flex-wrap items-center gap-2">{right}</div>
    </div>
  );
}

export function SimNotice({ k = "notice.positions" }: { k?: string }) {
  const { t } = useI18n();
  return <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[11.5px] text-accent">⚠ {t(k)}</div>;
}
