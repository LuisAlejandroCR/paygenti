// test/currency.test.ts: currency table and country defaults, decimals-aware money formatting and
// parsing, policy caps per currency, the onboarding API (PUT /api/backoffice/vendor) and a sale
// created in USD for a Colombian vendor.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { vendorBody } from "../server/backoffice/routes";
import { MockPayPal } from "../server/paypal/mock";
import { DEFAULT_POLICY_CONFIG, decide, PolicyEngine, policyCapsFor } from "../server/policy";
import {
  COUNTRIES,
  chargeableCurrencies,
  countryFromLocale,
  currencyInfo,
  findCountry,
  PAYPAL_CURRENCIES,
} from "../shared/currency";
import {
  formatMoney,
  fromPayPalValue,
  money,
  parseAmount,
  retag,
  toPayPalValue,
} from "../shared/money";
import { paidAnnouncement } from "../web/src/announce";

describe("currency table", () => {
  it("lists LATAM first and maps every country to a chargeable default", () => {
    expect(COUNTRIES.slice(0, 2).map((c) => c.code)).toEqual(["MX", "CO"]);
    const firstNonLatam = COUNTRIES.findIndex((c) => c.region !== "latam");
    expect(COUNTRIES.slice(firstNonLatam).every((c) => c.region !== "latam")).toBe(true);
    for (const c of COUNTRIES) expect(PAYPAL_CURRENCIES).toContain(c.charge);
  });

  it("charges locally only where PayPal supports the local currency", () => {
    expect(findCountry("MX")?.charge).toBe("MXN");
    expect(findCountry("BR")?.charge).toBe("BRL");
    for (const code of ["CO", "AR", "CL", "PE", "GT", "UY"]) {
      const c = findCountry(code);
      expect(currencyInfo(c?.local ?? "").paypal).toBe(false);
      expect(c?.charge).toBe("USD");
    }
    expect(findCountry("ES")?.charge).toBe("EUR");
    expect(findCountry("JP")?.charge).toBe("JPY");
  });

  it("keeps in-country-only currencies to their country", () => {
    expect(chargeableCurrencies("BR")).toContain("BRL");
    expect(chargeableCurrencies("CO")).not.toContain("BRL");
    expect(chargeableCurrencies("CO")).toContain("USD");
  });

  it("detects the country from an explicit locale region only", () => {
    expect(countryFromLocale("es-CO")?.code).toBe("CO");
    expect(countryFromLocale("pt-BR")?.code).toBe("BR");
    expect(countryFromLocale("en")).toBeUndefined();
    expect(countryFromLocale("zz-QQ")).toBeUndefined();
  });

  it("knows zero-decimal currencies", () => {
    for (const c of ["JPY", "HUF", "TWD"]) expect(currencyInfo(c).decimals).toBe(0);
    expect(currencyInfo("MXN").decimals).toBe(2);
  });
});

describe("money with decimals", () => {
  it("formats zero-decimal currencies without .00", () => {
    expect(toPayPalValue(money(950, "JPY"))).toBe("950");
    expect(formatMoney(money(950, "JPY"))).toBe("¥950 JPY");
    expect(formatMoney(money(950, "EUR"))).toBe("€9.50 EUR");
    expect(formatMoney(money(-1234, "USD"))).toBe("-$12.34 USD");
  });

  it("parses PayPal values per currency, rejecting extra precision", () => {
    expect(fromPayPalValue("950", "JPY").minor).toBe(950);
    expect(() => fromPayPalValue("9.5", "JPY")).toThrow();
    expect(fromPayPalValue("9.5", "EUR").minor).toBe(950);
    expect(() => fromPayPalValue("9.555", "EUR")).toThrow();
  });

  it("parses typed amounts and re-tags without FX", () => {
    expect(parseAmount("$95,5", "MXN")).toBe(9550);
    expect(parseAmount("1200", "HUF")).toBe(1200);
    expect(parseAmount("12.5", "HUF")).toBeUndefined();
    expect(retag(money(2500, "MXN"), "USD")).toEqual(money(2500, "USD"));
    expect(retag(money(2500, "MXN"), "JPY")).toEqual(money(25, "JPY"));
    expect(retag(money(25, "JPY"), "EUR")).toEqual(money(2500, "EUR"));
  });

  it("announces the localized currency word", () => {
    expect(paidAnnouncement(money(9500, "MXN"), "es")).toBe("Recibido: 95 pesos");
    expect(paidAnnouncement(money(1000, "USD"), "es")).toBe("Recibido: 10 dólares");
    expect(paidAnnouncement(money(1050, "EUR"), "en")).toBe("Received: 10 euros and 50 cents");
    expect(paidAnnouncement(money(2000, "BRL"), "es")).toBe("Recibido: 20 reales");
    expect(paidAnnouncement(money(500, "JPY"), "en")).toBe("Received: 500 yen");
  });
});

