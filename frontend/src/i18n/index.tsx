import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { or } from "./or";
import { NAMES } from "./names";

export type Lang = "en" | "hi" | "mr" | "or";
export const LANGS: { code: Lang; native: string; english: string }[] = [
  { code: "en", native: "English", english: "English" },
  { code: "hi", native: "हिन्दी", english: "Hindi" },
  { code: "mr", native: "मराठी", english: "Marathi" },
  { code: "or", native: "ଓଡ଼ିଆ", english: "Odia" },
];
const DICTS: Record<Lang, Record<string, string>> = { en, hi, mr, or };

type Vars = Record<string, string | number | null | undefined>;
interface I18n {
  lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Vars) => string;
  name: (id: string | null | undefined, fallback?: string | null) => string;
  has: (key: string) => boolean;
}
const Ctx = createContext<I18n>(null as unknown as I18n);
export const useI18n = () => useContext(Ctx);

function initial(): Lang {
  try {
    const s = localStorage.getItem("ragmine.lang");
    if (s === "en" || s === "hi" || s === "mr" || s === "or") return s;
  } catch { /* storage unavailable */ }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setL(l);
    try { localStorage.setItem("ragmine.lang", l); } catch { /* ignore */ }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<I18n>(() => {
    const d = DICTS[lang];
    const t = (key: string, vars?: Vars) => {
      let s = d[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v === null || v === undefined ? "—" : String(v));
      return s;
    };
    const name = (id: string | null | undefined, fallback?: string | null) => (id ? NAMES[lang]?.[id] ?? NAMES.en[id] ?? fallback ?? id : fallback ?? "—");
    return { lang, setLang, t, name, has: (k) => k in d || k in en };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
