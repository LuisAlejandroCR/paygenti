// test/sale-extend.test.ts: the "+5 min" accessibility control — POST /api/sales/:id/extend pushes
// expiresAt by five minutes, caps the sale's life at 30 minutes and refuses closed sales.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { SalesService } from "../server/sales";
import { MemoryStore } from "../server/store";
import type { Sale } from "../shared/types";

const post = (body?: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function setup() {
  const paypal = new MockPayPal();
  const sales = new SalesService({ store: new MemoryStore(), paypal });
  const app = createApp({ paypal, sales });
  const res = await app.request("/api/terminals/rosa-01/sales", post({ amount: 4200 }));
  const sale = ((await res.json()) as { sale: Sale }).sale;
  const extend = () => app.request(`/api/sales/${sale.id}/extend`, post());
  return { app, sale, extend };
}

describe("extend a sale", () => {
  it("adds five minutes to an open sale", async () => {
    const t = await setup();
    const res = await t.extend();
    expect(res.status).toBe(200);
    const next = ((await res.json()) as { sale: Sale }).sale;
    expect(Date.parse(next.expiresAt) - Date.parse(t.sale.expiresAt)).toBe(5 * 60 * 1000);
  });

  it("stops at 30 minutes of total life", async () => {
    const t = await setup();
    for (let i = 0; i < 5; i++) expect((await t.extend()).status).toBe(200);
    const res = await t.extend();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("SALE_MAX_LIFE");
  });

  it("refuses a cancelled sale", async () => {
    const t = await setup();
    await t.app.request(`/api/sales/${t.sale.id}/cancel`, post());
    expect((await t.extend()).status).toBe(409);
  });
});