describe("policy caps per currency", () => {
  it("keeps the MXN defaults and defines tighter USD/EUR caps", () => {
    expect(policyCapsFor("MXN").maxRefund).toEqual(DEFAULT_POLICY_CONFIG.maxRefund);
    expect(policyCapsFor("MXN").maxRefundPerDay).toEqual(DEFAULT_POLICY_CONFIG.maxRefundPerDay);
    expect(policyCapsFor("USD").maxRefund).toEqual(money(1000, "USD"));
    expect(policyCapsFor("EUR").maxRefundPerDay).toEqual(money(5000, "EUR"));
    expect(policyCapsFor("JPY").maxRefund).toEqual(money(1500, "JPY"));
  });

  it("denies a USD refund over the USD cap and a currency mismatch", () => {
    const config = { ...DEFAULT_POLICY_CONFIG, ...policyCapsFor("USD") };
    const now = new Date("2026-10-06T18:00:00Z");
    const base = {
      kind: "refund" as const,
      saleId: "s",
      captureId: "c",
      capturedAt: now.toISOString(),
      capturedAmount: money(5000, "USD"),
      alreadyRefunded: money(0, "USD"),
    };
    const ctx = {
      actor: "vendor" as const,
      pinVerified: true,
      now,
      refundedToday: money(0, "USD"),
      paidOutToday: money(0, "USD"),
      config,
      vendorName: "Ana",
    };
    expect(decide({ ...base, amount: money(1000, "USD") }, ctx).allow).toBe(true);
    const over = decide({ ...base, amount: money(1001, "USD") }, ctx);
    expect(over.code).toBe("REFUND_OVER_CAP");
    expect(over.reason).toContain("10 dólares");
    expect(decide({ ...base, amount: money(100, "MXN") }, ctx).code).toBe("CURRENCY_MISMATCH");
  });

  it("a currency switch never frees budget already used today", () => {
    const engine = new PolicyEngine({ vendorName: "Ana", pin: "1234" });
    const fresh = new PolicyEngine({ vendorName: "Ana", pin: "1234" });
    fresh.setCurrency("USD", "America/Bogota");
    expect(fresh.totals().refunded).toEqual(money(0, "USD"));
    const now = new Date();
    const d = engine.decide(
      {
        kind: "refund",
        saleId: "s",
        captureId: "c",
        amount: money(100, "MXN"),
        capturedAt: now.toISOString(),
        capturedAmount: money(5000, "MXN"),
        alreadyRefunded: money(0, "MXN"),
      },
      { actor: "vendor", pin: "1234" },
    );
    expect(d.allow).toBe(true);
    engine.setCurrency("USD", "America/Bogota");
    expect(engine.config.maxRefund).toEqual(money(1000, "USD"));
    expect(engine.totals().refunded).toEqual(engine.config.maxRefundPerDay);
    // Back in MXN only the real MXN usage counts (pending tickets still reserve it).
    engine.setCurrency("MXN", "America/Mexico_City");
    expect(engine.totals().refunded).toEqual(money(0, "MXN"));
    if (d.ticket) engine.commit(d.ticket);
    expect(engine.totals().refunded).toEqual(money(100, "MXN"));
    engine.setCurrency("USD", "America/Bogota");
    expect(engine.totals().refunded).toEqual(engine.config.maxRefundPerDay);
  });
});

