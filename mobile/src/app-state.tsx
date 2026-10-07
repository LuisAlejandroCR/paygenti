// src/app-state.tsx: app-wide React context — server URL and terminal (persisted in AsyncStorage),
// UI locale (device language by default, EN/ES toggle persisted), light/dark palette from the
// system scheme, the API client and the in-memory back-office session token.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { type Api, createApi } from "./lib/api";
import { detectLocale, type Key, type Locale, translate } from "./lib/i18n";
import { normalizeBaseUrl } from "./lib/nfc-url";
import { DARK, LIGHT, type Palette } from "./lib/theme";

export const DEFAULT_SERVER_URL =
  normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? "") ?? "https://paygent-rirl.onrender.com";
export const DEFAULT_TERMINAL = "rosa-01";

const KEYS = { server: "paygent.server", terminal: "paygent.terminal", locale: "paygent.locale" };

interface AppState {
  ready: boolean;
  serverUrl: string;
  terminal: string;
  locale: Locale;
  colors: Palette;
  dark: boolean;
  api: Api;
  token?: string;
  t: (key: Key, params?: Record<string, string | number>) => string;
  setServer: (url: string, terminal: string) => Promise<void>;
  toggleLocale: () => void;
  setToken: (token: string | undefined) => void;
}

const Ctx = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [terminal, setTerminal] = useState(DEFAULT_TERMINAL);
  const [locale, setLocale] = useState<Locale>(() => detectLocale(getLocales()[0]?.languageTag));
  const [token, setToken] = useState<string>();

  useEffect(() => {
    AsyncStorage.multiGet([KEYS.server, KEYS.terminal, KEYS.locale])
      .then((pairs) => {
        const m = new Map(pairs);
        const url = normalizeBaseUrl(m.get(KEYS.server) ?? "");
        if (url) setServerUrl(url);
        const term = m.get(KEYS.terminal);
        if (term) setTerminal(term);
        const saved = m.get(KEYS.locale);
        if (saved === "en" || saved === "es") setLocale(saved);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const setServer = useCallback(async (url: string, term: string) => {
    setServerUrl(url);
    setTerminal(term);
    setToken(undefined);
    await AsyncStorage.multiSet([
      [KEYS.server, url],
      [KEYS.terminal, term],
    ]).catch(() => undefined);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale((l) => {
      const next = l === "es" ? "en" : "es";
      AsyncStorage.setItem(KEYS.locale, next).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo<AppState>(() => {
    const dark = scheme === "dark";
    return {
      ready,
      serverUrl,
      terminal,
      locale,
      dark,
      colors: dark ? DARK : LIGHT,
      api: createApi(serverUrl, token),
      token,
      t: (key, params) => translate(locale, key, params),
      setServer,
      toggleLocale,
      setToken,
    };
  }, [ready, serverUrl, terminal, locale, scheme, token, setServer, toggleLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
