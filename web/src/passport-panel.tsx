// web/src/passport-panel.tsx: back-office "Sales passport" panel — pick a date range (default last
// 30 days), optionally add self-reported cash, generate the signed passport, then show its summary,
// a QR of the verify link, copy-link and a print-friendly view.

import { useState } from "preact/hooks";
import { isPayPalCurrency } from "../../shared/currency";
import { type Currency, formatMoney, money, parseAmount } from "../../shared/money";
import type { SignedPassport } from "../../shared/passport";
import { useT } from "./i18n";
import { boUrl } from "./stall";
import { PassportFigures } from "./verify";

interface Generated extends SignedPassport {
  verifyUrl: string;
  qr: string | null;
}

export function PassportPanel({
  token,
  onAuthLost,
  currency,
}: {
  token: string;
  onAuthLost: () => void;
  currency: Currency;
}) {
  const { t } = useT();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cash, setCash] = useState("");
  const [result, setResult] = useState<Generated | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate(e: Event) {
    e.preventDefault();
    setError("");
    setCopied(false);
    const cashMinor = cash.trim() ? parseAmount(cash, currency) : undefined;
    if (cash.trim() && cashMinor === undefined) return setError(t("bo.cashFormat"));
    const res = await fetch(boUrl("/passport"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...(from && { from }),
        ...(to && { to }),
        ...(cashMinor !== undefined && { cashMinor }),
      }),
    }).catch(() => undefined);
    if (!res) return setError(t("bo.offline"));
    const data = (await res.json().catch(() => ({}))) as Generated & { error?: string };
    if (!res.ok) {
      if (res.status === 401) onAuthLost();
      return setError(
        data.error === "INVALID_RANGE"
          ? t("passport.badRange")
          : t("bo.error", { code: data.error ?? res.status }),
      );
    }
    setResult(data);
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.verifyUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const cur = isPayPalCurrency(result?.report.currency) ? result.report.currency : currency;
  return (
    <form class="panel passport-panel" id="passport" onSubmit={generate}>
      <h2>{t("passport.title")}</h2>
      <p class="hint">{t("passport.intro")}</p>
      <div class="range">
        <label>
          {t("passport.from")}
          <input type="date" value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
        </label>
        <label>
          {t("passport.to")}
          <input type="date" value={to} onInput={(e) => setTo(e.currentTarget.value)} />
        </label>
      </div>
      <label>
        {t("passport.cashInput")}
        <input inputMode="decimal" value={cash} onInput={(e) => setCash(e.currentTarget.value)} />
      </label>
      <button type="submit" class="primary">
        {t("passport.generate")}
      </button>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div class="passport printable">
          {result.report.demoKey && <p class="hint">{t("passport.demoKey")}</p>}
          <PassportFigures passport={result} money={(minor) => formatMoney(money(minor, cur))} />
          {result.qr && (
            <div class="qr">
              <img src={result.qr} alt={t("passport.qrAlt")} />
            </div>
          )}
          <p class="actions no-print">
            <a href={result.verifyUrl} target="_blank" rel="noreferrer">
              {t("passport.openVerify")}
            </a>
            <button type="button" class="secondary" onClick={() => void copy()}>
              {copied ? t("passport.copied") : t("passport.copy")}
            </button>
            <button type="button" class="secondary" onClick={() => print()}>
              {t("passport.print")}
            </button>
          </p>
        </div>
      )}
    </form>
  );
}
