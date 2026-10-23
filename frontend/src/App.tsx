import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { Banners, PAGES, Sidebar, SimPanel, TopBar, type PageId } from "./components/Shell";
import { useStore } from "./store";
import Alerts from "./pages/Alerts";
import Gas from "./pages/Gas";
import Health from "./pages/Health";
import Historical from "./pages/Historical";
import LiveMap from "./pages/LiveMap";
import Navigation from "./pages/Navigation";
import Overview from "./pages/Overview";
import Rover from "./pages/Rover";
import Settings from "./pages/Settings";
import Workers from "./pages/Workers";

const fromHash = (): PageId => {
  const h = location.hash.replace("#/", "").replace("#", "");
  return (PAGES.find((p) => p.id === h)?.id ?? "overview") as PageId;
};

export default function App() {
  const { t } = useI18n();
  const { toast, conn, snap } = useStore();
  const [page, setPage] = useState<PageId>(fromHash);
  const [menu, setMenu] = useState(false);
  const [sim, setSim] = useState(false);
  useEffect(() => { const f = () => setPage(fromHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const go = (p: PageId) => { location.hash = `/${p}`; setPage(p); window.scrollTo({ top: 0 }); };
  return (
    <div className="flex h-full">
      <Sidebar page={page} go={go} open={menu} close={() => setMenu(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar openMenu={() => setMenu(true)} openSim={() => setSim(true)} go={go} />
        <main className="flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="mx-auto max-w-[1680px] space-y-3">
            <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn">⚠ {t("banner.sim")}</div>
            {conn === "offline" && <div className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{t("banner.offline")}</div>}
            {snap && !snap.running && <div className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[11.5px] text-mute">⏸ {t("banner.paused")}</div>}
            <Banners go={go} />
            {page === "overview" && <Overview go={go} />}
            {page === "map" && <LiveMap go={go} />}
            {page === "gas" && <Gas />}
            {page === "workers" && <Workers go={go} />}
            {page === "rover" && <Rover />}
            {page === "navigation" && <Navigation />}
            {page === "alerts" && <Alerts />}
            {page === "history" && <Historical />}
            {page === "health" && <Health />}
            {page === "settings" && <Settings />}
          </div>
        </main>
      </div>
      <SimPanel open={sim} close={() => setSim(false)} />
      {toast && <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-accent/40 bg-panel px-4 py-2 text-xs shadow-2xl" role="status">{toast}</div>}
    </div>
  );
}
