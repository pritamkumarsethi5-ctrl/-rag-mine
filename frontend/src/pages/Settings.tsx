import { useState } from "react";
import { api } from "../api";
import { LANGS, useI18n } from "../i18n";
import { Card, PageHeader, Segmented } from "../components/ui";
import { useStore } from "../store";
import { GAS_INFO, GAS_KEYS, type GasKey } from "../types";

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { snap, run, notify } = useStore();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!snap) return <div className="p-8 text-sm text-mute">{t("common.connecting")}</div>;
  const th = snap.thresholds;
  const save = (g: GasKey) => run(async () => {
    const vals: Record<string, number> = {};
    Object.entries(draft).filter(([k]) => k.startsWith(g + ".")).forEach(([k, v]) => { if (v !== "" && !Number.isNaN(+v)) vals[k.split(".")[1]] = +v; });
    if (!Object.keys(vals).length) return;
    await api.putThreshold(g, vals);
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(g + "."))));
    notify(t("settings.saved"));
  });
  return (
    <div>
      <PageHeader title={t("nav.settings")} sub={t("settings.sub")} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t("settings.language")}>
          <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.native }))} />
          <p className="mt-2 text-[11px] text-mute">{t("settings.langNote")}</p>
        </Card>
        <Card title={t("settings.sim")}>
          <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="lbl">{t("settings.mode")}</dt><dd>{t("top.simMode")}</dd></div><div><dt className="lbl">{t("settings.speed")}</dt><dd>{snap.speed}×</dd></div><div><dt className="lbl">{t("settings.tick")}</dt><dd>{snap.tick_interval_s} s</dd></div><div><dt className="lbl">{t("settings.resets")}</dt><dd>{snap.health.reset_count}</dd></div></dl>
          <p className="mt-2 text-[11px] text-mute">{t("settings.simNote")}</p>
        </Card>
        <Card className="xl:col-span-2" title={t("settings.thresholds")} right={<button className="btn" onClick={() => run(async () => { await api.resetThresholds(); notify(t("settings.saved")); })}>{t("settings.resetThr")}</button>}>
          <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">{t("thr.disclaimer")}</div>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">{t("gas.gas")}</th><th className="th">{t("gas.unit")}</th>{(["warn_high", "crit_high", "warn_low", "crit_low"] as const).map((k) => <th key={k} className="th">{t(`thr.${k}`)}</th>)}<th className="th" /></tr></thead><tbody>
            {GAS_KEYS.map((g) => <tr key={g}><td className="td font-medium">{GAS_INFO[g].formula} <span className="text-mute">{t(`gas.${g}`)}</span></td><td className="td">{GAS_INFO[g].unit}</td>
              {(["warn_high", "crit_high", "warn_low", "crit_low"] as const).map((k) => <td key={k} className="td">{th[g][k] === null || th[g][k] === undefined ? <span className="text-mute">—</span> : <input className="input w-24 !py-1" type="number" step="any" defaultValue={th[g][k]!} key={`${g}${k}${th[g][k]}`} onChange={(e) => setDraft((d) => ({ ...d, [`${g}.${k}`]: e.target.value }))} />}</td>)}
              <td className="td"><button className="btn btn-primary !py-1" onClick={() => save(g)}>{t("common.save")}</button></td></tr>)}
          </tbody></table></div>
        </Card>
        <Card className="xl:col-span-2" title={t("settings.about")}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-mute"><li>{t("about.1")}</li><li>{t("about.2")}</li><li>{t("about.3")}</li><li>{t("about.4")}</li><li>{t("about.5")}</li></ul>
        </Card>
      </div>
    </div>
  );
}