describe("onboarding API", () => {
  const PIN = "4321";
  async function setup() {
    const paypal = new MockPayPal();
    const app = createApp({ chargeAuth: "off", paypal, vendorPin: PIN });
    const call = async (method: string, path: string, body?: unknown, token?: string) => {
      const res = await app.request(path, {
        method,
        headers: {
          ...(body !== undefined && { "Content-Type": "application/json" }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, data: (await res.json()) as Record<string, unknown> };
    };
    const { data } = await call("POST", "/api/backoffice/session", { pin: PIN });
    return { app, paypal, call, token: data.token as string };
  }

  it("validates the body", () => {
    expect(vendorBody.safeParse({ displayName: "A", country: "CO", currency: "USD" }).success).toBe(
      true,
    );
    expect(vendorBody.safeParse({ displayName: "A", country: "CO", currency: "COP" }).success).toBe(
      false,
    );
    expect(vendorBody.safeParse({ displayName: "A", country: "CO", currency: "BRL" }).success).toBe(
      false,
    );
    expect(vendorBody.safeParse({ displayName: "A", country: "XX", currency: "USD" }).success).toBe(
      false,
    );
    expect(vendorBody.safeParse({ displayName: " ", country: "MX", currency: "MXN" }).success).toBe(
      false,
    );
    expect(
      vendorBody.safeParse({ displayName: "A", country: "MX", currency: "MXN", x: 1 }).success,
    ).toBe(false);
  });

  it("requires a vendor session and rejects bad input", async () => {
    const { call, token } = await setup();
    const body = { displayName: "Ana", country: "CO", currency: "USD" };
    expect((await call("PUT", "/api/backoffice/vendor", body)).status).toBe(401);
    const bad = await call("PUT", "/api/backoffice/vendor", { ...body, currency: "COP" }, token);
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe("INVALID_VENDOR");
  });

  it("a currency switch mid-day never mixes amounts in the day's totals", async () => {
    const { call, token, paypal } = await setup();
    const sell = async (amount: number) => {
      const { data } = await call("POST", "/api/terminals/rosa-01/sales", { amount });
      const sale = data.sale as { id: string; orderId: string };
      paypal.approve(sale.orderId);
      await call("POST", `/api/sales/${sale.id}/capture`);
    };
    await sell(10_000); // 100 MXN
    await call(
      "PUT",
      "/api/backoffice/vendor",
      { displayName: "Rosa", country: "MX", currency: "USD" },
      token,
    );
    await sell(500); // 5 USD
    const today = (await call("GET", "/api/backoffice/sales-today", undefined, token)).data;
    expect(today.total).toEqual(money(500, "USD"));
    expect(today.count).toBe(1);
    expect(today.others).toEqual([
      {
        currency: "MXN",
        count: 1,
        paid: money(10_000, "MXN"),
        refunded: money(0, "MXN"),
        net: money(10_000, "MXN"),
      },
    ]);
    const ledger = (await call("GET", "/api/backoffice/ledger", undefined, token)).data as {
      rows: unknown[];
      totals: { paid: unknown; net: unknown; count: number };
      others: { currency: string; paid: unknown }[];
    };
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.totals.paid).toEqual(money(500, "USD"));
    expect(ledger.totals.net).toEqual(money(500, "USD"));
    expect(ledger.totals.count).toBe(1);
    expect(ledger.others).toMatchObject([{ currency: "MXN", paid: money(10_000, "MXN") }]);
  });

  it("a Colombian vendor charges in USD; the change is audited and caps follow", async () => {
    const { call, token, paypal } = await setup();
    const put = await call(
      "PUT",
      "/api/backoffice/vendor",
      { displayName: "Arepas Ana", country: "CO", currency: "USD" },
      token,
    );
    expect(put.status).toBe(200);
    const vendor = put.data.vendor as {
      currency: string;
      timeZone: string;
      pricesNeedReview: boolean;
      catalog: { price: { minor: number; currency: string } }[];
    };
    expect(vendor.currency).toBe("USD");
    expect(vendor.timeZone).toBe("America/Bogota");
    expect(vendor.pricesNeedReview).toBe(true);
    expect(vendor.catalog[0]?.price).toEqual({ minor: 2500, currency: "USD" });
    expect((put.data.limits as { maxRefund: unknown }).maxRefund).toEqual(money(1000, "USD"));

    const cart = await call("POST", "/api/terminals/rosa-01/sales", {
      lines: [{ sku: "atole", qty: 1 }],
    });
    const cartSale = cart.data.sale as { id: string; total: unknown };
    expect(cartSale.total).toEqual(money(2000, "USD"));
    await call("POST", `/api/sales/${cartSale.id}/cancel`, {});
    const sale = await call("POST", "/api/terminals/rosa-01/sales", { amount: 1250 });
    const s2 = sale.data.sale as { orderId: string; total: unknown };
    expect(s2.total).toEqual(money(1250, "USD"));
    expect((await paypal.getOrder(s2.orderId)).amount).toEqual(money(1250, "USD"));

    const audit = await call("GET", "/api/backoffice/audit", undefined, token);
    const entries = audit.data.entries as { event: string; action: { currency?: string } }[];
    expect(entries.some((e) => e.event === "vendor" && e.action.currency === "USD")).toBe(true);
  });
});
