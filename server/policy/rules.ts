// server/policy/rules.ts: the deterministic lock ("el cerrojo") — a pure decide(action, context).
// The AI agent only proposes; this function decides whether money may move. No I/O, no clock reads,
// fail-closed on anything malformed. Reasons are es-MX because they get spoken to the vendor.
import type { Currency, Money } from "../../shared/money";

export type Actor = "vendor" | "agent" | "customer";

export type PolicyAction =
  | {
      kind: "refund";
      saleId: string;
      captureId: string;
      amount: Money;
      capturedAt: string;
      capturedAmount: Money;
      alreadyRefunded: Money;
    }
  | { kind: "payout"; recipient: string; amount: Money }
  | { kind: "accept_dispute"; disputeId: string }
  | { kind: "create_order" | "create_invoice"; amount: Money };

export interface PolicyConfig {
  currency: Currency;
  maxRefund: Money;
  maxRefundPerDay: Money;
  /** IANA zone that defines "today" for refunds and daily caps. */
  timeZone: string;
  payoutAllowlist: string[];
  maxPayoutPerDay: Money;
}

export interface PolicyContext {
  actor: Actor;
  pinVerified: boolean;
  now: Date;
  refundedToday: Money;
  paidOutToday: Money;
  config: PolicyConfig;
  /** Spoken in reasons, e.g. "Solo Rosa puede autorizar devoluciones". */
  vendorName: string;
}

