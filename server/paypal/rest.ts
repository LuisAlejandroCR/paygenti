// server/paypal/rest.ts: PayPalGateway against the real REST API (sandbox by default).
// OAuth2 client_credentials with a cached token, Orders v2, refunds, Payouts v1 and webhook checks.
// Every write carries PayPal-Request-Id; every call has a timeout; secrets are never logged.
import { isPayPalCurrency } from "../../shared/currency";
import { fromPayPalValue, type Money, toPayPalValue } from "../../shared/money";
import {
  type CreateInvoiceInput,
  type CreateOrderInput,
  type CreatePayoutInput,
  type GatewayCapture,
  type GatewayInvoice,
  type GatewayOrder,
  type GatewayPayout,
  type GatewayRefund,
  type OrderStatus,
  type PayoutBatchStatus,
  type PayoutItemStatus,
  PayPalError,
  type PayPalGateway,
  type WebhookHeaders,
} from "./gateway";

export const SANDBOX_URL = "https://api-m.sandbox.paypal.com";

/** Our issue code when the app's credentials may not send payouts. */
export const PAYOUTS_NOT_ENABLED = "PAYOUTS_NOT_ENABLED";

/**
 * PayPal answers a payout from an app without the Payouts permission with 403 (NOT_AUTHORIZED,
 * AUTHORIZATION_ERROR, PERMISSION_DENIED) or REQUIRED_SCOPE_MISSING; all become PAYOUTS_NOT_ENABLED.
 */
const NO_PAYOUTS = new Set([
  "NOT_AUTHORIZED",
  "AUTHORIZATION_ERROR",
  "PERMISSION_DENIED",
  "REQUIRED_SCOPE_MISSING",
  "REFUSED_ACCESS_DENIED",
]);

export function toPayoutError(err: unknown): unknown {
  if (!(err instanceof PayPalError)) return err;
  if (err.status === 403 || (err.issue && NO_PAYOUTS.has(err.issue)))
    return new PayPalError(
      "Payouts is not enabled for this PayPal app",
      403,
      PAYOUTS_NOT_ENABLED,
      err.debugId,
    );
  return err;
}

interface PayPalPayoutBatch {
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: PayoutBatchStatus;
    sender_batch_header?: { sender_batch_id?: string };
  };
  items?: {
    payout_item_id?: string;
    transaction_id?: string;
    transaction_status?: PayoutItemStatus;
    errors?: { name?: string };
  }[];
}

export interface RestPayPalOptions {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

interface PayPalAmount {
  currency_code: string;
  value: string;
}

interface PayPalCapture {
  id: string;
  status: GatewayCapture["status"];
  amount?: PayPalAmount;
}

interface PayPalOrder {
  id: string;
  status: OrderStatus;
  purchase_units?: {
    amount?: PayPalAmount;
    payments?: { captures?: PayPalCapture[] };
  }[];
}

export class RestPayPal implements PayPalGateway {
  readonly mode = "sandbox" as const;
  readonly clientId: string;
  private readonly secret: string;
  private readonly webhookId: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | undefined;
  private tokenPending: Promise<string> | undefined;

  constructor(opts: RestPayPalOptions) {
    this.clientId = opts.clientId;
    this.secret = opts.clientSecret;
    this.webhookId = opts.webhookId || undefined;
    this.baseUrl = opts.baseUrl ?? SANDBOX_URL;
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    const currency_code = input.amount.currency;
    const unit = {
      reference_id: input.referenceId,
      description: input.description?.slice(0, 127),
      amount: {
        currency_code,
        value: toPayPalValue(input.amount),
        ...(input.lines.length > 0 && {
          breakdown: { item_total: { currency_code, value: toPayPalValue(input.amount) } },
        }),
      },
      ...(input.lines.length > 0 && {
        items: input.lines.map((l) => ({
          name: l.name.slice(0, 127),
          sku: l.sku,
          quantity: String(l.qty),
          unit_amount: { currency_code, value: toPayPalValue(l.unitPrice) },
        })),
      }),
    };
    const order = await this.call<PayPalOrder>("POST", "/v2/checkout/orders", {
      body: { intent: "CAPTURE", purchase_units: [unit] },
      requestId: input.idempotencyKey,
    });
    return toOrder(order, input.amount);
  }

