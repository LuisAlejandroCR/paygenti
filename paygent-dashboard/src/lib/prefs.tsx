// prefs.tsx: per-device preferences (language, dark mode, large text, privacy) and the t()/money()
// formatters every component uses; stored in localStorage when available. The language also syncs
// with the landing (same domain, key "paygent.locale"): read on a first visit, written on es/en change.
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
/** The landing's language key (web/src/landing.ts); both apps live on paygenti.vercel.app. */
export const SHARED_LOCALE_KEY = "paygent.locale";

/** First visit (no saved prefs): the landing's choice, else the browser language, else Spanish. */
export function initialLang(): Lang {
  try {
    const shared = localStorage.getItem(SHARED_LOCALE_KEY);
    if (shared === "es" || shared === "en") return shared;
  } catch {
    /* storage blocked */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "").toLowerCase();
  if (nav.startsWith("en")) return "en";
  if (nav.startsWith("pt")) return "pt";
  return "es";
}

interface Ctx extends Prefs {
  set: (p: Partial<Prefs>) => void;
  t: (k: TKey, v?: Record<string, string | number>) => string;
  money: (n: number, c: Currency, opts?: { compact?: boolean }) => string;
  locale: string;
}
const PrefsCtx = createContext<Ctx | null>(null);

export const PREFIX: Record<string, string> = { MXN: "MX$", BRL: "R$", USD: "US$" };

/** "−MX$170.00", not "MX$-170.00": the sign goes before the currency prefix. */
export function formatMoney(
  n: number,
  c: Currency,
  locale: string,
  opts?: { compact?: boolean; privacy?: boolean },
) {
  const prefix = PREFIX[c] ?? `${c} `;
  if (opts?.privacy) return `${prefix} •••••`;
  const digits = opts?.compact ? 0 : 2;
  const f = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(n));
  const negative = n < 0 && f.replace(/[^1-9]/g, "") !== "";
  return `${negative ? "−" : ""}${prefix}${f}`;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Prefs>(DEFAULT);
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      setP(s ? { ...DEFAULT, ...JSON.parse(s) } : { ...DEFAULT, lang: initialLang() });
    } catch {
      setP({ ...DEFAULT, lang: initialLang() });
    }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", p.dark);
    document.documentElement.classList.toggle("large-text", p.large);
    document.documentElement.lang = LOCALES[p.lang];
    document.title = translate(p.lang, "page_title");
  }, [p]);
  const set = useCallback((u: Partial<Prefs>) => {
    setP((prev) => {
      const next = { ...prev, ...u };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
        // pt stays dashboard-only: the landing has es and en.
        if (u.lang === "es" || u.lang === "en") localStorage.setItem(SHARED_LOCALE_KEY, u.lang);
      } catch {
        /* storage blocked: the choice lasts for this tab */
      }
      return next;
    });
  }, []);
  const locale = LOCALES[p.lang];
  const t = useCallback(
    (k: TKey, v?: Record<string, string | number>) => translate(p.lang, k, v),
    [p.lang],
  );
  const money = useCallback(
    (n: number, c: Currency, opts?: { compact?: boolean }) =>
      formatMoney(n, c, locale, { ...opts, privacy: p.privacy }),
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
