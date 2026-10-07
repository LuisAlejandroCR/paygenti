// prefs.tsx: per-device preferences (language, dark mode, large text, privacy) and the t()/money()
// formatters every component uses; stored in localStorage when available.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LOCALES, translate, type Lang, type TKey } from "./i18n";
import type { Currency } from "./types";

interface Prefs {
  privacy: boolean;
  dark: boolean;
  large: boolean;
  lang: Lang;
}
const DEFAULT: Prefs = { privacy: false, dark: false, large: false, lang: "es" };
const KEY = "paygent-prefs";

interface Ctx extends Prefs {
  set: (p: Partial<Prefs>) => void;
  t: (k: TKey, v?: Record<string, string | number>) => string;
  money: (n: number, c: Currency, opts?: { compact?: boolean }) => string;
  locale: string;
}
const PrefsCtx = createContext<Ctx | null>(null);

export const PREFIX: Record<string, string> = { MXN: "MX$", BRL: "R$", USD: "US$" };

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Prefs>(DEFAULT);
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setP({ ...DEFAULT, ...JSON.parse(s) });
    } catch {
      /* storage blocked: keep defaults */
    }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", p.dark);
    document.documentElement.classList.toggle("large-text", p.large);
    document.documentElement.lang = LOCALES[p.lang];
  }, [p]);
  const set = useCallback((u: Partial<Prefs>) => {
    setP((prev) => {
      const next = { ...prev, ...u };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const locale = LOCALES[p.lang];
  const t = useCallback(
    (k: TKey, v?: Record<string, string | number>) => translate(p.lang, k, v),
    [p.lang],
  );
  const money = useCallback(
    (n: number, c: Currency, opts?: { compact?: boolean }) => {
      if (p.privacy) return `${PREFIX[c] ?? `${c} `} •••••`;
      const f = new Intl.NumberFormat(locale, {
        minimumFractionDigits: opts?.compact ? 0 : 2,
        maximumFractionDigits: opts?.compact ? 0 : 2,
      }).format(n);
      return `${PREFIX[c] ?? `${c} `}${f}`;
    },
    [p.privacy, locale],
  );
  return <PrefsCtx.Provider value={{ ...p, set, t, money, locale }}>{children}</PrefsCtx.Provider>;
}

export function usePrefs() {
  const c = useContext(PrefsCtx);
  if (!c) throw new Error("PrefsProvider missing");
  return c;
}

export function haptic() {
  if (
    typeof navigator !== "undefined" &&
    "vibrate" in navigator &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    navigator.vibrate?.(10);
}
