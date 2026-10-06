// server/paypal/mock.ts: in-memory PayPal used by tests, local dev and judge mode without keys.
// Mirrors the sandbox state machine: CREATED -> APPROVED (buyer) -> COMPLETED (capture).
// `approve` and `decline` stand in for the buyer's wallet; they are not part of the real API.
import { randomUUID } from "node:crypto";
import type { Money } from "../../shared/money";
import {
  type CreateOrderInput,
  type GatewayCapture,
  type GatewayOrder,
  type GatewayRefund,
  PayPalError,
  type PayPalGateway,
} from "./gateway";

interface MockOrder extends GatewayOrder {
  declined: boolean;
  capture?: GatewayCapture;
}

export class MockPayPal implements PayPalGateway {
  readonly mode = "mock" as const;
  readonly clientId = undefined;
  private readonly orders = new Map<string, MockOrder>();
  private readonly captures = new Map<string, GatewayCapture & { refunded: number }>();
  private readonly idempotent = new Map<string, unknown>();

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    return this.once(`create:${input.idempotencyKey}`, () => {
      if (input.amount.minor <= 0) {
        throw new PayPalError("amount must be positive", 422, "INVALID_PARAMETER_VALUE");
      }
      const order: MockOrder = {
        id: `MOCK-${randomUUID().slice(0, 13).toUpperCase()}`,
        status: "CREATED",
        amount: input.amount,
        declined: false,
      };
      this.orders.set(order.id, order);
      return publicOrder(order);
    });
  }

  async getOrder(orderId: string): Promise<GatewayOrder> {
    return publicOrder(this.find(orderId));
  }

  /** Buyer approves in their wallet. `declineOnCapture` simulates INSTRUMENT_DECLINED. */
  approve(orderId: string, opts: { declineOnCapture?: boolean } = {}): GatewayOrder {
    const order = this.find(orderId);
    if (order.status !== "CREATED") {
      throw new PayPalError(`order ${orderId} is ${order.status}`, 422, "ORDER_NOT_APPROVABLE");
    }
    order.status = "APPROVED";
    order.declined = opts.declineOnCapture ?? false;
    return publicOrder(order);
  }

  async captureOrder(orderId: string, idempotencyKey: string): Promise<GatewayCapture> {
    return this.once(`capture:${idempotencyKey}`, () => {
      const order = this.find(orderId);
      if (order.status === "COMPLETED" && order.capture) {
        throw new PayPalError("order already captured", 422, "ORDER_ALREADY_CAPTURED");
      }
      if (order.status !== "APPROVED") {
        throw new PayPalError("payer has not approved the order", 422, "ORDER_NOT_APPROVED");
      }
      if (order.declined) {
        throw new PayPalError("instrument declined", 422, "INSTRUMENT_DECLINED");
      }
      const capture: GatewayCapture = {
        id: `MOCKCAP-${randomUUID().slice(0, 13).toUpperCase()}`,
        orderId,
        status: "COMPLETED",
        amount: order.amount,
      };
      order.status = "COMPLETED";
      order.capture = capture;
      this.captures.set(capture.id, { ...capture, refunded: 0 });
      return capture;
    });
  }

  async refundCapture(
    captureId: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<GatewayRefund> {
    return this.once(`refund:${idempotencyKey}`, () => {
      const capture = this.captures.get(captureId);
      if (!capture)
        throw new PayPalError(`capture ${captureId} not found`, 404, "RESOURCE_NOT_FOUND");
      if (amount.currency !== capture.amount.currency) {
        throw new PayPalError("currency mismatch", 422, "CURRENCY_MISMATCH");
      }
      if (amount.minor <= 0 || capture.refunded + amount.minor > capture.amount.minor) {
        throw new PayPalError("refund exceeds captured amount", 422, "REFUND_AMOUNT_EXCEEDED");
      }
      capture.refunded += amount.minor;
      return {
        id: `MOCKREF-${randomUUID().slice(0, 13).toUpperCase()}`,
        captureId,
        status: "COMPLETED",
        amount,
      };
    });
  }

  /** Mock webhooks are never "verified": only real PayPal signatures pass. */
  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  private find(orderId: string): MockOrder {
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalError(`order ${orderId} not found`, 404, "RESOURCE_NOT_FOUND");
    return order;
  }

  /** Same idempotency key -> same result, like PayPal-Request-Id. Errors are not cached. */
  private once<T>(key: string, fn: () => T): T {
    if (this.idempotent.has(key)) return this.idempotent.get(key) as T;
    const result = fn();
    this.idempotent.set(key, result);
    return result;
  }
}

function publicOrder(order: MockOrder): GatewayOrder {
  return { id: order.id, status: order.status, amount: order.amount };
}
