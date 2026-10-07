// shared/wallets.ts: pure helpers for the Apple Pay / Google Pay buttons on the checkout — which
// configured wallets a sale may show, Apple Pay feature detection, the payment requests built from
// the sale's total, and when a PayPal-confirmed wallet order may go to capture. Unit-tested in Node.
// API shapes from paypal-examples/v6-web-sdk-sample-integration (read 2026-10-07, docs/memoria.md).

export const WALLET_ORDER = ["applepay", "googlepay"] as const;
export type WalletId = (typeof WALLET_ORDER)[number];

/** Wallets among the sale's configured rails (RAIL_APPLE_PAY / RAIL_GOOGLE_PAY), in render order. */
export function walletCandidates(railIds: readonly string[]): WalletId[] {
  return WALLET_ORDER.filter((w) => railIds.includes(w));
}

/** Apple Pay JS is present and this device can pay; any exception (insecure context) means no. */
export function canUseApplePay(win: { ApplePaySession?: { canMakePayments(): boolean } }): boolean {
  try {
    return win.ApplePaySession?.canMakePayments() === true;
  } catch {
    return false;
  }
}

export interface WalletSale {
  currency: string;
  /** PayPal decimal string; must equal the server-created order's amount. */
  amount: string;
  countryCode: string;
  label: string;
}

/** ApplePayPaymentRequest: PayPal's formatted config plus the sale total. */
export function applePayRequest(formatted: object, s: WalletSale) {
  return {
    ...formatted,
    countryCode: s.countryCode,
    currencyCode: s.currency,
    requiredBillingContactFields: ["postalAddress"],
    requiredShippingContactFields: [],
    total: { label: s.label, amount: s.amount, type: "final" as const },
  };
}

/** Google Pay TransactionInfo for the sale. */
export function googleTransactionInfo(s: WalletSale) {
  return {
    countryCode: s.countryCode,
    currencyCode: s.currency,
    totalPriceStatus: "FINAL" as const,
    totalPrice: s.amount,
    totalPriceLabel: "Total",
  };
}

export function googlePayEnvironment(env: "sandbox" | "live"): "TEST" | "PRODUCTION" {
  return env === "live" ? "PRODUCTION" : "TEST";
}

/** After confirmOrder: PAYER_ACTION_REQUIRED (3DS pending) must not be captured yet. */
export function shouldCaptureAfterConfirm(status: string | undefined): boolean {
  return status !== "PAYER_ACTION_REQUIRED";
}
