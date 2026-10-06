// test/health.test.ts: the health route reports which PayPal gateway is active.
import { expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";

it("GET /api/health reports mock mode", async () => {
  const res = await createApp({ paypal: new MockPayPal() }).request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, paypal: "mock" });
});
