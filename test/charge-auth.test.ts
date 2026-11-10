// test/charge-auth.test.ts: creating, cancelling and extending a sale need the stall's device token
// (POST /api/terminals/:id/unlock with its PIN) or a live back-office session of that same stall.
// A customer, a stranger or another stall's token gets 401; capture and checkout stay public.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { DeviceTokens } from "../server/device-token";
import { MockPayPal } from "../server/paypal/mock";
import type { Sale } from "../shared/types";

const json = { "Content-Type": "application/json" };

function setup(now = () => Date.now()) {
  const paypal = new MockPayPal();
  const deviceTokens = new DeviceTokens({ now, secret: "x".repeat(32) });
  const app = createApp({ paypal, vendorPin: "4321", deviceTokens, clock: now });
  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: "POST",
      headers: { ...json, ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    });
  const unlock = async (terminal: string, pin: string) => {
    const res = await post(`/api/terminals/${terminal}/unlock`, { pin });
    return { status: res.status, data: (await res.json()) as { token?: string; error?: string } };
  };
  return { app, paypal, post, unlock };
}

describe("charge auth", () => {
  it("refuses to open a charge without a token", async () => {
    const { post } = setup();
    const res = await post("/api/terminals/rosa-01/sales", { amount: 9500 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "CHARGE_AUTH_REQUIRED" });
  });

  it("unlock with the stall PIN gives a token that opens, extends and cancels", async () => {
    const { post, unlock } = setup();
    expect((await unlock("rosa-01", "0000")).status).toBe(401);
    const { status, data } = await unlock("rosa-01", "4321");
    expect(status).toBe(200);
    expect(data.token).toMatch(/^pgd\.rosa\./);
    const created = await post("/api/terminals/rosa-01/sales", { amount: 9500 }, data.token);
    expect(created.status).toBe(201);
    const { sale } = (await created.json()) as { sale: Sale };
    expect((await post(`/api/sales/${sale.id}/extend`, {})).status).toBe(401);
    expect((await post(`/api/sales/${sale.id}/cancel`, {})).status).toBe(401);
    expect((await post(`/api/sales/${sale.id}/extend`, {}, data.token)).status).toBe(200);
    expect((await post(`/api/sales/${sale.id}/cancel`, {}, data.token)).status).toBe(200);
  });

  it("one stall's token never charges or cancels for another stall", async () => {
    const { post, unlock } = setup();
    const beto = (await unlock("beto-01", "5678")).data.token;
    const rosa = (await unlock("rosa-01", "4321")).data.token;
    expect((await post("/api/terminals/rosa-01/sales", { amount: 100 }, beto)).status).toBe(401);
    const created = await post("/api/terminals/rosa-01/sales", { amount: 100 }, rosa);
    const { sale } = (await created.json()) as { sale: Sale };
    expect((await post(`/api/sales/${sale.id}/cancel`, {}, beto)).status).toBe(401);
  });

  it("a live back-office session of the stall also charges (phone app, dashboard)", async () => {
    const { post } = setup();
    const session = await post("/api/backoffice/session", { pin: "4321" });
    const { token } = (await session.json()) as { token: string };
    expect((await post("/api/terminals/rosa-01/sales", { amount: 100 }, token)).status).toBe(201);
  });

  it("the customer still pays without any token", async () => {
    const { post, unlock, paypal } = setup();
    const token = (await unlock("rosa-01", "4321")).data.token;
    const created = await post("/api/terminals/rosa-01/sales", { amount: 100 }, token);
    const { sale } = (await created.json()) as { sale: Sale };
    paypal.approve(sale.orderId);
    const cap = await post(`/api/sales/${sale.id}/capture`, {});
    expect(cap.status).toBe(200);
    expect(((await cap.json()) as { sale: Sale }).sale.status).toBe("paid");
  });

  it("forged, tampered and expired tokens are refused", async () => {
    let t = 1_000_000;
    const { post, unlock } = setup(() => t);
    const token = (await unlock("rosa-01", "4321")).data.token ?? "";
    const [p, s, exp, sig] = token.split(".");
    const later = `${p}.${s}.${Number(exp) + 1}.${sig}`;
    const other = new DeviceTokens({ secret: "y".repeat(32), now: () => t }).issue("rosa").token;
    for (const bad of [later, other, "pgd.rosa.9999999999999.AAAA", `${token}x`])
      expect((await post("/api/terminals/rosa-01/sales", { amount: 100 }, bad)).status).toBe(401);
    t += 8 * 24 * 60 * 60 * 1000;
    expect((await post("/api/terminals/rosa-01/sales", { amount: 100 }, token)).status).toBe(401);
  });

  it("unlock shares the PIN lockout", async () => {
    const { unlock } = setup();
    for (let i = 0; i < 4; i++) expect((await unlock("rosa-01", "0000")).status).toBe(401);
    expect((await unlock("rosa-01", "0000")).status).toBe(429);
    expect((await unlock("rosa-01", "4321")).status).toBe(429);
  });

  it("rejects a short secret", () => {
    expect(() => new DeviceTokens({ secret: "short" })).toThrow(/32 characters/);
  });
});
