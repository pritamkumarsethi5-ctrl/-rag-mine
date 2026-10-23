import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { HistoryResult } from "../types";

/** Polls generated history records from the backend (server-side bucketing). */
export function useHistory(opts: { metrics: string[]; sensor?: string; range?: string; from?: string; to?: string; every?: number; max_points?: number }) {
  const [data, setData] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([opts.metrics, opts.sensor, opts.range, opts.from, opts.to, opts.max_points]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const load = () => api.history({ ...opts, max_points: opts.max_points ?? 180 })
      .then((d) => { if (alive.current) { setData(d); setError(null); } })
      .catch((e) => alive.current && setError(String(e.message ?? e)));
    load();
    const id = window.setInterval(load, opts.every ?? 3000);
    return () => { alive.current = false; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, error };
}
