// server/paypal/rest.ts: PayPalGateway against the real REST API (sandbox by default).
// OAuth token, Orders v2 and refunds go through the official @paypal/paypal-server-sdk; Invoicing,
// Payouts and webhook verification (not in the SDK) keep plain fetch. Every write carries
// PayPal-Request-Id; every call has a timeout; secrets are never logged.
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OAuthAuthorizationController,
  OrdersController,
  PaymentsController,
} from "@paypal/paypal-server-sdk";
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

/** SDK models are camelCase (currencyCode), unlike the raw wire JSON. */
interface SdkAmount {
  currencyCode: string;
  value: string;
}

interface SdkOrder {
  id?: string;
  status?: string;
  purchaseUnits?: { amount?: SdkAmount }[];
}

/** The slice of the axios request config the SDK hands its transport adapter. */
interface AxiosLikeConfig {
  url?: string;
  method?: string;
  headers?: unknown;
  data?: unknown;
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
  /** SDK client with no credentials: our token cache (with the injected clock) feeds each call. */
  private readonly sdk: Client;

  constructor(opts: RestPayPalOptions) {
    this.clientId = opts.clientId;
    this.secret = opts.clientSecret;
    this.webhookId = opts.webhookId || undefined;
    this.baseUrl = opts.baseUrl ?? SANDBOX_URL;
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.sdk = new Client({
      environment: Environment.Sandbox,
      // Our fetch bridge applies the timeout; SDK default (0) would mean "no timeout".
      timeout: 0,
      // Writes are not retried by the SDK (POST is not in httpMethodsToRetry); keep it explicit.
      httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
      unstable_httpClientOptions: {
        adapter: (config: AxiosLikeConfig) => this.bridge(config),
      },
    });
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    const currencyCode = input.amount.currency;
    const value = toPayPalValue(input.amount);
    const hasLines = input.lines.length > 0;
    const order = await this.sdkCall((c) =>
      new OrdersController(c).createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: input.referenceId,
              description: input.description?.slice(0, 127),
              amount: {
                currencyCode,
                value,
                ...(hasLines && { breakdown: { itemTotal: { currencyCode, value } } }),
              },
              ...(hasLines && {
                items: input.lines.map((l) => ({
                  name: l.name.slice(0, 127),
                  sku: l.sku,
                  quantity: String(l.qty),
                  unitAmount: { currencyCode, value: toPayPalValue(l.unitPrice) },
                })),
              }),
            },
          ],
        },
        paypalRequestId: input.idempotencyKey,
        prefer: "return=representation",
      }),
    );
    return toOrder(order, input.amount);
  }

  async getOrder(orderId: string): Promise<GatewayOrder> {
    return toOrder(await this.sdkCall((c) => new OrdersController(c).getOrder({ id: orderId })));
  }

  async captureOrder(orderId: string, idempotencyKey: string): Promise<GatewayCapture> {
    const order = await this.sdkCall((c) =>
      new OrdersController(c).captureOrder({
        id: orderId,
        paypalRequestId: idempotencyKey,
        prefer: "return=representation",
        body: {},
      }),
    );
    const capture = order.purchaseUnits?.[0]?.payments?.captures?.[0];
    if (!capture?.amount || !capture.id || !order.id) {
      throw new PayPalError("capture response without a capture", 502, "MALFORMED_RESPONSE");
    }
    return {
      id: capture.id,
      orderId: order.id,
      status: capture.status as GatewayCapture["status"],
      amount: parseAmount(capture.amount),
    };
  }

  async refundCapture(
    captureId: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<GatewayRefund> {
    const refund = await this.sdkCall((c) =>
      new PaymentsController(c).refundCapturedPayment({
        captureId,
        paypalRequestId: idempotencyKey,
        prefer: "return=representation",
        body: { amount: { currencyCode: amount.currency, value: toPayPalValue(amount) } },
      }),
    );
    if (!refund.id)
      throw new PayPalError("refund response without an id", 502, "MALFORMED_RESPONSE");
    return { id: refund.id, captureId, status: refund.status as GatewayRefund["status"], amount };
  }

  // Invoicing v2 is not in @paypal/paypal-server-sdk 2.5.0: plain fetch.
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

  // Payouts v1 is not in @paypal/paypal-server-sdk 2.5.0: plain fetch.
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

  // Webhook signature verification is not in @paypal/paypal-server-sdk 2.5.0: plain fetch.
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

  /**
   * Runs an SDK operation on a client carrying our cached token (no expiry, so our cache decides
   * when to refresh) and maps the SDK's ApiError to PayPalError.
   */
  private async sdkCall<T>(op: (client: Client) => Promise<{ result: T }>): Promise<T> {
    const accessToken = await this.accessToken();
    const client = this.sdk.withConfiguration({
      clientCredentialsAuthCredentials: {
        oAuthClientId: this.clientId,
        oAuthClientSecret: this.secret,
        oAuthToken: { accessToken, tokenType: "Bearer" },
      },
    });
    try {
      return (await op(client)).result;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) this.token = undefined;
      throw fromSdkError(err);
    }
  }

  /** axios adapter for the SDK: sends through our fetch (timeout, test stubs, PAYPAL_API_URL). */
  private async bridge(config: AxiosLikeConfig): Promise<unknown> {
    const sdkUrl = new URL(config.url ?? "");
    const url = `${this.baseUrl}${sdkUrl.pathname}${sdkUrl.search}`;
    const raw = config.headers as { toJSON?: () => Record<string, unknown> } | undefined;
    const flat =
      typeof raw?.toJSON === "function" ? raw.toJSON() : ((raw ?? {}) as Record<string, unknown>);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(flat))
      if (v != null) headers[canonicalHeader(k)] = String(v);
    const res = await this.send(url, {
      method: (config.method ?? "get").toUpperCase(),
      headers,
      body: config.data == null ? undefined : String(config.data),
    });
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });
    return {
      data: await res.text(),
      status: res.status,
      statusText: res.statusText,
      headers: respHeaders,
      config,
    };
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

  /** client_credentials through the SDK's OAuthAuthorizationController (no auth on that call). */
  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    let result: { accessToken: string; expiresIn?: bigint };
    try {
      ({ result } = await new OAuthAuthorizationController(this.sdk).requestToken({
        authorization: `Basic ${basic}`,
      }));
    } catch (err) {
      throw fromSdkError(err);
    }
    // Refresh a minute early so a request never goes out with a token about to expire.
    const ttlMs = Math.max(0, (Number(result.expiresIn ?? 0) - 60) * 1000);
    this.token = { value: result.accessToken, expiresAt: this.now() + ttlMs };
    return result.accessToken;
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
    if (!res.ok) throw toPayPalError(res.status, text, (n) => res.headers.get(n) ?? undefined);
    return parseJson(text) as T;
  }
}

