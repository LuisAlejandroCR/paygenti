// test/rails.test.ts: pluggable payment rails — registry hides unconfigured rails, Pix/SPEI data,
// the core invariant (a push rail never becomes "paid" without the provider), PIN confirm, labels,
// and the ledger/passport treating vendor-confirmed sales as not verified.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { buildPassport } from "../server/passport";
import { MockPayPal } from "../server/paypal/mock";
import { SalesService } from "../server/sales";
import { MemoryStore } from "../server/store";
import { money } from "../shared/money";
import {
  buildRailRegistry,
  crc16,
  isValidClabe,
  pixBrCode,
  railsForSale,
  saleStatusLabel,
} from "../shared/rails";
import type { Sale } from "../shared/types";

const CLABE = "002010077777777771"; // valid check digit (Banxico example)
const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("rail registry", () => {
  it("hides every rail when nothing is configured", () => {
    expect(buildRailRegistry({}).enabled()).toEqual([]);
  });

  it("enables only configured rails and ignores invalid config", () => {
    const reg = buildRailRegistry({
      PIX_KEY: "rosa@example.com",
      SPEI_CLABE: "123",
      RAIL_APPLE_PAY: "1",
      RAIL_GOOGLE_PAY: "0",
    });
    expect(reg.enabled().map((r) => r.id)).toEqual(["applepay", "pix"]);
  });

  it("offers a rail only for its currency and limits", () => {
    const reg = buildRailRegistry({
      PIX_KEY: "k",
      SPEI_CLABE: CLABE,
      BREB_KEY: "@rosa",
      RAIL_OXXO: "1",
      RAIL_APPLE_PAY: "1",
    });
    const ids = (minor: number, cur: "MXN" | "BRL" | "COP") =>
      // COP is not a PayPal currency (no COP sales today); cast to exercise the filter.
      railsForSale(reg, money(minor, cur as "MXN")).map((r) => r.id);
    expect(ids(9500, "MXN")).toEqual(["applepay", "oxxo", "spei"]);
    expect(ids(1_000_001, "MXN")).toEqual(["applepay", "spei"]);
    expect(ids(500, "BRL")).toEqual(["applepay", "pix"]);
    expect(ids(500, "COP")).toEqual(["applepay", "breb"]);
  });
});

