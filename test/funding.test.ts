// test/funding.test.ts: checkout funding sources by sale currency — Venmo only for USD, Pay Later
// only in its markets' currencies (never MXN), render order PayPal > Venmo > Pay Later > card,
// the SDK eligibility filter on top, and the sandbox-only test buyer country.
import { describe, expect, it } from "vitest";
import { PAYPAL_CURRENCIES } from "../shared/currency";
import {
  FUNDING_ORDER,
  type FundingSource,
  fundingCandidates,
  sandboxBuyerCountry,
  selectFundingSources,
} from "../shared/funding";

describe("fundingCandidates", () => {
  it("offers every method for USD, in render order", () => {
    expect(fundingCandidates("USD")).toEqual(["paypal", "venmo", "paylater", "card"]);
  });

  it("offers PayPal and card but neither Venmo nor Pay Later for MXN", () => {
    const mxn = fundingCandidates("MXN");
    expect(mxn).toEqual(["paypal", "card"]);
    expect(mxn).not.toContain("venmo");
    expect(mxn).not.toContain("paylater");
  });

  it("offers Pay Later without Venmo in the other Pay Later currencies", () => {
    for (const c of ["EUR", "GBP", "CAD", "AUD"])
      expect(fundingCandidates(c), c).toEqual(["paypal", "paylater", "card"]);
  });

  it("keeps Venmo to USD for every PayPal currency", () => {
    for (const c of PAYPAL_CURRENCIES)
      expect(fundingCandidates(c).includes("venmo"), c).toBe(c === "USD");
  });

  it("always starts with PayPal and keeps FUNDING_ORDER", () => {
    for (const c of PAYPAL_CURRENCIES) {
      const list = fundingCandidates(c);
      expect(list[0], c).toBe("paypal");
      const idx = list.map((s) => FUNDING_ORDER.indexOf(s));
      expect(idx, c).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it("offers nothing for a currency PayPal cannot charge or junk", () => {
    expect(fundingCandidates("COP")).toEqual([]);
    expect(fundingCandidates("")).toEqual([]);
    expect(fundingCandidates("usd")).toEqual([]);
  });
});

describe("selectFundingSources", () => {
  const only =
    (...yes: FundingSource[]) =>
    (s: FundingSource) =>
      yes.includes(s);

  it("keeps candidates the SDK reports eligible, in render order", () => {
    expect(selectFundingSources("USD", only("card", "venmo", "paypal"))).toEqual([
      "paypal",
      "venmo",
      "card",
    ]);
  });

  it("never shows Venmo or Pay Later for MXN even if the SDK said yes", () => {
    const all = () => true;
    expect(selectFundingSources("MXN", all)).toEqual(["paypal", "card"]);
  });

  it("treats a throwing or non-boolean eligibility answer as not eligible", () => {
    const boom = (s: FundingSource) => {
      if (s === "venmo") throw new Error("unknown method");
      return s === "paypal";
    };
    expect(selectFundingSources("USD", boom)).toEqual(["paypal"]);
    const truthy = (() => "yes") as unknown as (s: FundingSource) => boolean;
    expect(selectFundingSources("USD", truthy)).toEqual([]);
  });
});

describe("sandboxBuyerCountry", () => {
  it("maps a sale currency to a stand-in buyer country", () => {
    expect(sandboxBuyerCountry("USD")).toBe("US");
    expect(sandboxBuyerCountry("MXN")).toBe("MX");
    expect(sandboxBuyerCountry("EUR")).toBe("ES");
    expect(sandboxBuyerCountry("JPY")).toBeUndefined();
  });

  it("lets a valid two-letter override win and ignores junk", () => {
    expect(sandboxBuyerCountry("MXN", "us")).toBe("US");
    expect(sandboxBuyerCountry("USD", "USA")).toBe("US");
    expect(sandboxBuyerCountry("USD", "<x>")).toBe("US");
    expect(sandboxBuyerCountry("JPY", null)).toBeUndefined();
  });
});
