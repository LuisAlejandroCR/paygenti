// server/policy/rules.ts: the deterministic lock ("el cerrojo") — a pure decide(action, context).
// The AI agent only proposes; this function decides whether money may move. No I/O, no clock reads,
// fail-closed on anything malformed. `code` + `params` are the stable machine contract (the web
// localizes them); `reason` is the es-MX sentence spoken to the vendor and kept in the audit log.
import { decimalsOf, isPayPalCurrency } from "../../shared/currency";
import { type Currency, formatMoney, type Money } from "../../shared/money";

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

export type DecisionParams = Record<string, string | number>;

export interface Decision {
  allow: boolean;
  reason: string;
  /** Stable machine code, e.g. REFUND_OVER_CAP; clients map it to localized text. */
  code: string;
  /** Values for the localized text; money is pre-formatted with formatMoney (e.g. "$200.00"). */
  params?: DecisionParams;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = Object.freeze({
  currency: "MXN",
  maxRefund: Object.freeze({ minor: 20000, currency: "MXN" }),
  maxRefundPerDay: Object.freeze({ minor: 100000, currency: "MXN" }),
  timeZone: "America/Mexico_City",
  payoutAllowlist: Object.freeze([]) as unknown as string[],
  maxPayoutPerDay: Object.freeze({ minor: 50000, currency: "MXN" }),
}) as PolicyConfig;

/**
 * Default caps per charge currency, in whole units: [max per refund, refunds per day, payouts per day].
 * MXN keeps the original 200 / 1,000 / 500; the others are set at or below that in value (never looser).
 */
const CAPS: Record<Currency, readonly [number, number, number]> = {
  MXN: [200, 1000, 500],
  USD: [10, 50, 25],
  EUR: [10, 50, 25],
  CAD: [15, 70, 35],
  GBP: [8, 40, 20],
  CHF: [10, 45, 22],
  AUD: [15, 80, 40],
  NZD: [15, 80, 40],
  BRL: [50, 250, 125],
  SEK: [100, 500, 250],
  NOK: [100, 500, 250],
  DKK: [70, 350, 175],
  PLN: [40, 200, 100],
  CZK: [250, 1200, 600],
  HUF: [3500, 18000, 9000],
  JPY: [1500, 7500, 3750],
  HKD: [80, 400, 200],
  SGD: [13, 65, 32],
  TWD: [300, 1500, 750],
  THB: [350, 1700, 850],
  PHP: [550, 2800, 1400],
  MYR: [45, 230, 115],
  CNY: [70, 350, 175],
  ILS: [35, 180, 90],
};

/** Policy caps for a currency (and zone); the payout allowlist is kept by the caller. */
export function policyCapsFor(
  currency: Currency,
): Pick<PolicyConfig, "currency" | "maxRefund" | "maxRefundPerDay" | "maxPayoutPerDay"> {
  const [refund, perDay, payout] = CAPS[currency];
  const scale = 10 ** decimalsOf(currency);
  const m = (units: number): Money => Object.freeze({ minor: units * scale, currency });
  return { currency, maxRefund: m(refund), maxRefundPerDay: m(perDay), maxPayoutPerDay: m(payout) };
}
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
        { vendor: name(ctx) },
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
  const gate = moneyOutGate(ctx, "refunds", `y el máximo es ${speak(cfg.maxRefund)}`, {
    limit: formatMoney(cfg.maxRefund),
  });
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
      { max: formatMoney(cfg.maxRefund), amount: formatMoney(a.amount) },
    );

  const refundable = a.capturedAmount.minor - a.alreadyRefunded.minor;
  if (a.amount.minor > refundable)
    return deny(
      "REFUND_EXCEEDS_CAPTURE",
      refundable > 0
        ? `No se puede devolver más de lo cobrado: de ese cobro quedan ${speak(withMinor(a.amount, refundable))}.`
        : "Ese cobro ya se devolvió completo.",
      { left: formatMoney(withMinor(a.amount, Math.max(0, refundable))) },
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
      { max: formatMoney(cfg.maxRefundPerDay), left: formatMoney(withMinor(a.amount, left)) },
    );
  }

  return allow("REFUND_OK", `Devolución autorizada por ${speak(a.amount)}.`, {
    amount: formatMoney(a.amount),
  });
}

