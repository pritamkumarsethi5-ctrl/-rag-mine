import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { MineMap, Snapshot } from "./types";

export type Conn = "connecting" | "online" | "offline";
interface Ctx {
  snap: Snapshot | null; mine: MineMap | null; conn: Conn; lastMsgAt: number; selectedSegment: string | null;
  selectSegment: (id: string | null) => void; selectedWorker: string | null; selectWorker: (id: string | null) => void;
  toast: string | null; notify: (m: string) => void;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}
const C = createContext<Ctx>(null as unknown as Ctx);
export const useStore = () => useContext(C);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mine, setMine] = useState<MineMap | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [lastMsgAt, setLast] = useState(0);
  const [selectedSegment, selectSegment] = useState<string | null>(null);
  const [selectedWorker, selectWorker] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      setConn("connecting");
      const override = (import.meta as any).env?.VITE_WS_URL as string | undefined;
      const url = override ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/telemetry`;
      ws = new WebSocket(url);
      ws.onopen = () => setConn("online");
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "telemetry") { setSnap(d); setLast(Date.now()); }
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => { setConn("offline"); if (!closed) retry = window.setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    };
    connect();
    api.mineMap().then(setMine).catch(() => undefined);
    const keepAlive = window.setInterval(() => { if (ws?.readyState === 1) ws.send("ping"); }, 20000);
    return () => { closed = true; window.clearTimeout(retry); window.clearInterval(keepAlive); ws?.close(); };
  }, []);

  // retry the map fetch if the backend was not up yet
  useEffect(() => {
    if (mine || conn !== "online") return;
    api.mineMap().then(setMine).catch(() => undefined);
  }, [conn, mine]);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    try { return await fn(); } catch (e: any) { notify(String(e?.message ?? e)); return undefined; }
  }, [notify]);

  const value = useMemo(() => ({ snap, mine, conn, lastMsgAt, selectedSegment, selectSegment, selectedWorker, selectWorker, toast, notify, run }),
    [snap, mine, conn, lastMsgAt, selectedSegment, selectedWorker, toast, notify, run]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
