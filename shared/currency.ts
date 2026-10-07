// shared/currency.ts: currency metadata (symbol, minor-unit exponent, PayPal support) and the
// country table used by onboarding (LATAM first) to pick a vendor's default charge currency.
// Source: https://developer.paypal.com/reference/currency-codes/ (read 2026-10-06).

/** Currencies PayPal REST can charge in (Orders v2 / Invoicing). */
export const PAYPAL_CURRENCIES = [
  "MXN",
  "BRL",
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "AUD",
  "NZD",
  "JPY",
  "HKD",
  "SGD",
  "TWD",
  "THB",
  "PHP",
  "MYR",
  "CNY",
  "ILS",
] as const;

export type Currency = (typeof PAYPAL_CURRENCIES)[number];

export interface CurrencyInfo {
  code: string;
  symbol: string;
  /** Minor-unit exponent PayPal accepts: 2 for MXN (95.00), 0 for JPY/HUF/TWD. */
  decimals: number;
  paypal: boolean;
  /** PayPal: usable only by PayPal accounts registered in this country (BRL, CNY, MYR). */
  inCountryOnly?: string;
}

const C = (
  code: string,
  symbol: string,
  decimals: number,
  paypal: boolean,
  inCountryOnly?: string,
): CurrencyInfo => ({ code, symbol, decimals, paypal, ...(inCountryOnly && { inCountryOnly }) });

export const CURRENCIES: Readonly<Record<string, CurrencyInfo>> = Object.freeze(
  Object.fromEntries(
    [
      C("MXN", "$", 2, true),
      C("BRL", "R$", 2, true, "BR"),
      C("USD", "$", 2, true),
      C("CAD", "$", 2, true),
      C("EUR", "€", 2, true),
      C("GBP", "£", 2, true),
      C("CHF", "CHF ", 2, true),
      C("SEK", "kr ", 2, true),
      C("NOK", "kr ", 2, true),
      C("DKK", "kr ", 2, true),
      C("PLN", "zł ", 2, true),
      C("CZK", "Kč ", 2, true),
      C("HUF", "Ft ", 0, true),
      C("AUD", "$", 2, true),
      C("NZD", "$", 2, true),
      C("JPY", "¥", 0, true),
      C("HKD", "$", 2, true),
      C("SGD", "$", 2, true),
      C("TWD", "$", 0, true),
      C("THB", "฿", 2, true),
      C("PHP", "₱", 2, true),
      C("MYR", "RM ", 2, true, "MY"),
      C("CNY", "¥", 2, true, "CN"),
      C("ILS", "₪", 2, true),
      // Local currencies PayPal cannot charge in: vendors there charge in USD (or EUR).
      C("COP", "$", 2, false),
      C("ARS", "$", 2, false),
      C("CLP", "$", 0, false),
      C("PEN", "S/ ", 2, false),
      C("GTQ", "Q", 2, false),
      C("CRC", "₡", 2, false),
      C("PAB", "B/. ", 2, false),
      C("DOP", "$", 2, false),
      C("UYU", "$", 2, false),
      C("BOB", "Bs ", 2, false),
      C("PYG", "₲", 0, false),
      C("HNL", "L ", 2, false),
      C("NIO", "C$", 2, false),
      C("INR", "₹", 2, false),
    ].map((c) => [c.code, c]),
  ),
);

export function isPayPalCurrency(code: unknown): code is Currency {
  return typeof code === "string" && (PAYPAL_CURRENCIES as readonly string[]).includes(code);
}

export function currencyInfo(code: string): CurrencyInfo {
  const info = CURRENCIES[code];
  if (!info) throw new Error(`currency: unknown ${code}`);
  return info;
}

export function decimalsOf(code: Currency): number {
  return currencyInfo(code).decimals;
}

export type Region = "latam" | "na" | "europe" | "other";

export interface Country {
  code: string;
  name: { en: string; es: string };
  region: Region;
  /** Local currency (may not be PayPal-chargeable). */
  local: string;
  /** What the vendor charges in by default: local if PayPal supports it, else USD (EUR in the eurozone). */
  charge: Currency;
  /** Primary IANA zone; defines "today" for ledgers and daily caps. */
  timeZone: string;
}

const K = (
  code: string,
  en: string,
  es: string,
  region: Region,
  local: string,
  timeZone: string,
): Country => {
  const info = currencyInfo(local);
  const chargeable = info.paypal && (!info.inCountryOnly || info.inCountryOnly === code);
  return {
    code,
    name: { en, es },
    region,
    local,
    charge: chargeable ? (local as Currency) : "USD",
    timeZone,
  };
};

