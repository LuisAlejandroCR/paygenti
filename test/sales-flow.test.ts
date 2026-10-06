// test/sales-flow.test.ts: the Block 1 checkout over HTTP with MockPayPal and a fake clock —
// create -> /t redirect -> approve -> capture -> sale.paid, idempotency, expiry and webhooks.
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import type { WebhookHeaders } from "../server/paypal/gateway";
import { MockPayPal } from "../server/paypal/mock";
import { RestPayPal } from "../server/paypal/rest";
import { SALE_TTL_MS, SalesService } from "../server/sales";
import { MemoryStore } from "../server/store";
import type { Sale, TerminalEvent } from "../shared/types";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const SIG_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-10-06T12:00:00Z",
};

class TrustingPayPal extends MockPayPal {
  override async verifyWebhook(h?: WebhookHeaders): Promise<boolean> {
    return h?.transmissionSig === "sig";
  }
}

function setup(paypal = new MockPayPal()) {
  let now = Date.parse("2026-10-06T12:00:00Z");
  const sales = new SalesService({ store: new MemoryStore(), paypal, clock: () => now });
  const app = createApp({ paypal, sales });
  const events: TerminalEvent[] = [];
  sales.subscribe("rosa-01", (e) => events.push(e));
  const createSale = async (body: unknown = { amount: 9500 }) => {
    const res = await app.request("/api/terminals/rosa-01/sales", json(body));
    expect(res.status).toBe(201);
    return ((await res.json()) as { sale: Sale }).sale;
  };
  return {
    app,
    paypal,
    sales,
    events,
    createSale,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("checkout flow (mock)", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("create -> /t redirect -> approve -> capture -> sale.paid", async () => {
    const sale = await t.createSale({
      lines: [
        { sku: "tamal-mole", qty: 2 },
        { sku: "atole", qty: 2 },
      ],
    });
    expect(sale.total).toEqual({ minor: 9600, currency: "MXN" });
    expect(sale.status).toBe("open");

    const redirect = await t.app.request("/t/rosa-01");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`/pay/${sale.id}`);

    const view = await t.app.request(`/api/sales/${sale.id}`);
    expect(await view.json()).toMatchObject({
      stall: "Rosa — Tamales y atole",
      sale: { id: sale.id },
    });

    const early = await t.app.request(`/api/sales/${sale.id}/capture`, { method: "POST" });
    expect(early.status).toBe(409);

    const approve = await t.app.request(`/api/mock/orders/${sale.orderId}/approve`, json({}));
    expect(approve.status).toBe(200);
    const cap = await t.app.request(`/api/sales/${sale.id}/capture`, { method: "POST" });
    expect(cap.status).toBe(200);
    const paid = ((await cap.json()) as { sale: Sale }).sale;
    expect(paid.status).toBe("paid");
    expect(paid.captureId).toBeTruthy();
    expect(t.events.map((e) => e.type)).toEqual(["sale.open", "sale.paid"]);

    const after = await t.app.request("/t/rosa-01");
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("No hay una venta abierta");
  });

  it("captures only once (sequential and concurrent)", async () => {
    const sale = await t.createSale();
    t.paypal.approve(sale.orderId);
    const capture = () => t.app.request(`/api/sales/${sale.id}/capture`, { method: "POST" });
    const [a, b] = await Promise.all([capture(), capture()]);
    const c = await capture();
    const ids = await Promise.all(
      [a, b, c].map(async (r) => ((await r.json()) as { sale: Sale }).sale.captureId),
    );
    expect(new Set(ids).size).toBe(1);
    expect(t.events.filter((e) => e.type === "sale.paid")).toHaveLength(1);
  });

  it("an expired sale cannot be captured", async () => {
    const sale = await t.createSale();
    t.paypal.approve(sale.orderId);
    t.advance(SALE_TTL_MS);
    const res = await t.app.request(`/api/sales/${sale.id}/capture`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "SALE_EXPIRED" });
    expect(t.events.map((e) => e.type)).toEqual(["sale.open", "sale.expired"]);
    expect((await t.app.request("/t/rosa-01")).status).toBe(200);
  });

  it("a new sale expires the previous open one", async () => {
    const first = await t.createSale();
    const second = await t.createSale({ amount: 2000 });
    expect(t.sales.getSale(first.id)?.status).toBe("expired");
    expect((await t.app.request("/t/rosa-01")).headers.get("location")).toBe(`/pay/${second.id}`);
  });

  it("a declined payment marks the sale failed and tells the vendor", async () => {
    const sale = await t.createSale();
    await t.app.request(`/api/mock/orders/${sale.orderId}/approve`, json({ decline: true }));
    const res = await t.app.request(`/api/sales/${sale.id}/capture`, { method: "POST" });
    expect(((await res.json()) as { sale: Sale }).sale.status).toBe("failed");
    expect(t.events.at(-1)).toMatchObject({ type: "sale.failed", reason: "INSTRUMENT_DECLINED" });
  });

  it("validates input", async () => {
    const bad = [{ amount: 9.5 }, { amount: -1 }, { lines: [] }, { amount: 1, extra: true }, "x"];
    for (const body of bad) {
      const res = await t.app.request("/api/terminals/rosa-01/sales", json(body));
      expect(res.status).toBe(400);
    }
    const unknownSku = await t.app.request(
      "/api/terminals/rosa-01/sales",
      json({ lines: [{ sku: "pozole", qty: 1 }] }),
    );
    expect(unknownSku.status).toBe(400);
    expect((await t.app.request("/api/terminals/nope/sales", json({ amount: 100 }))).status).toBe(
      404,
    );
    expect((await t.app.request("/api/sales/not-a-uuid")).status).toBe(404);
    expect((await t.app.request("/t/nope")).status).toBe(404);
  });

  it("streams terminal events over SSE", async () => {
    const sale = await t.createSale();
    const res = await t.app.request("/api/terminals/rosa-01/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: sale.open");
    expect(first).toContain(sale.id);
    await reader.cancel();
  });

  it("serves a QR for the terminal URL", async () => {
    const res = await t.app.request("http://example.test/api/terminals/rosa-01/qr.svg");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });
});

