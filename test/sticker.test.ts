// test/sticker.test.ts: the four branches of the NFC/QR sticker route /t/:terminal —
// open sale (302), no sale, last sale paid and last sale expired — plus /api/config publicUrl.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { SALE_TTL_MS, SalesService } from "../server/sales";
import { MemoryStore } from "../server/store";

const ES = { "Accept-Language": "es-MX,es;q=0.9,en;q=0.5" };

function setup() {
  let now = Date.parse("2026-10-06T12:00:00Z");
  const paypal = new MockPayPal();
  const sales = new SalesService({ store: new MemoryStore(), paypal, clock: () => now });
  const app = createApp({ paypal, sales, publicUrl: "https://paygent.example/" });
  return { app, paypal, sales, advance: (ms: number) => (now += ms) };
}

describe("/t/:terminal", () => {
  it("redirects to the open sale", async () => {
    const t = setup();
    const sale = await t.sales.createSale("rosa-01", { amount: 5000 });
    const res = await t.app.request("/t/rosa-01", { headers: ES });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/pay/${sale.id}`);
  });

  it("says there is no sale when the terminal has none", async () => {
    const res = await setup().app.request("/t/rosa-01", { headers: ES });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No hay una venta abierta");
  });

  it("confirms when the last sale was paid", async () => {
    const t = setup();
    const sale = await t.sales.createSale("rosa-01", { amount: 5000 });
    t.paypal.approve(sale.orderId);
    expect((await t.sales.capture(sale.id)).status).toBe("paid");
    const res = await t.app.request("/t/rosa-01", { headers: ES });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ya quedó registrado");
  });

  it("explains when the last sale expired", async () => {
    const t = setup();
    await t.sales.createSale("rosa-01", { amount: 5000 });
    t.advance(SALE_TTL_MS + 1);
    const res = await t.app.request("/t/rosa-01", { headers: ES });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ya no está disponible");
  });

  it("returns 404 for an unknown terminal", async () => {
    expect((await setup().app.request("/t/nope")).status).toBe(404);
  });
});

describe("/api/config", () => {
  it("exposes the public URL for the sticker", async () => {
    const res = await setup().app.request("/api/config");
    expect(((await res.json()) as { publicUrl: string }).publicUrl).toBe("https://paygent.example");
  });
});