  async getOrder(orderId: string): Promise<GatewayOrder> {
    const order = await this.call<PayPalOrder>(
      "GET",
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    );
    return toOrder(order);
  }

  async captureOrder(orderId: string, idempotencyKey: string): Promise<GatewayCapture> {
    const order = await this.call<PayPalOrder>(
      "POST",
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { body: {}, requestId: idempotencyKey },
    );
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.amount) {
      throw new PayPalError("capture response without a capture", 502, "MALFORMED_RESPONSE");
    }
    return {
      id: capture.id,
      orderId: order.id,
      status: capture.status,
      amount: parseAmount(capture.amount),
    };
  }

  async refundCapture(
    captureId: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<GatewayRefund> {
    const refund = await this.call<{ id: string; status: GatewayRefund["status"] }>(
      "POST",
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      {
        body: { amount: { currency_code: amount.currency, value: toPayPalValue(amount) } },
        requestId: idempotencyKey,
      },
    );
    return { id: refund.id, captureId, status: refund.status, amount };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<GatewayInvoice> {
    const currency_code = input.amount.currency;
    const created = await this.call<{ id?: string; href?: string; status?: string }>(
      "POST",
      "/v2/invoicing/invoices",
      {
        body: {
          detail: { currency_code, note: input.description.slice(0, 200) },
          items: [
            {
              name: input.description.slice(0, 200) || "Venta",
              quantity: "1",
              unit_amount: { currency_code, value: toPayPalValue(input.amount) },
            },
          ],
        },
        requestId: input.idempotencyKey,
      },
    );
    const id = created.id ?? /\/invoices\/([^/?]+)/.exec(created.href ?? "")?.[1];
    if (!id) throw new PayPalError("invoice response without an id", 502, "MALFORMED_RESPONSE");
    const path = `/v2/invoicing/invoices/${encodeURIComponent(id)}`;
    const sent = await this.call<{ href?: string }>("POST", `${path}/send`, {
      body: { send_to_recipient: false, send_to_invoicer: false },
      requestId: `${input.idempotencyKey}:send`,
    });
    const qrText = await this.callText("POST", `${path}/generate-qr-code`, {
      width: 300,
      height: 300,
    });
    return {
      id,
      status: "SENT",
      amount: input.amount,
      payUrl: sent.href ?? `https://www.sandbox.paypal.com/invoice/p/#${id}`,
      qrPngBase64: extractBase64(qrText),
    };
  }

  async createPayout(input: CreatePayoutInput): Promise<GatewayPayout> {
    const body = {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        recipient_type: input.recipientType,
        email_subject: "You have a payment",
        email_message: (input.note ?? "Payment from your customer").slice(0, 1000),
      },
      items: [
        {
          recipient_type: input.recipientType,
          // Payouts v1 money is { value, currency } (not Orders' currency_code).
          amount: { value: toPayPalValue(input.amount), currency: input.amount.currency },
          receiver: input.receiver,
          sender_item_id: input.senderItemId.slice(0, 63),
          ...(input.note && { note: input.note.slice(0, 1000) }),
        },
      ],
    };
    try {
      const res = await this.call<PayPalPayoutBatch>("POST", "/v1/payments/payouts", {
        body,
        requestId: input.senderBatchId,
      });
      return toPayout(res, input.senderBatchId);
    } catch (err) {
      throw toPayoutError(err);
    }
  }

  async getPayout(batchId: string): Promise<GatewayPayout> {
    try {
      const res = await this.call<PayPalPayoutBatch>(
        "GET",
        `/v1/payments/payouts/${encodeURIComponent(batchId)}`,
      );
      return toPayout(res);
    } catch (err) {
      throw toPayoutError(err);
    }
  }

  async verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean> {
    if (!this.webhookId) return false;
    try {
      JSON.parse(rawBody);
    } catch {
      return false;
    }
    // The event is embedded verbatim: re-serializing it can change bytes and fail verification.
    const body = `{"auth_algo":${JSON.stringify(headers.authAlgo)},"cert_url":${JSON.stringify(
      headers.certUrl,
    )},"transmission_id":${JSON.stringify(headers.transmissionId)},"transmission_sig":${JSON.stringify(
      headers.transmissionSig,
    )},"transmission_time":${JSON.stringify(headers.transmissionTime)},"webhook_id":${JSON.stringify(
      this.webhookId,
    )},"webhook_event":${rawBody}}`;
    const res = await this.call<{ verification_status: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      { rawBody: body },
    );
    return res.verification_status === "SUCCESS";
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; rawBody?: string; requestId?: string } = {},
  ): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    const payload =
      opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      headers.Prefer = "return=representation";
    }
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    const res = await this.send(`${this.baseUrl}${path}`, { method, headers, body: payload });
    if (res.status === 401) this.token = undefined;
    return this.parse<T>(res);
  }

  /** Like call() but returns the raw body (generate-qr-code answers base64 text, not JSON). */
  private async callText(method: "POST", path: string, body: unknown): Promise<string> {
    const token = await this.accessToken();
    const res = await this.send(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.parse<string>(res);
    return res.text();
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    this.tokenPending ??= this.fetchToken().finally(() => {
      this.tokenPending = undefined;
    });
    return this.tokenPending;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    const res = await this.send(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    const data = await this.parse<{ access_token: string; expires_in: number }>(res);
    // Refresh a minute early so a request never goes out with a token about to expire.
    const ttlMs = Math.max(0, (data.expires_in - 60) * 1000);
    this.token = { value: data.access_token, expiresAt: this.now() + ttlMs };
    return data.access_token;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new PayPalError(
        timedOut ? "PayPal request timed out" : "PayPal request failed",
        timedOut ? 504 : 502,
        timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      );
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const err = data as {
        name?: string;
        message?: string;
        error?: string;
        error_description?: string;
        debug_id?: string;
        details?: { issue?: string }[];
      };
      throw new PayPalError(
        err.message ?? err.error_description ?? `PayPal HTTP ${res.status}`,
        res.status,
        err.details?.[0]?.issue ?? err.name ?? err.error,
        err.debug_id ?? res.headers.get("paypal-debug-id") ?? undefined,
      );
    }
    return data as T;
  }
}

