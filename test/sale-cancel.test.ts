// test/sale-cancel.test.ts: vendor cancel of an open sale — POST /api/sales/:id/cancel emits
// sale.cancelled, /t/:terminal stops redirecting, and cancel vs capture races are refused both ways.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { SalesService } from "../server/sales";
import { MemoryStore } from "../server/store";
import type { Sale, TerminalEvent } from "../shared/types";

const post = (body?: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

function setup(paypal = new MockPayPal()) {
  const sales = new SalesService({ store: new MemoryStore(), paypal });
  const app = createApp({ paypal, sales });
  const events: TerminalEvent[] = [];
  sales.subscribe("rosa-01", (e) => events.push(e));
  const create = async () => {
    const res = await app.request("/api/terminals/rosa-01/sales", post({ amount: 4200 }));
    return ((await res.json()) as { sale: Sale }).sale;
  };
  const cancel = (id: string) => app.request(`/api/sales/${id}/cancel`, post());
  const capture = (id: string) => app.request(`/api/sales/${id}/capture`, post());
  return { app, paypal, sales, events, create, cancel, capture };
}

describe("cancel a sale", () => {
  it("cancels an open sale, emits sale.cancelled and frees the sticker", async () => {
    const t = setup();
    const sale = await t.create();
    const res = await t.cancel(sale.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sale: Sale }).sale.status).toBe("cancelled");
    expect(t.events.map((e) => e.type)).toEqual(["sale.open", "sale.cancelled"]);

    const sticker = await t.app.request("/t/rosa-01");
    expect(sticker.status).toBe(200);
    expect(await sticker.text()).toContain("There is no open sale");
    const terminal = await t.app.request("/api/terminals/rosa-01");
    expect(((await terminal.json()) as { openSale: Sale | null }).openSale).toBeNull();
    // Idempotent: a second cancel returns the same cancelled sale without a second event.
    expect((await t.cancel(sale.id)).status).toBe(200);
    expect(t.events).toHaveLength(2);
  });

  it("refuses a capture after cancel, even if the payer approved", async () => {
    const t = setup();
    const sale = await t.create();
    t.paypal.approve(sale.orderId);
    await t.cancel(sale.id);
    const res = await t.capture(sale.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "SALE_CANCELLED" });
    expect((await t.paypal.getOrder(sale.orderId)).status).toBe("APPROVED");
  });

  it("refuses cancel after capture", async () => {
    const t = setup();
    const sale = await t.create();
    t.paypal.approve(sale.orderId);
    expect((await t.capture(sale.id)).status).toBe(200);
    const res = await t.cancel(sale.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "SALE_ALREADY_PAID" });
    expect(t.sales.getSale(sale.id)?.status).toBe("paid");
  });

  it("refuses cancel while a capture is in flight; the capture wins", async () => {
    let release: () => void = () => {};
    class SlowPayPal extends MockPayPal {
      override async captureOrder(orderId: string, key: string) {
        await new Promise<void>((r) => {
          release = r;
        });
        return super.captureOrder(orderId, key);
      }
    }
    const t = setup(new SlowPayPal());
    const sale = await t.create();
    t.paypal.approve(sale.orderId);
    const capturing = t.capture(sale.id);
    await new Promise((r) => setTimeout(r, 0));
    const res = await t.cancel(sale.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CAPTURE_IN_PROGRESS" });
    release();
    expect(((await (await capturing).json()) as { sale: Sale }).sale.status).toBe("paid");
  });

  it("refuses to cancel an expired or unknown sale", async () => {
    const t = setup();
    expect((await t.cancel("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const first = await t.create();
    await t.create(); // expires the first one
    const res = await t.cancel(first.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "SALE_NOT_OPEN" });
  });
});
