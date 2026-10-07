// test/rest-paypal.test.ts: RestPayPal against a stubbed fetch — token caching, request ids,
// order/capture/refund parsing, error mapping, timeouts and webhook verification.
import { describe, expect, it } from "vitest";
import { createGateway } from "../server/paypal";
import { MockPayPal } from "../server/paypal/mock";
import { RestPayPal } from "../server/paypal/rest";
import { money } from "../shared/money";

interface Call {
  url: string;
  init: RequestInit;
}

function stub(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const handler = routes[path] ?? routes[`${init.method} ${path}`];
    if (!handler) return new Response("{}", { status: 404 });
    return handler({ url, init });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const token = () => ok({ access_token: "TOKEN", token_type: "Bearer", expires_in: 32400 });
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe("RestPayPal", () => {
  it("caches the OAuth token and sends PayPal-Request-Id on writes", async () => {
    const { calls, fetch } = stub({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders": () =>
        ok(
          {
            id: "ORDER1",
            status: "CREATED",
            purchase_units: [{ amount: { currency_code: "MXN", value: "95.00" } }],
          },
          201,
        ),
      "/v2/checkout/orders/ORDER1": () =>
        ok({
          id: "ORDER1",
          status: "APPROVED",
          purchase_units: [{ amount: { currency_code: "MXN", value: "95.00" } }],
        }),
    });
    const pp = new RestPayPal({ clientId: "id", clientSecret: "secret", fetch });
    const order = await pp.createOrder({
      amount: money(9500, "MXN"),
      lines: [{ sku: "atole", name: "Atole", qty: 1, unitPrice: money(9500, "MXN") }],
      referenceId: "sale-1",
      idempotencyKey: "sale-1:create",
    });
    expect(order).toEqual({ id: "ORDER1", status: "CREATED", amount: money(9500, "MXN") });
    expect((await pp.getOrder("ORDER1")).status).toBe("APPROVED");

    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    const [tok, create, get] = calls;
    expect(header(tok as Call, "Authorization")).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );
    expect(header(create as Call, "Authorization")).toBe("Bearer TOKEN");
    expect(header(create as Call, "PayPal-Request-Id")).toBe("sale-1:create");
    expect(header(get as Call, "PayPal-Request-Id")).toBeUndefined();
    expect(create?.init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(String(create?.init.body));
    expect(sent.intent).toBe("CAPTURE");
    expect(sent.purchase_units[0]).toMatchObject({
      reference_id: "sale-1",
      amount: {
        currency_code: "MXN",
        value: "95.00",
        breakdown: { item_total: { value: "95.00" } },
      },
      items: [{ sku: "atole", quantity: "1", unit_amount: { value: "95.00" } }],
    });
  });

  it("refreshes the token after it expires", async () => {
    let now = 0;
    const { calls, fetch } = stub({
      "/v1/oauth2/token": () => ok({ access_token: "T", token_type: "Bearer", expires_in: 120 }),
      "/v2/checkout/orders/O": () =>
        ok({
          id: "O",
          status: "CREATED",
          purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }],
        }),
    });
    const pp = new RestPayPal({ clientId: "a", clientSecret: "b", fetch, now: () => now });
    await pp.getOrder("O");
    now += 59_000;
    await pp.getOrder("O");
    now += 2_000;
    await pp.getOrder("O");
    expect(calls.filter((c) => c.url.endsWith("/oauth2/token"))).toHaveLength(2);
  });

  it("parses captures and refunds", async () => {
    const { calls, fetch } = stub({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders/ORDER1/capture": () =>
        ok(
          {
            id: "ORDER1",
            status: "COMPLETED",
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: "CAP1",
                      status: "COMPLETED",
                      amount: { currency_code: "MXN", value: "95.00" },
                    },
                  ],
                },
              },
            ],
          },
          201,
        ),
      "/v2/payments/captures/CAP1/refund": () => ok({ id: "REF1", status: "COMPLETED" }, 201),
    });
    const pp = new RestPayPal({ clientId: "a", clientSecret: "b", fetch });
    const cap = await pp.captureOrder("ORDER1", "sale-1:capture");
    expect(cap).toEqual({
      id: "CAP1",
      orderId: "ORDER1",
      status: "COMPLETED",
      amount: money(9500, "MXN"),
    });
    const refund = await pp.refundCapture("CAP1", money(2500, "MXN"), "r-1");
    expect(refund).toMatchObject({ id: "REF1", captureId: "CAP1", status: "COMPLETED" });
    const refundCall = calls.at(-1) as Call;
    expect(header(refundCall, "PayPal-Request-Id")).toBe("r-1");
    expect(JSON.parse(String(refundCall.init.body))).toEqual({
      amount: { currency_code: "MXN", value: "25.00" },
    });
  });

  it("maps PayPal errors to PayPalError with issue and debug_id", async () => {
    const { fetch } = stub({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders/O/capture": () =>
        ok(
          {
            name: "UNPROCESSABLE_ENTITY",
            message: "The requested action could not be performed.",
            debug_id: "dbg123",
            details: [{ issue: "INSTRUMENT_DECLINED" }],
          },
          422,
        ),
    });
    const pp = new RestPayPal({ clientId: "a", clientSecret: "b", fetch });
    await expect(pp.captureOrder("O", "k")).rejects.toMatchObject({
      name: "PayPalError",
      status: 422,
      issue: "INSTRUMENT_DECLINED",
      debugId: "dbg123",
    });
  });

  it("reports bad credentials and timeouts as PayPalError", async () => {
    const bad = stub({
      "/v1/oauth2/token": () =>
        ok({ error: "invalid_client", error_description: "Client Authentication failed" }, 401),
    });
    await expect(
      new RestPayPal({ clientId: "a", clientSecret: "b", fetch: bad.fetch }).getOrder("O"),
    ).rejects.toMatchObject({ status: 401, issue: "invalid_client" });

    const slow = (async (_: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    await expect(
      new RestPayPal({ clientId: "a", clientSecret: "b", fetch: slow, timeoutMs: 20 }).getOrder(
        "O",
      ),
    ).rejects.toMatchObject({ issue: "TIMEOUT" });
  });

  it("verifies webhooks with the raw event embedded verbatim", async () => {
    const { calls, fetch } = stub({
      "/v1/oauth2/token": token,
      "/v1/notifications/verify-webhook-signature": (c) => {
        const body = JSON.parse(String(c.init.body));
        return ok({
          verification_status: body.transmission_sig === "good" ? "SUCCESS" : "FAILURE",
        });
      },
    });
    const pp = new RestPayPal({ clientId: "a", clientSecret: "b", webhookId: "WH-1", fetch });
    const raw =
      '{"id":"WH-EVT","event_type":"CHECKOUT.ORDER.APPROVED","resource":{"id":"O","amount":1.10}}';
    const h = {
      authAlgo: "SHA256withRSA",
      certUrl: "https://api.sandbox.paypal.com/cert",
      transmissionId: "t1",
      transmissionSig: "good",
      transmissionTime: "2026-10-06T12:00:00Z",
    };
    expect(await pp.verifyWebhook(h, raw)).toBe(true);
    expect(await pp.verifyWebhook({ ...h, transmissionSig: "bad" }, raw)).toBe(false);
    const sent = String(calls.at(-1)?.init.body);
    expect(sent).toContain(`"webhook_event":${raw}`);
    expect(JSON.parse(sent).webhook_id).toBe("WH-1");

    const noId = new RestPayPal({ clientId: "a", clientSecret: "b", fetch });
    expect(await noId.verifyWebhook(h, raw)).toBe(false);
    expect(await pp.verifyWebhook(h, "not json")).toBe(false);
  });
});

describe("createGateway", () => {
  it("uses sandbox only with both keys", () => {
    expect(createGateway({})).toBeInstanceOf(MockPayPal);
    expect(createGateway({ PAYPAL_CLIENT_ID: "x" })).toBeInstanceOf(MockPayPal);
    const pp = createGateway({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" });
    expect(pp.mode).toBe("sandbox");
    expect(pp.clientId).toBe("x");
  });
});
