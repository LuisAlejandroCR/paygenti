// shared/funding.ts: which payment methods the customer checkout may offer for a sale's currency
// (PayPal, Venmo, Pay Later, card, in that render order) before PayPal's per-buyer eligibility
// check (SDK v6 findEligibleMethods) narrows the list. Pure, so it is unit-tested in Node.
// Sources (read 2026-10-07): https://developer.paypal.com/venmo , /pay-later/overview (docs/memoria.md).
import { isPayPalCurrency } from "./currency";

/** Render order on the checkout. The strings are the SDK v6 `isEligible()` method names. */
export const FUNDING_ORDER = ["paypal", "venmo", "paylater", "card"] as const;
export type FundingSource = (typeof FUNDING_ORDER)[number];

/** Venmo: "US-based merchants and US-based consumers only", "Payment must be in USD". */
export const VENMO_CURRENCIES: readonly string[] = ["USD"];

/** Pay Later markets: buyer country -> the currency the purchase must be in. No MXN market. */
export const PAY_LATER_MARKETS: Readonly<Record<string, string>> = Object.freeze({
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  AU: "AUD",
});

const PAY_LATER_CURRENCIES = new Set(Object.values(PAY_LATER_MARKETS));

/** Methods a sale in `currency` may show at all, in render order; [] if PayPal cannot charge it. */
export function fundingCandidates(currency: string): FundingSource[] {
  if (!isPayPalCurrency(currency)) return [];
  return FUNDING_ORDER.filter((source) => {
    if (source === "venmo") return VENMO_CURRENCIES.includes(currency);
    if (source === "paylater") return PAY_LATER_CURRENCIES.has(currency);
    return true;
  });
}

/** Candidates the SDK also reports eligible for this buyer, still in render order. */
export function selectFundingSources(
  currency: string,
  isEligible: (source: FundingSource) => boolean,
): FundingSource[] {
  return fundingCandidates(currency).filter((source) => {
    try {
      return isEligible(source) === true;
    } catch {
      return false;
    }
  });
}

/**
 * PayPal's published sandbox test Visa, shown on the sandbox checkout so a judge can pay as a guest
 * (no buyer login). Source (read 2026-11-12): https://developer.paypal.com/tools/sandbox/card-testing/
 * It only works against the sandbox; it is not a credential.
 */
export const SANDBOX_TEST_VISA = "4012888888881881";

/** Sandbox stand-in buyer per currency, so a USD sale is tested as a US buyer would see it. */
const SANDBOX_BUYER: Readonly<Record<string, string>> = Object.freeze({
  USD: "US",
  MXN: "MX",
  CAD: "CA",
  GBP: "GB",
  EUR: "ES",
  AUD: "AU",
});

/**
 * SDK v6 `testBuyerCountry` (sandbox only, never sent in production): an explicit two-letter
 * override (`/pay/:id?buyerCountry=US`) wins; otherwise the stand-in buyer for the currency.
 */
export function sandboxBuyerCountry(
  currency: string,
  override?: string | null,
): string | undefined {
  const code = override?.trim().toUpperCase();
  if (code && /^[A-Z]{2}$/.test(code)) return code;
  return SANDBOX_BUYER[currency];
}
