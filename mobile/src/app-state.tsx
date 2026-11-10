// src/app-state.tsx: app-wide React context — server URL and terminal (persisted in AsyncStorage),
// UI locale (device language by default, EN/ES toggle persisted), light/dark palette from the
// system scheme, the API client, the in-memory back-office session token and this phone's charge token
// per server and terminal (persisted: it only opens and cancels that stall's sales, for 7 days).
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
import { DEFAULT_STALL, isStallId } from "./lib/stalls";
import { detectLocale, type Key, type Locale, translate } from "./lib/i18n";
import { normalizeBaseUrl } from "./lib/nfc-url";
import { DARK, LIGHT, type Palette } from "./lib/theme";

export const DEFAULT_SERVER_URL =
  normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? "") ?? "https://paygent-rirl.onrender.com";
export const DEFAULT_TERMINAL = "rosa-01";

const KEYS = {
  server: "paygent.server",
  terminal: "paygent.terminal",
  locale: "paygent.locale",
  stall: "paygent.stall",
  devices: "paygent.devices",
};

interface AppState {
  ready: boolean;
  serverUrl: string;
  terminal: string;
  locale: Locale;
  colors: Palette;
  dark: boolean;
  api: Api;
  token?: string;
  /** The paygent (stall) the back office acts on; sessions are kept per stall. */
  stall: string;
  tokens: Readonly<Record<string, string | undefined>>;
  /** Switches stall (and, when given, the cashier terminal); its own session, if any, is kept. */
  setStall: (stall: string, terminal?: string) => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
  setServer: (url: string, terminal: string) => Promise<void>;
  toggleLocale: () => void;
  setToken: (token: string | undefined) => void;
  /** Charge token for the current server + terminal, from unlocking with the stall PIN. */
  deviceToken?: string;
  setDeviceToken: (token: string | undefined) => void;
}

const Ctx = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [terminal, setTerminal] = useState(DEFAULT_TERMINAL);
  const [locale, setLocale] = useState<Locale>(() => detectLocale(getLocales()[0]?.languageTag));
  const [stall, setStallState] = useState(DEFAULT_STALL);
  const [tokens, setTokens] = useState<Record<string, string | undefined>>({});
  const token = tokens[stall];
  const [devices, setDevices] = useState<Record<string, string>>({});
  const setToken = useCallback(
    (next: string | undefined) => setTokens((m) => ({ ...m, [stall]: next })),
    [stall],
  );
  const setStall = useCallback((id: string, term?: string) => {
    if (!isStallId(id)) return;
    setStallState(id);
    if (term) setTerminal(term);
    AsyncStorage.multiSet([[KEYS.stall, id], ...(term ? [[KEYS.terminal, term] as [string, string]] : [])]).catch(
      () => undefined,
    );
  }, []);

  const deviceKey = `${serverUrl}#${terminal}`;
  const deviceToken = devices[deviceKey];
  const setDeviceToken = useCallback(
    (next: string | undefined) =>
      setDevices((m) => {
        const { [deviceKey]: _old, ...rest } = m;
        const updated = next ? { ...rest, [deviceKey]: next } : rest;
        AsyncStorage.setItem(KEYS.devices, JSON.stringify(updated)).catch(() => undefined);
        return updated;
      }),
    [deviceKey],
  );

  useEffect(() => {
    AsyncStorage.getItem(KEYS.devices)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        if (parsed && typeof parsed === "object")
          setDevices(
            Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as Record<
              string,
              string
            >,
          );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([KEYS.server, KEYS.terminal, KEYS.locale, KEYS.stall])
      .then((pairs) => {
        const m = new Map(pairs);
        const url = normalizeBaseUrl(m.get(KEYS.server) ?? "");
        if (url) setServerUrl(url);
        const term = m.get(KEYS.terminal);
        if (term) setTerminal(term);
        const saved = m.get(KEYS.locale);
        if (saved === "en" || saved === "es") setLocale(saved);
        const st = m.get(KEYS.stall);
        if (st && isStallId(st)) setStallState(st);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const setServer = useCallback(async (url: string, term: string) => {
    setServerUrl(url);
    setTerminal(term);
    setTokens({});
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
      api: createApi(serverUrl, token, stall, deviceToken),
      token,
      t: (key, params) => translate(locale, key, params),
      setServer,
      toggleLocale,
      setToken,
      stall,
      tokens,
      setStall,
      deviceToken,
      setDeviceToken,
    };
  }, [
    ready,
    serverUrl,
    terminal,
    locale,
    scheme,
    token,
    tokens,
    stall,
    setStall,
    setToken,
    setServer,
    toggleLocale,
    deviceToken,
    setDeviceToken,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