/** LATAM first (the target market), then North America, Europe, others. */
export const COUNTRIES: readonly Country[] = Object.freeze([
  K("MX", "Mexico", "México", "latam", "MXN", "America/Mexico_City"),
  K("CO", "Colombia", "Colombia", "latam", "COP", "America/Bogota"),
  K("AR", "Argentina", "Argentina", "latam", "ARS", "America/Argentina/Buenos_Aires"),
  K("CL", "Chile", "Chile", "latam", "CLP", "America/Santiago"),
  K("PE", "Peru", "Perú", "latam", "PEN", "America/Lima"),
  K("BR", "Brazil", "Brasil", "latam", "BRL", "America/Sao_Paulo"),
  K("GT", "Guatemala", "Guatemala", "latam", "GTQ", "America/Guatemala"),
  K("CR", "Costa Rica", "Costa Rica", "latam", "CRC", "America/Costa_Rica"),
  K("PA", "Panama", "Panamá", "latam", "PAB", "America/Panama"),
  K("DO", "Dominican Republic", "República Dominicana", "latam", "DOP", "America/Santo_Domingo"),
  K("EC", "Ecuador", "Ecuador", "latam", "USD", "America/Guayaquil"),
  K("UY", "Uruguay", "Uruguay", "latam", "UYU", "America/Montevideo"),
  K("BO", "Bolivia", "Bolivia", "latam", "BOB", "America/La_Paz"),
  K("PY", "Paraguay", "Paraguay", "latam", "PYG", "America/Asuncion"),
  K("SV", "El Salvador", "El Salvador", "latam", "USD", "America/El_Salvador"),
  K("HN", "Honduras", "Honduras", "latam", "HNL", "America/Tegucigalpa"),
  K("NI", "Nicaragua", "Nicaragua", "latam", "NIO", "America/Managua"),
  K("PR", "Puerto Rico", "Puerto Rico", "latam", "USD", "America/Puerto_Rico"),
  K("US", "United States", "Estados Unidos", "na", "USD", "America/New_York"),
  K("CA", "Canada", "Canadá", "na", "CAD", "America/Toronto"),
  K("ES", "Spain", "España", "europe", "EUR", "Europe/Madrid"),
  K("PT", "Portugal", "Portugal", "europe", "EUR", "Europe/Lisbon"),
  K("FR", "France", "Francia", "europe", "EUR", "Europe/Paris"),
  K("DE", "Germany", "Alemania", "europe", "EUR", "Europe/Berlin"),
  K("IT", "Italy", "Italia", "europe", "EUR", "Europe/Rome"),
  K("NL", "Netherlands", "Países Bajos", "europe", "EUR", "Europe/Amsterdam"),
  K("IE", "Ireland", "Irlanda", "europe", "EUR", "Europe/Dublin"),
  K("GB", "United Kingdom", "Reino Unido", "europe", "GBP", "Europe/London"),
  K("CH", "Switzerland", "Suiza", "europe", "CHF", "Europe/Zurich"),
  K("SE", "Sweden", "Suecia", "europe", "SEK", "Europe/Stockholm"),
  K("PL", "Poland", "Polonia", "europe", "PLN", "Europe/Warsaw"),
  K("HU", "Hungary", "Hungría", "europe", "HUF", "Europe/Budapest"),
  K("AU", "Australia", "Australia", "other", "AUD", "Australia/Sydney"),
  K("JP", "Japan", "Japón", "other", "JPY", "Asia/Tokyo"),
  K("PH", "Philippines", "Filipinas", "other", "PHP", "Asia/Manila"),
  K("IN", "India", "India", "other", "INR", "Asia/Kolkata"),
]);

export function findCountry(code: string | undefined): Country | undefined {
  const up = code?.toUpperCase();
  return COUNTRIES.find((c) => c.code === up);
}

/** Region of a BCP-47 tag ("es-CO" -> CO, "pt-BR" -> BR); undefined when absent or unknown. */
export function countryFromLocale(tag: string | undefined | null): Country | undefined {
  if (!tag) return undefined;
  try {
    const region = new Intl.Locale(tag).maximize().region;
    // maximize() guesses a region for bare "es" (ES) / "en" (US); only trust an explicit one.
    if (!/[-_][A-Za-z]{2}\b/.test(tag)) return undefined;
    return findCountry(region);
  } catch {
    return undefined;
  }
}

/** Currencies a vendor in `country` may pick: PayPal-supported, minus other countries' in-country-only ones. */
export function chargeableCurrencies(country: string): Currency[] {
  return PAYPAL_CURRENCIES.filter((c) => {
    const only = CURRENCIES[c]?.inCountryOnly;
    return !only || only === country.toUpperCase();
  });
}
