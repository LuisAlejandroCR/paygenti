// test/wallets.test.ts: Apple Pay / Google Pay helpers — which wallets a sale may show, browser
// feature detection (hidden on any doubt), the payment requests built from the sale, and when a
// confirmed wallet order goes to capture. Plus the Apple Pay domain-association route.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import {
  applePayRequest,
  canUseApplePay,
  googlePayEnvironment,
  googleTransactionInfo,
  shouldCaptureAfterConfirm,
  walletCandidates,
} from "../shared/wallets";

describe("walletCandidates", () => {
  it("keeps only configured wallets, Apple Pay first", () => {
    expect(walletCandidates(["pix", "googlepay", "oxxo", "applepay"])).toEqual([
      "applepay",
      "googlepay",
    ]);
    expect(walletCandidates(["pix"])).toEqual([]);
  });
});

describe("canUseApplePay", () => {
  it("is false without ApplePaySession", () => expect(canUseApplePay({})).toBe(false));
  it("follows canMakePayments", () => {
    expect(canUseApplePay({ ApplePaySession: { canMakePayments: () => true } })).toBe(true);
    expect(canUseApplePay({ ApplePaySession: { canMakePayments: () => false } })).toBe(false);
  });
  it("is false when canMakePayments throws (insecure context)", () => {
    const ApplePaySession = {
      canMakePayments: (): boolean => {
        throw new Error("InvalidAccessError");
      },
    };
    expect(canUseApplePay({ ApplePaySession })).toBe(false);
  });
});

describe("payment requests", () => {
  const sale = { currency: "USD", amount: "12.50", countryCode: "US", label: "Rosa" };
  it("Apple Pay: PayPal config plus the sale's exact total", () => {
    const req = applePayRequest({ merchantCapabilities: ["supports3DS"] }, sale);
    expect(req).toMatchObject({
      merchantCapabilities: ["supports3DS"],
      countryCode: "US",
      currencyCode: "USD",
      total: { label: "Rosa", amount: "12.50", type: "final" },
    });
  });
  it("Google Pay: final total in the sale's currency", () => {
    expect(googleTransactionInfo(sale)).toEqual({
      countryCode: "US",
      currencyCode: "USD",
      totalPriceStatus: "FINAL",
      totalPrice: "12.50",
      totalPriceLabel: "Total",
    });
  });
  it("Google Pay environment follows the PayPal env", () => {
    expect(googlePayEnvironment("sandbox")).toBe("TEST");
    expect(googlePayEnvironment("live")).toBe("PRODUCTION");
  });
  it("captures unless PayPal still needs the payer (3DS)", () => {
    expect(shouldCaptureAfterConfirm("APPROVED")).toBe(true);
    expect(shouldCaptureAfterConfirm(undefined)).toBe(true);
    expect(shouldCaptureAfterConfirm("PAYER_ACTION_REQUIRED")).toBe(false);
  });
});

describe("Apple Pay domain association", () => {
  const path = "/.well-known/apple-developer-merchantid-domain-association";
  it("404 when not configured", async () => {
    const res = await createApp({ paypal: new MockPayPal() }).request(path);
    expect(res.status).toBe(404);
  });
  it("serves the configured content as plain text", async () => {
    const app = createApp({ paypal: new MockPayPal(), applePayDomainAssociation: "abc123" });
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("abc123");
  });
});