/** SDK ApiError (or a PayPalError raised inside our fetch bridge) to PayPalError. */
function fromSdkError(err: unknown): unknown {
  if (err instanceof PayPalError) return err;
  if (err instanceof ApiError) {
    const body = typeof err.body === "string" ? err.body : "";
    const headers = err.headers ?? {};
    return toPayPalError(err.statusCode, body, (n) => headers[n]);
  }
  // axios may wrap what the adapter threw; unwrap our own error when it does.
  const cause = (err as { cause?: unknown } | undefined)?.cause;
  if (cause instanceof PayPalError) return cause;
  return err;
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

function toOrder(order: SdkOrder, fallback?: Money): GatewayOrder {
  const amount = order.purchaseUnits?.[0]?.amount;
  const parsed = amount ? parseAmount(amount) : fallback;
  if (!parsed || !order.id)
    throw new PayPalError("order response without an amount", 502, "MALFORMED_RESPONSE");
  return { id: order.id, status: order.status as OrderStatus, amount: parsed };
}

function parseAmount(a: SdkAmount): Money {
  if (!isPayPalCurrency(a.currencyCode)) {
    throw new PayPalError(`unsupported currency ${a.currencyCode}`, 502, "UNSUPPORTED_CURRENCY");
  }
  return fromPayPalValue(a.value, a.currencyCode);
}

/** The SDK lower-cases some header names; send them as PayPal documents them (HTTP ignores case). */
function canonicalHeader(name: string): string {
  return name
    .split("-")
    .map((p) => (p.toLowerCase() === "paypal" ? "PayPal" : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("-");
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** PayPal error JSON (REST or OAuth shape) to PayPalError with issue and debug id. */
function toPayPalError(
  status: number,
  text: string,
  header: (name: string) => string | undefined,
): PayPalError {
  const err = parseJson(text) as {
    name?: string;
    message?: string;
    error?: string;
    error_description?: string;
    debug_id?: string;
    details?: { issue?: string }[];
  };
  return new PayPalError(
    err.message ?? err.error_description ?? `PayPal HTTP ${status}`,
    status,
    err.details?.[0]?.issue ?? err.name ?? err.error,
    err.debug_id ?? header("paypal-debug-id") ?? undefined,
  );
}
