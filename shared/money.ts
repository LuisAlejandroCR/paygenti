// shared/money.ts: money as integer minor units plus an ISO currency code, honouring each currency's
// minor-unit exponent (MXN 2, JPY 0). Floats never touch money; PayPal's decimal strings are
// produced and parsed only here.
import { type Currency, currencyInfo, decimalsOf } from "./currency";

export type { Currency } from "./currency";

export interface Money {
  /** Integer minor units: 9500 MXN = 95.00; 950 JPY = 950. */
  minor: number;
  currency: Currency;
}

export function money(minor: number, currency: Currency): Money {
  if (!Number.isSafeInteger(minor))
    throw new Error(`money: minor units must be an integer, got ${minor}`);
  return { minor, currency };
}

/** 9500 MXN -> "95.00", 950 JPY -> "950" (the format PayPal's `value` fields expect). */
export function toPayPalValue(m: Money): string {
  const d = decimalsOf(m.currency);
  const sign = m.minor < 0 ? "-" : "";
  const abs = Math.abs(m.minor);
  if (d === 0) return `${sign}${abs}`;
  const base = 10 ** d;
  return `${sign}${Math.trunc(abs / base)}.${String(abs % base).padStart(d, "0")}`;
}

/** "95.00" -> 9500. Rejects anything that is not a plain decimal with at most `decimals` places. */
export function fromPayPalValue(value: string, currency: Currency): Money {
  const d = decimalsOf(currency);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`money: invalid PayPal value "${value}"`);
  const [, neg, units, frac = ""] = match;
  if (frac.length > d) throw new Error(`money: too many decimals for ${currency}: "${value}"`);
  const minor = Number(units) * 10 ** d + Number(frac.padEnd(d, "0") || "0");
  return money(neg ? -minor : minor, currency);
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency)
    throw new Error(`money: cannot add ${a.currency} and ${b.currency}`);
  return money(a.minor + b.minor, a.currency);
}

/** Visible form with the code once, e.g. "$95.00 MXN", "€9.50 EUR", "¥950 JPY". */
export function formatMoney(m: Money): string {
  const v = toPayPalValue(m);
  const sign = v.startsWith("-") ? "-" : "";
  return `${sign}${currencyInfo(m.currency).symbol}${v.replace(/^-/, "")} ${m.currency}`;
}

/** Re-tags an amount to another currency keeping its face value (25.00 MXN -> 25.00 USD, 25 JPY). No FX. */
export function retag(m: Money, currency: Currency): Money {
  const diff = decimalsOf(currency) - decimalsOf(m.currency);
  const minor = diff >= 0 ? m.minor * 10 ** diff : Math.trunc(m.minor / 10 ** -diff);
  return money(minor, currency);
}

/** What a person types ("95", "95.5", "$95,50") -> minor units; undefined if unparseable or too precise. */
export function parseAmount(
  text: string,
  currency: Currency,
  maxUnitDigits = 9,
): number | undefined {
  const m = /^\s*\$?\s*(\d+)(?:[.,](\d+))?\s*$/.exec(text);
  if (!m || (m[1] ?? "").length > maxUnitDigits) return undefined;
  try {
    return fromPayPalValue(m[2] ? `${m[1]}.${m[2]}` : (m[1] ?? ""), currency).minor;
  } catch {
    return undefined;
  }
}