describe("webhooks", () => {
  it("rejects a bad or missing signature and changes nothing", async () => {
    const t = setup();
    const sale = await t.createSale();
    t.paypal.approve(sale.orderId);
    const body = JSON.stringify({
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: sale.orderId },
    });
    const unsigned = await t.app.request("/webhooks/paypal", { method: "POST", body });
    expect(unsigned.status).toBe(400);
    const forged = await t.app.request("/webhooks/paypal", {
      method: "POST",
      headers: SIG_HEADERS,
      body,
    });
    expect(forged.status).toBe(400);
    expect(t.sales.getSale(sale.id)?.status).toBe("open");
    expect(t.events.map((e) => e.type)).toEqual(["sale.open"]);
  });

  it("CHECKOUT.ORDER.APPROVED captures; PAYMENT.CAPTURE.REFUNDED marks refunded", async () => {
    const t = setup(new TrustingPayPal());
    const sale = await t.createSale();
    t.paypal.approve(sale.orderId);
    const send = (event: unknown) =>
      t.app.request("/webhooks/paypal", {
        method: "POST",
        headers: SIG_HEADERS,
        body: JSON.stringify(event),
      });
    const approved = await send({
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: sale.orderId },
    });
    expect(approved.status).toBe(200);
    const paid = t.sales.getSale(sale.id);
    expect(paid?.status).toBe("paid");

    await send({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REF-1",
        amount: { value: "95.00", currency_code: "MXN" },
        links: [
          {
            rel: "up",
            href: `https://api.sandbox.paypal.com/v2/payments/captures/${paid?.captureId}`,
          },
        ],
      },
    });
    expect(t.sales.getSale(sale.id)?.status).toBe("refunded");
    expect(t.events.at(-1)).toMatchObject({ type: "sale.refunded", amount: { minor: 9500 } });
  });
});

describe("mock-only routes", () => {
  it("404 when the gateway is not the mock", async () => {
    const fetch = async () => new Response("{}", { status: 500 });
    const app = createApp({ paypal: new RestPayPal({ clientId: "x", clientSecret: "y", fetch }) });
    const res = await app.request("/api/mock/orders/ABC/approve", json({}));
    expect(res.status).toBe(404);
  });
});
