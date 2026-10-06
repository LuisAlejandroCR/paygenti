// test/mock-paypal.test.ts: the in-memory gateway follows the sandbox order state machine.
import { describe, expect, it } from "vitest";
import { MockPayPal } from "../server/paypal/mock";
import { money } from "../shared/money";

const input = (key: string) => ({
  amount: money(9500, "MXN"),
  lines: [],
  referenceId: "sale-1",
  idempotencyKey: key,
});

describe("MockPayPal", () => {
  it("creates, approves, captures and refunds", async () => {
    const pp = new MockPayPal();
    const order = await pp.createOrder(input("c1"));
    expect(order.status).toBe("CREATED");
    pp.approve(order.id);
    const capture = await pp.captureOrder(order.id, "cap1");
    expect(capture.status).toBe("COMPLETED");
    expect((await pp.getOrder(order.id)).status).toBe("COMPLETED");
    const refund = await pp.refundCapture(capture.id, money(5000, "MXN"), "r1");
    expect(refund.status).toBe("COMPLETED");
    await expect(pp.refundCapture(capture.id, money(5000, "MXN"), "r2")).rejects.toMatchObject({
      issue: "REFUND_AMOUNT_EXCEEDED",
    });
  });

  it("is idempotent per key", async () => {
    const pp = new MockPayPal();
    const a = await pp.createOrder(input("same"));
    const b = await pp.createOrder(input("same"));
    expect(a.id).toBe(b.id);
    pp.approve(a.id);
    const c1 = await pp.captureOrder(a.id, "k");
    const c2 = await pp.captureOrder(a.id, "k");
    expect(c1.id).toBe(c2.id);
  });

  it("refuses to capture unapproved or declined orders", async () => {
    const pp = new MockPayPal();
    const order = await pp.createOrder(input("c2"));
    await expect(pp.captureOrder(order.id, "x")).rejects.toMatchObject({
      issue: "ORDER_NOT_APPROVED",
    });
    pp.approve(order.id, { declineOnCapture: true });
    await expect(pp.captureOrder(order.id, "y")).rejects.toMatchObject({
      issue: "INSTRUMENT_DECLINED",
    });
  });

  it("never verifies webhooks", async () => {
    expect(await new MockPayPal().verifyWebhook()).toBe(false);
  });
});