describe("payment data", () => {
  it("builds a Pix BR Code with a valid CRC16", () => {
    const code = pixBrCode(
      { key: "rosa@example.com", name: "Rosa", city: "Sao Paulo" },
      money(1050, "BRL"),
      "abc-123",
    );
    expect(code.startsWith("000201")).toBe(true);
    expect(code).toContain("br.gov.bcb.pix");
    expect(code).toContain("540510.50");
    const body = code.slice(0, -4);
    expect(code.slice(-4)).toBe(crc16(body));
  });

  it("CRC16 matches the CCITT-FALSE check value", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("validates CLABE check digits", () => {
    expect(isValidClabe(CLABE)).toBe(true);
    expect(isValidClabe("002010077777777770")).toBe(false);
  });
});

describe("labels", () => {
  it("names pending and vendor-confirmed sales plainly", () => {
    expect(saleStatusLabel("pending_bank")).toBe("pending — check your bank app");
    expect(saleStatusLabel("vendor_confirmed")).toBe("vendor-confirmed, not verified");
    expect(saleStatusLabel("paid")).toBe("paid");
  });
});

function setup(env: Record<string, string> = { SPEI_CLABE: CLABE }) {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const paypal = new MockPayPal();
  const sales = new SalesService({ store: new MemoryStore(), paypal, clock: () => now });
  const app = createApp({ paypal, sales, rails: buildRailRegistry(env), vendorPin: "4321" });
  const create = async () => {
    const res = await app.request("/api/terminals/rosa-01/sales", json({ amount: 9500 }));
    return ((await res.json()) as { sale: Sale }).sale;
  };
  return { app, sales, paypal, create };
}

describe("push rails over HTTP", () => {
  it("lists only configured rails for the sale", async () => {
    const { app, create } = setup();
    const sale = await create();
    const res = await app.request(`/api/sales/${sale.id}/rails`);
    const body = (await res.json()) as { rails: { id: string }[] };
    expect(body.rails.map((r) => r.id)).toEqual(["spei"]);
    const none = setup({});
    const s2 = await none.create();
    const b2 = (await (await none.app.request(`/api/sales/${s2.id}/rails`)).json()) as {
      rails: unknown[];
    };
    expect(b2.rails).toEqual([]);
  });

  it("refuses an unconfigured rail", async () => {
    const { app, create } = setup();
    const sale = await create();
    const res = await app.request(`/api/sales/${sale.id}/rail`, json({ rail: "pix" }));
    expect(res.status).toBe(400);
  });

  it("SPEI shows payment data and stays pending, never paid by itself", async () => {
    const { app, sales, create } = setup();
    const sale = await create();
    const res = await app.request(`/api/sales/${sale.id}/rail`, json({ rail: "spei" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sale: Sale; payment: { text: string; label: string } };
    expect(body.sale.status).toBe("pending_bank");
    expect(body.sale.method).toBe("spei");
    expect(body.payment.text).toContain(CLABE);
    expect(body.payment.label).toBe("pending — check your bank app");
    // Customer-side capture cannot mark it paid: there is no approved PayPal order.
    const cap = await app.request(`/api/sales/${sale.id}/capture`, { method: "POST" });
    expect(cap.status).toBe(409);
    expect(sales.getSale(sale.id)?.status).toBe("pending_bank");
    const qr = await app.request(`/api/sales/${sale.id}/rail-qr.svg`);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("vendor PIN confirm marks vendor_confirmed, never paid", async () => {
    const { app, sales, create } = setup();
    const sale = await create();
    await app.request(`/api/sales/${sale.id}/rail`, json({ rail: "spei" }));
    const wrong = await app.request(`/api/sales/${sale.id}/vendor-confirm`, json({ pin: "0000" }));
    expect(wrong.status).toBe(401);
    expect(sales.getSale(sale.id)?.status).toBe("pending_bank");
    const ok = await app.request(`/api/sales/${sale.id}/vendor-confirm`, json({ pin: "4321" }));
    expect(ok.status).toBe(200);
    const s = sales.getSale(sale.id);
    expect(s?.status).toBe("vendor_confirmed");
    expect(s?.status).not.toBe("paid");
    expect(s?.captureId).toBeUndefined();
  });

  it("refuses vendor confirm on a PayPal sale", async () => {
    const { app, create } = setup();
    const sale = await create();
    const res = await app.request(`/api/sales/${sale.id}/vendor-confirm`, json({ pin: "4321" }));
    expect(res.status).toBe(409);
  });

  it("switching back to PayPal still requires PayPal's capture to be paid", async () => {
    const { app, paypal, sales, create } = setup();
    const sale = await create();
    await app.request(`/api/sales/${sale.id}/rail`, json({ rail: "spei" }));
    const back = await app.request(`/api/sales/${sale.id}/rail`, json({ rail: "paypal" }));
    expect(((await back.json()) as { sale: Sale }).sale.status).toBe("open");
    paypal.approve(sale.orderId);
    const paid = await sales.capture(sale.id);
    expect(paid.status).toBe("paid");
    expect(paid.method).toBe("paypal");
    expect(paid.captureId).toBeDefined();
  });

  it("ledger counts vendor-confirmed apart from verified money", async () => {
    const { app, create } = setup();
    const sale = await create();
    await app.request(`/api/sales/${sale.id}/rail`, json({ rail: "spei" }));
    await app.request(`/api/sales/${sale.id}/vendor-confirm`, json({ pin: "4321" }));
    const login = await app.request("/api/backoffice/session", json({ pin: "4321" }));
    const { token } = (await login.json()) as { token: string };
    const res = await app.request("/api/backoffice/ledger?date=2026-10-06", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ledger = (await res.json()) as {
      rows: { reconciliation: string; paid: { minor: number } }[];
      totals: { paid: { minor: number }; unverified: { minor: number }; net: { minor: number } };
    };
    expect(ledger.rows[0]?.reconciliation).toBe("vendor_confirmed");
    expect(ledger.rows[0]?.paid.minor).toBe(0);
    expect(ledger.totals.paid.minor).toBe(0);
    expect(ledger.totals.net.minor).toBe(0);
    expect(ledger.totals.unverified.minor).toBe(9500);
  });
});

describe("passport", () => {
  it("keeps vendor-confirmed sales out of verified totals", () => {
    const report = buildPassport({
      vendor: { id: "rosa", name: "Rosa" },
      currency: "MXN",
      timeZone: "America/Mexico_City",
      from: "2026-10-01",
      to: "2026-10-31",
      issuedAt: "2026-10-07T00:00:00Z",
      demoKey: true,
      sales: [
        { day: "2026-10-06", method: "paypal", captured: true, total: 1000, refunded: 0 },
        {
          day: "2026-10-06",
          method: "spei",
          captured: false,
          vendorConfirmed: true,
          total: 9500,
          refunded: 0,
        },
      ],
    });
    expect(report.verified.gross).toBe(1000);
    expect(report.selfReported.vendorConfirmed).toEqual({
      label: "vendor-confirmed, not verified",
      amount: 9500,
      count: 1,
    });
  });
});