export interface Decision {
  allow: boolean;
  reason: string;
  code: string;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = Object.freeze({
  currency: "MXN",
  maxRefund: Object.freeze({ minor: 20000, currency: "MXN" }),
  maxRefundPerDay: Object.freeze({ minor: 100000, currency: "MXN" }),
  timeZone: "America/Mexico_City",
  payoutAllowlist: Object.freeze([]) as unknown as string[],
  maxPayoutPerDay: Object.freeze({ minor: 50000, currency: "MXN" }),
}) as PolicyConfig;

const CURRENCIES: readonly Currency[] = ["MXN", "USD"];
const CLOCK_SKEW_MS = 60_000;

export function decide(action: PolicyAction, context: PolicyContext): Decision {
  try {
    return decideUnsafe(action, context);
  } catch {
    return deny("POLICY_ERROR", "No pude validar la operación; por seguridad no se hace.");
  }
}

function decideUnsafe(action: PolicyAction, ctx: PolicyContext): Decision {
  if (!action || typeof action !== "object")
    return deny("MALFORMED_ACTION", "No entendí la operación; no se hace nada.");
  if (!isActor(ctx.actor))
    return deny("UNKNOWN_ACTOR", "No sé quién pide la operación; no se hace nada.");

  switch (action.kind) {
    case "refund":
      return decideRefund(action, ctx);
    case "payout":
      return decidePayout(action, ctx);
    case "accept_dispute":
      return deny(
        "DISPUTE_MANUAL_ONLY",
        `Las disputas las decide ${name(ctx)} a mano, fuera del asistente.`,
      );
    case "create_order":
    case "create_invoice":
      return decideCharge(action, ctx);
    default:
      return deny("UNKNOWN_ACTION", "Esa operación no existe; no se hace nada.");
  }
}

function decideRefund(a: Extract<PolicyAction, { kind: "refund" }>, ctx: PolicyContext): Decision {
  const cfg = ctx.config;
  const gate = moneyOutGate(ctx, "devoluciones", `y el máximo es ${speak(cfg.maxRefund)}`);
  if (gate) return gate;

  if (!isPositiveMoney(a.amount))
    return deny("INVALID_AMOUNT", "El monto no es válido; tiene que ser mayor a cero.");
  if (
    !isMoney(a.capturedAmount) ||
    !isMoney(a.alreadyRefunded) ||
    a.alreadyRefunded.minor < 0 ||
    typeof a.captureId !== "string" ||
    a.captureId.length === 0
  )
    return deny("MALFORMED_ACTION", "Los datos del cobro no están completos; no se devuelve nada.");
  if (
    !sameCurrency(
      cfg.currency,
      a.amount,
      a.capturedAmount,
      a.alreadyRefunded,
      ctx.refundedToday,
      cfg.maxRefund,
      cfg.maxRefundPerDay,
    )
  )
    return deny("CURRENCY_MISMATCH", "La moneda no coincide con la del cobro; no se devuelve.");

  if (a.amount.minor > cfg.maxRefund.minor)
    return deny(
      "REFUND_OVER_CAP",
      `El máximo por devolución es ${speak(cfg.maxRefund)}; pediste ${speak(a.amount)}.`,
    );

  const refundable = a.capturedAmount.minor - a.alreadyRefunded.minor;
  if (a.amount.minor > refundable)
    return deny(
      "REFUND_EXCEEDS_CAPTURE",
      refundable > 0
        ? `No se puede devolver más de lo cobrado: de ese cobro quedan ${speak(withMinor(a.amount, refundable))}.`
        : "Ese cobro ya se devolvió completo.",
    );

  const capturedAt = Date.parse(a.capturedAt);
  if (typeof a.capturedAt !== "string" || Number.isNaN(capturedAt))
    return deny("MALFORMED_ACTION", "No sé cuándo fue ese cobro; no se devuelve.");
  if (
    capturedAt > ctx.now.getTime() + CLOCK_SKEW_MS ||
    localDay(new Date(capturedAt), cfg.timeZone) !== localDay(ctx.now, cfg.timeZone)
  )
    return deny("CAPTURE_NOT_TODAY", "Solo se pueden devolver cobros de hoy.");

  const projected = ctx.refundedToday.minor + a.amount.minor;
  if (ctx.refundedToday.minor < 0 || projected > cfg.maxRefundPerDay.minor) {
    const left = Math.max(0, cfg.maxRefundPerDay.minor - ctx.refundedToday.minor);
    return deny(
      "REFUND_DAILY_CAP",
      `El tope de devoluciones del día es ${speak(cfg.maxRefundPerDay)}; hoy quedan ${speak(withMinor(a.amount, left))}.`,
    );
  }

  return allow("REFUND_OK", `Devolución autorizada por ${speak(a.amount)}.`);
}

function decidePayout(a: Extract<PolicyAction, { kind: "payout" }>, ctx: PolicyContext): Decision {
  const cfg = ctx.config;
  const gate = moneyOutGate(ctx, "pagos", `y el tope del día es ${speak(cfg.maxPayoutPerDay)}`);
  if (gate) return gate;

  if (!isPositiveMoney(a.amount))
    return deny("INVALID_AMOUNT", "El monto no es válido; tiene que ser mayor a cero.");
  if (!sameCurrency(cfg.currency, a.amount, ctx.paidOutToday, cfg.maxPayoutPerDay))
    return deny("CURRENCY_MISMATCH", "La moneda no coincide con la de la cuenta; no se paga.");

  const recipient = normalizeRecipient(a.recipient);
  const allowed = new Set(cfg.payoutAllowlist.map(normalizeRecipient));
  if (!recipient || !allowed.has(recipient))
    return deny(
      "PAYOUT_NOT_ALLOWLISTED",
      `Ese destinatario no está en la lista de ${name(ctx)}; no se paga.`,
    );

  if (
    ctx.paidOutToday.minor < 0 ||
    ctx.paidOutToday.minor + a.amount.minor > cfg.maxPayoutPerDay.minor
  ) {
    const left = Math.max(0, cfg.maxPayoutPerDay.minor - ctx.paidOutToday.minor);
    return deny(
      "PAYOUT_DAILY_CAP",
      `El tope de pagos del día es ${speak(cfg.maxPayoutPerDay)}; hoy quedan ${speak(withMinor(a.amount, left))}.`,
    );
  }

  return allow("PAYOUT_OK", `Pago autorizado por ${speak(a.amount)}.`);
}

function decideCharge(
  a: Extract<PolicyAction, { kind: "create_order" | "create_invoice" }>,
  ctx: PolicyContext,
): Decision {
  if (!isPositiveMoney(a.amount))
    return deny("INVALID_AMOUNT", "El monto no es válido; tiene que ser mayor a cero.");
  if (a.amount.currency !== ctx.config.currency)
    return deny("CURRENCY_MISMATCH", "La moneda no coincide con la de la cuenta.");
  return allow(
    a.kind === "create_order" ? "ORDER_OK" : "INVOICE_OK",
    a.kind === "create_order"
      ? `Cobro por ${speak(a.amount)} listo.`
      : `Factura por ${speak(a.amount)} lista.`,
  );
}

/** Who may move money out at all: only the vendor, and only with a verified PIN. */
function moneyOutGate(ctx: PolicyContext, what: string, limit: string): Decision | undefined {
  if (ctx.actor === "customer")
    return deny(
      "CUSTOMER_NOT_AUTHORIZED",
      `Los ${what} los autoriza solo ${name(ctx)}, no el cliente.`,
    );
  if (ctx.actor !== "vendor")
    return deny("VENDOR_REQUIRED", `Solo ${name(ctx)} puede autorizar ${what}, ${limit}.`);
  if (ctx.pinVerified !== true)
    return deny(
      "PIN_REQUIRED",
      `Para autorizar ${what}, ${name(ctx)} tiene que confirmar con su PIN.`,
    );
  return undefined;
}

/** "YYYY-MM-DD" of `d` in the given IANA zone. Throws on an unknown zone (decide fails closed). */
export function localDay(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Spoken amount: 20000 MXN -> "200 pesos", 1050 -> "10 pesos con 50 centavos". */
export function speak(m: Money): string {
  const unit = m.currency === "USD" ? "dólares" : "pesos";
  const abs = Math.abs(m.minor);
  const units = Math.trunc(abs / 100);
  const cents = abs % 100;
  const sign = m.minor < 0 ? "menos " : "";
  return cents === 0 ? `${sign}${units} ${unit}` : `${sign}${units} ${unit} con ${cents} centavos`;
}

function isActor(x: unknown): x is Actor {
  return x === "vendor" || x === "agent" || x === "customer";
}

function isMoney(x: unknown): x is Money {
  if (!x || typeof x !== "object") return false;
  const m = x as Money;
  return Number.isSafeInteger(m.minor) && CURRENCIES.includes(m.currency);
}

function isPositiveMoney(x: unknown): x is Money {
  return isMoney(x) && x.minor > 0;
}

function sameCurrency(currency: Currency, ...ms: unknown[]): boolean {
  return ms.every((m) => isMoney(m) && m.currency === currency);
}

function normalizeRecipient(r: unknown): string {
  return typeof r === "string" ? r.trim().toLowerCase() : "";
}

function withMinor(m: Money, minor: number): Money {
  return { minor, currency: m.currency };
}

function name(ctx: PolicyContext): string {
  return typeof ctx.vendorName === "string" && ctx.vendorName.trim()
    ? ctx.vendorName.trim()
    : "la vendedora";
}

function allow(code: string, reason: string): Decision {
  return { allow: true, code, reason };
}

function deny(code: string, reason: string): Decision {
  return { allow: false, code, reason };
}