function decidePayout(a: Extract<PolicyAction, { kind: "payout" }>, ctx: PolicyContext): Decision {
  const cfg = ctx.config;
  const gate = moneyOutGate(ctx, "payouts", `y el tope del día es ${speak(cfg.maxPayoutPerDay)}`, {
    limit: formatMoney(cfg.maxPayoutPerDay),
  });
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
      { vendor: name(ctx) },
    );

  if (
    ctx.paidOutToday.minor < 0 ||
    ctx.paidOutToday.minor + a.amount.minor > cfg.maxPayoutPerDay.minor
  ) {
    const left = Math.max(0, cfg.maxPayoutPerDay.minor - ctx.paidOutToday.minor);
    return deny(
      "PAYOUT_DAILY_CAP",
      `El tope de pagos del día es ${speak(cfg.maxPayoutPerDay)}; hoy quedan ${speak(withMinor(a.amount, left))}.`,
      { max: formatMoney(cfg.maxPayoutPerDay), left: formatMoney(withMinor(a.amount, left)) },
    );
  }

  return allow("PAYOUT_OK", `Pago autorizado por ${speak(a.amount)}.`, {
    amount: formatMoney(a.amount),
  });
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
    { amount: formatMoney(a.amount) },
  );
}

/** Who may move money out at all: only the vendor, and only with a verified PIN. */
function moneyOutGate(
  ctx: PolicyContext,
  kind: "refunds" | "payouts",
  limit: string,
  limitParams: DecisionParams,
): Decision | undefined {
  const what = kind === "refunds" ? "devoluciones" : "pagos";
  const params = { vendor: name(ctx), what: kind };
  if (ctx.actor === "customer")
    return deny(
      "CUSTOMER_NOT_AUTHORIZED",
      `Los ${what} los autoriza solo ${name(ctx)}, no el cliente.`,
      params,
    );
  if (ctx.actor !== "vendor")
    return deny("VENDOR_REQUIRED", `Solo ${name(ctx)} puede autorizar ${what}, ${limit}.`, {
      ...params,
      ...limitParams,
    });
  if (ctx.pinVerified !== true)
    return deny(
      "PIN_REQUIRED",
      `Para autorizar ${what}, ${name(ctx)} tiene que confirmar con su PIN.`,
      params,
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

const SPOKEN_ES: Partial<Record<Currency, string>> = {
  MXN: "pesos",
  USD: "dólares",
  CAD: "dólares canadienses",
  AUD: "dólares australianos",
  EUR: "euros",
  BRL: "reales",
  GBP: "libras",
  JPY: "yenes",
};

/** Spoken amount: 20000 MXN -> "200 pesos", 1050 -> "10 pesos con 50 centavos", 950 JPY -> "950 yenes". */
export function speak(m: Money): string {
  const unit = SPOKEN_ES[m.currency] ?? m.currency;
  const abs = Math.abs(m.minor);
  const base = 10 ** decimalsOf(m.currency);
  const units = Math.trunc(abs / base);
  const cents = abs % base;
  const sign = m.minor < 0 ? "menos " : "";
  return cents === 0 ? `${sign}${units} ${unit}` : `${sign}${units} ${unit} con ${cents} centavos`;
}

function isActor(x: unknown): x is Actor {
  return x === "vendor" || x === "agent" || x === "customer";
}

function isMoney(x: unknown): x is Money {
  if (!x || typeof x !== "object") return false;
  const m = x as Money;
  return Number.isSafeInteger(m.minor) && isPayPalCurrency(m.currency);
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

function allow(code: string, reason: string, params?: DecisionParams): Decision {
  return { allow: true, code, reason, ...(params && { params }) };
}

function deny(code: string, reason: string, params?: DecisionParams): Decision {
  return { allow: false, code, reason, ...(params && { params }) };
}