/** The QR endpoint may wrap the base64 PNG in a multipart envelope; keep the longest base64 run. */
function extractBase64(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const runs = lines.filter((l) => l.length >= 100 && /^[A-Za-z0-9+/=]+$/.test(l));
  return runs.sort((a, b) => b.length - a.length)[0];
}

function toPayout(res: PayPalPayoutBatch, senderBatchId?: string): GatewayPayout {
  const h = res.batch_header;
  if (!h?.payout_batch_id || !h.batch_status)
    throw new PayPalError("payout response without a batch id", 502, "MALFORMED_RESPONSE");
  return {
    batchId: h.payout_batch_id,
    batchStatus: h.batch_status,
    senderBatchId: h.sender_batch_header?.sender_batch_id ?? senderBatchId ?? "",
    items: (res.items ?? [])
      .filter((i) => typeof i.payout_item_id === "string")
      .map((i) => ({
        itemId: i.payout_item_id as string,
        ...(i.transaction_status && { status: i.transaction_status }),
        ...(i.transaction_id && { transactionId: i.transaction_id }),
        ...(i.errors?.name && { error: i.errors.name }),
      })),
  };
}

function toOrder(order: PayPalOrder, fallback?: Money): GatewayOrder {
  const amount = order.purchase_units?.[0]?.amount;
  const parsed = amount ? parseAmount(amount) : fallback;
  if (!parsed) throw new PayPalError("order response without an amount", 502, "MALFORMED_RESPONSE");
  return { id: order.id, status: order.status, amount: parsed };
}

function parseAmount(a: PayPalAmount): Money {
  if (!isPayPalCurrency(a.currency_code)) {
    throw new PayPalError(`unsupported currency ${a.currency_code}`, 502, "UNSUPPORTED_CURRENCY");
  }
  return fromPayPalValue(a.value, a.currency_code);
}
