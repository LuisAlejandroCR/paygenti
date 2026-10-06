// shared/money.ts: money as integer minor units (cents/centavos) plus an ISO currency code.
// Floats never touch money; PayPal's decimal strings are produced and parsed only here.

export type Currency = "MXN" | "USD";

export interface Money {
  /** Integer minor units: 9500 = 95.00 */
  minor: number;
  currency: Currency;
}

export function money(minor: number, currency: Currency): Money {
  if (!Number.isSafeInteger(minor))
    throw new Error(`money: minor units must be an integer, got ${minor}`);
  return { minor, currency };
}

/** 9500 -> "95.00" (the format PayPal's `value` fields expect). */
export function toPayPalValue(m: Money): string {
  const sign = m.minor < 0 ? "-" : "";
  const abs = Math.abs(m.minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "95.00" -> 9500. Rejects anything that is not a plain decimal with at most 2 places. */
export function fromPayPalValue(value: string, currency: Currency): Money {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`money: invalid PayPal value "${value}"`);
  const [, neg, units, cents = "0"] = match;
  const minor = Number(units) * 100 + Number(cents.padEnd(2, "0"));
  return money(neg ? -minor : minor, currency);
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency)
    throw new Error(`money: cannot add ${a.currency} and ${b.currency}`);
  return money(a.minor + b.minor, a.currency);
}

/** Spoken/visible form, e.g. "$95.00 MXN". */
export function formatMoney(m: Money): string {
  return `$${toPayPalValue(m)} ${m.currency}`;
}
