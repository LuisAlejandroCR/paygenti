// web/src/onboarding.tsx: first-run / settings screen — stall name, country (auto-detected from the
// browser locale, searchable, LATAM first) and charge currency (pre-selected from the country; an
// unsupported local currency is explained). Saves with PUT /api/backoffice/vendor (vendor session).
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  COUNTRIES,
  type Country,
  chargeableCurrencies,
  countryFromLocale,
  currencyInfo,
  findCountry,
  type Region,
} from "../../shared/currency";
import type { Currency } from "../../shared/money";
import type { Vendor } from "../../shared/types";
import { type Key, useT } from "./i18n";
import { LangToggle } from "./lang-toggle";

/** Same key as backoffice.tsx: a back-office session also unlocks this screen. */
const TOKEN_KEY = "paygent.bo.token";
const REGIONS: readonly Region[] = ["latam", "na", "europe", "other"];

function storedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the PIN is asked again next time.
  }
}

/** Browser region, e.g. "es-CO" -> Colombia; undefined for a bare language like "en". */
export function detectCountry(langs: readonly string[] = []): Country | undefined {
  for (const tag of langs) {
    const c = countryFromLocale(tag);
    if (c) return c;
  }
  try {
    return countryFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return undefined;
  }
}

export function Onboarding({
  terminal,
  firstRun = false,
  onDone,
}: {
  terminal: string;
  firstRun?: boolean;
  onDone?: (vendor: Vendor) => void;
}) {
  const { t, locale } = useT();
  const [vendor, setVendor] = useState<Vendor>();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("MX");
  const [currency, setCurrency] = useState<Currency>("MXN");
  const [search, setSearch] = useState("");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState<string | null>(storedToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/terminals/${terminal}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("terminal"))))
      .then((d: { vendor: Vendor }) => {
        setVendor(d.vendor);
        setName(d.vendor.displayName);
        const langs = typeof navigator === "undefined" ? [] : (navigator.languages ?? []);
        const detected =
          firstRun || !d.vendor.country ? detectCountry(langs) : findCountry(d.vendor.country);
        const c = detected ?? findCountry(d.vendor.country) ?? findCountry("MX");
        if (c) setCountry(c.code);
        setCurrency(
          !firstRun && d.vendor.country === c?.code ? d.vendor.currency : (c?.charge ?? "MXN"),
        );
      })
      .catch(() => setError(t("vendor.terminalNotFound")));
  }, [terminal]);

  const picked = findCountry(country);
  const local = picked ? currencyInfo(picked.local) : undefined;
  const localUnsupported = !!picked && picked.charge !== picked.local;
  const options = chargeableCurrencies(country);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    return COUNTRIES.filter(
      (c) =>
        !q ||
        c.code.toLowerCase() === q ||
        plain(c.name.en).includes(q) ||
        plain(c.name.es).includes(q) ||
        c.code === country,
    );
  }, [search, country]);

  function pickCountry(code: string) {
    const c = findCountry(code);
    if (!c) return;
    setCountry(c.code);
    setCurrency(c.charge);
    setSaved(false);
  }

  async function save(e: Event) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      let session = token;
      if (!session) {
        const res = await fetch("/api/backoffice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
        if (!res.ok || !data.token)
          return setError(t(data.error === "PIN_LOCKED" ? "bo.pinLocked" : "bo.pinWrong"));
        session = data.token;
        setToken(session);
        storeToken(session);
        setPin("");
      }
      const res = await fetch("/api/backoffice/vendor", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
        body: JSON.stringify({ displayName: name.trim(), country, currency }),
      });
      if (res.status === 401) {
        setToken(null);
        storeToken(null);
        return setError(t("bo.sessionRequired"));
      }
      if (!res.ok) return setError(t("onb.saveFailed"));
      const { vendor: updated } = (await res.json()) as { vendor: Vendor };
      setVendor(updated);
      setSaved(true);
      onDone?.(updated);
    } catch {
      setError(t("bo.offline"));
    } finally {
      setBusy(false);
    }
  }

  const willReprice = !!vendor && vendor.currency !== currency && vendor.catalog.length > 0;
  const countryName = (c: Country) => c.name[locale];

  return (
    <main class="backoffice onboarding">
      <header class="bar">
        <h1 class="stall">{firstRun ? t("onb.welcome") : t("onb.title")}</h1>
        <nav class="bar-actions">
          <LangToggle />
        </nav>
      </header>
      <form class="panel" onSubmit={save}>
        {firstRun && <p class="hint">{t("onb.intro")}</p>}
        <label>
          {t("onb.name")}
          <input
            value={name}
            maxLength={60}
            required
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("onb.searchCountry")}
          <input
            type="search"
            value={search}
            placeholder={t("onb.searchPlaceholder")}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("onb.country")}
          <select value={country} onChange={(e) => pickCountry(e.currentTarget.value)}>
            {REGIONS.map((r) => {
              const list = visible.filter((c) => c.region === r);
              return list.length ? (
                <optgroup key={r} label={t(`onb.region.${r}` as Key)}>
                  {list.map((c) => (
                    <option key={c.code} value={c.code}>
                      {countryName(c)}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label>
          {t("onb.currency")}
          <select
            value={currency}
            onChange={(e) => {
              setCurrency(e.currentTarget.value as Currency);
              setSaved(false);
            }}
          >
            {options.map((c) => (
              <option key={c} value={c}>
                {c} ({currencyInfo(c).symbol.trim()})
              </option>
            ))}
          </select>
        </label>
        {localUnsupported && picked && local && (
          <p class="hint onb-explain" role="note">
            {t("onb.unsupported", {
              local: picked.local,
              country: countryName(picked),
              charge: picked.charge,
            })}
          </p>
        )}
        {willReprice && (
          <p class="hint onb-reprice" role="note">
            {t("onb.reprice", { from: vendor?.currency ?? "", to: currency })}
          </p>
        )}
        <p class="hint onb-crypto">{t("onb.crypto")}</p>
        {!token && (
          <label>
            {t("bo.pin")}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onInput={(e) => setPin(e.currentTarget.value)}
            />
          </label>
        )}
        <button
          type="submit"
          class="primary"
          disabled={busy || !name.trim() || (!token && pin.length < 4)}
        >
          {busy ? t("onb.saving") : t("onb.save")}
        </button>
        {saved && (
          <p class="hint" role="status">
            {t("onb.saved", { currency })}
          </p>
        )}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </form>
      {!firstRun && <a href={`/?terminal=${encodeURIComponent(terminal)}`}>{t("onb.back")}</a>}
    </main>
  );
}
