// test/ledger.test.ts: GET /api/backoffice/ledger against MockPayPal — session required, date
// validation, paid/open/refunded rows with line items, per-row reconciliation and day totals.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";

const PIN = "4321";
const NOW = Date.parse("2026-10-06T18:00:00Z");

async function setup() {
  const paypal = new MockPayPal();
  const app = createApp({ paypal, vendorPin: PIN, clock: () => NOW });
  const json = async (path: string, body?: unknown, token?: string) => {
    const res = await app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  const create = async (body: unknown) => {
    const { data } = await json("/api/terminals/rosa-01/sales", body);
    return data.sale as { id: string; orderId: string };
  };
  const pay = async (body: unknown) => {
    const sale = await create(body);
    paypal.approve(sale.orderId);
    await json(`/api/sales/${sale.id}/capture`, {});
    return sale.id;
  };
  const token = (await json("/api/backoffice/session", { pin: PIN })).data.token as string;
  return { json, create, pay, token };
}

interface Row {
  id: string;
  status: string;
  reconciliation: string;
  captureId: string | null;
  refunded: { minor: number };
  net: { minor: number };
  lines: Array<{ sku: string; qty: number; subtotal: { minor: number } }>;
}

describe("GET /api/backoffice/ledger", () => {
  it("requires a vendor session", async () => {
    const { json } = await setup();
    expect((await json("/api/backoffice/ledger")).status).toBe(401);
  });

  it("rejects a malformed date", async () => {
    const { json, token } = await setup();
    for (const d of ["2026-13-01", "yesterday", "2026-02-30"]) {
      const r = await json(`/api/backoffice/ledger?date=${d}`, undefined, token);
      expect(r.status).toBe(400);
    }
  });

  it("lists paid, open and refunded sales with reconciliation and totals", async () => {
    const { json, create, pay, token } = await setup();
    const a = await pay({ lines: [{ sku: "atole", qty: 2 }] });
    const b = await pay({ amount: 5000 });
    const refund = await json(
      "/api/backoffice/refunds",
      { saleId: b, amountMinor: 1000, pin: PIN },
      token,
    );
    expect(refund.status).toBe(200);
    const open = await create({ amount: 700 });

    const { status, data } = await json("/api/backoffice/ledger", undefined, token);
    expect(status).toBe(200);
    expect(data.day).toBe("2026-10-06");
    expect(data.terminals).toEqual(["rosa-01"]);
    const rows = data.rows as Row[];
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)?.reconciliation).toBe("matched");
    expect(byId.get(a)?.captureId).toBeTruthy();
    expect(byId.get(a)?.lines).toEqual([
      expect.objectContaining({
        sku: "atole",
        qty: 2,
        subtotal: expect.objectContaining({ minor: 4000 }),
      }),
    ]);
    expect(byId.get(b)?.reconciliation).toBe("partial_refund");
    expect(byId.get(b)?.net.minor).toBe(4000);
    expect(byId.get(open.id)?.reconciliation).toBe("pending");
    expect(data.totals).toMatchObject({
      paid: { minor: 9000 },
      refunded: { minor: 1000 },
      net: { minor: 8000 },
      cash: { minor: 0 },
      count: 2,
    });
  });

  it("returns an empty ledger for another day", async () => {
    const { json, pay, token } = await setup();
    await pay({ amount: 1000 });
    const { data } = await json("/api/backoffice/ledger?date=2026-10-05", undefined, token);
    expect(data.rows).toEqual([]);
    expect(data.totals).toMatchObject({ net: { minor: 0 }, count: 0 });
  });
});
