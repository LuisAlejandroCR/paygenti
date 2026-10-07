// src/lib/money.ts: app-side money helpers built on the repo's shared/money.ts and shared/currency.ts
// (no duplicated money math) — keypad digit entry, typed amount -> Money, and the spoken
// "Received: 95 pesos" sentence in the current locale.
import { decimalsOf } from "@shared/currency";
import { type Currency, fromPayPalValue, type Money } from "@shared/money";
import { type Key, type Locale, translate } from "./i18n";

export { currencyInfo, decimalsOf } from "@shared/currency";
export { type Currency, formatMoney, type Money, money, parseAmount } from "@shared/money";

export const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const;
export type KeypadKey = (typeof KEYS)[number];

/** Applies one keypad press to the typed digits ("12.5" + "0" -> "12.50"), honouring decimals. */
export function press(digits: string, key: string, decimals = 2): string {
  if (key === "⌫") return digits.slice(0, -1);
  if (key === ".") return decimals === 0 || digits.includes(".") ? digits : `${digits || "0"}.`;
  const [units = "", cents] = digits.split(".");
  if (cents !== undefined) return cents.length >= decimals ? digits : digits + key;
  if (units.length >= 6) return digits;
  return units === "0" ? key : digits + key;
}

/** Typed digits -> positive Money, or undefined when empty, zero or malformed. */
export function toMinor(digits: string, currency: Currency): Money | undefined {
  const clean = digits.replace(/\.$/, "");
  if (!clean) return undefined;
  try {
    const m = fromPayPalValue(clean, currency);
    return m.minor > 0 ? m : undefined;
  } catch {
    return undefined;
  }
}

const SPOKEN: Partial<Record<Currency, [Key, Key]>> = {
  MXN: ["money.peso", "money.pesos"],
  USD: ["money.dollar", "money.dollars"],
  CAD: ["money.dollar", "money.dollars"],
  AUD: ["money.dollar", "money.dollars"],
  EUR: ["money.euro", "money.euros"],
  BRL: ["money.real", "money.reais"],
  GBP: ["money.pound", "money.pounds"],
  JPY: ["money.yen", "money.yens"],
};

export function spokenAmount(m: Money, locale: Locale): string {
  const base = 10 ** decimalsOf(m.currency);
  const units = Math.trunc(m.minor / base);
  const cents = m.minor % base;
  const words = SPOKEN[m.currency];
  const unit = words ? translate(locale, words[units === 1 ? 0 : 1]) : m.currency;
  const whole = `${units} ${unit}`;
  return cents ? translate(locale, "money.withCents", { units: whole, cents }) : whole;
}

export function paidAnnouncement(m: Money, locale: Locale): string {
  return translate(locale, "announce.received", { amount: spokenAmount(m, locale) });
}
