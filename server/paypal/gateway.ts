// server/paypal/gateway.ts: the PayPal contract the rest of the server codes against.
// Two implementations: RestPayPal (real sandbox REST) and MockPayPal (in-memory, zero setup).
// Nothing outside server/paypal/ may call PayPal's HTTP API directly.
import type { Money } from "../../shared/money";
import type { CartLine } from "../../shared/types";

export type OrderStatus =
  | "CREATED"
  | "SAVED"
  | "APPROVED"
  | "VOIDED"
  | "COMPLETED"
  | "PAYER_ACTION_REQUIRED";

export interface GatewayOrder {
  id: string;
  status: OrderStatus;
  amount: Money;
}

export interface CreateOrderInput {
  amount: Money;
  lines: CartLine[];
  /** Our sale id; lands in purchase_units[0].reference_id. */
  referenceId: string;
  description?: string;
  /** Sent as PayPal-Request-Id so a retried create does not make a second order. */
  idempotencyKey: string;
}

export interface GatewayCapture {
  id: string;
  orderId: string;
  status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED";
  amount: Money;
}

export interface GatewayRefund {
  id: string;
  captureId: string;
  status: "COMPLETED" | "PENDING" | "CANCELLED" | "FAILED";
  amount: Money;
}

export interface CreateInvoiceInput {
  amount: Money;
  description: string;
  /** Sent as PayPal-Request-Id on the create call. */
  idempotencyKey: string;
}

export interface GatewayInvoice {
  id: string;
  status: string;
  amount: Money;
  /** Payer link (the invoice page where the customer pays). */
  payUrl: string;
  /** Base64 PNG of PayPal's QR code; undefined when the gateway does not provide one (mock). */
  qrPngBase64?: string;
}

export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

export interface PayPalGateway {
  readonly mode: "mock" | "sandbox";
  /** Public client id for the JS SDK on the checkout page; undefined in mock mode. */
  readonly clientId: string | undefined;
  createOrder(input: CreateOrderInput): Promise<GatewayOrder>;
  getOrder(orderId: string): Promise<GatewayOrder>;
  captureOrder(orderId: string, idempotencyKey: string): Promise<GatewayCapture>;
  refundCapture(captureId: string, amount: Money, idempotencyKey: string): Promise<GatewayRefund>;
  /** Create an invoice, mark it sent without emailing, and fetch its QR (Invoicing v2). */
  createInvoice(input: CreateInvoiceInput): Promise<GatewayInvoice>;
  /** True only when PayPal confirms the signature for our webhook id. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
}

/** A PayPal failure with PayPal's issue code (e.g. ORDER_NOT_APPROVED, INSTRUMENT_DECLINED). */
export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue: string | undefined,
    readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}
