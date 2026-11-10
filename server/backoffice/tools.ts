// server/backoffice/tools.ts: the vendor's back-office tools — today's sales, cash reconcile,
// invoice with QR, refund and payouts to suppliers (server/backoffice/payouts.ts). Reports are
// deterministic arithmetic over the store; refunds, payouts and invoices always pass through the
// PolicyEngine (the lock) before PayPal is called.
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { type Money, money } from "../../shared/money";
import type { Payout, Sale } from "../../shared/types";
import type { PassportSale } from "../passport";
import { PayPalError, type PayPalGateway } from "../paypal/gateway";
import { type Actor, type DecisionParams, localDay, type PolicyEngine } from "../policy";
import type { SalesService } from "../sales";
import { isMoneyOut, PayoutDesk } from "./payouts";

/** A day's sales in a currency other than the stall's current one: listed apart, never summed in. */
export interface OtherCurrencyTotal {
  currency: Money["currency"];
  count: number;
  paid: Money;
  refunded: Money;
  net: Money;
}

export interface SalesTodayReport {
  day: string;
  /** count, total and refunded cover only the stall's current currency. */
  count: number;
  total: Money;
  refunded: Money;
  /** Sales that day in other currencies (the vendor switched currency): never added to total. */
  others: OtherCurrencyTotal[];
  sales: Array<{
    id: string;
    paidAt: string;
    total: Money;
    status: Sale["status"];
    refunded: Money;
    items: string;
  }>;
}

export type Reconciliation =
  | "matched"
  | "missing_capture"
  | "partial_refund"
  | "refunded"
  | "pending"
  | "void"
  | "cash"
  /** Push rail (Pix, SPEI, Bre-B) the vendor confirmed with her PIN: not verified, not in paid. */
  | "vendor_confirmed";

export interface LedgerRow {
  id: string;
  kind: "sale" | "refund";
  method: Sale["method"];
  status: Sale["status"];
  terminalId: string;
  orderId: string;
  captureId: string | null;
  createdAt: string;
  paidAt: string | null;
  total: Money;
  paid: Money;
  refunded: Money;
  net: Money;
  items: string;
  lines: Array<{ sku: string; name: string; qty: number; unitPrice: Money; subtotal: Money }>;
  reconciliation: Reconciliation;
}

export interface LedgerReport {
  day: string;
  terminals: string[];
  rows: LedgerRow[];
  totals: {
    paid: Money;
    refunded: Money;
    net: Money;
    cash: Money;
    count: number;
    /** Vendor-confirmed push-rail sales: shown apart, never in paid or net. */
    unverified: Money;
  };
  /** Money out to suppliers that day: a separate section, never mixed into the sales totals. */
  payouts: Payout[];
  /** Sum of the day's payouts that left the account (excludes denied, failed, returned...). */
  paidOut: Money;
  /** Settled rows in other currencies (currency switched that day): never mixed into totals. */
  others: OtherCurrencyTotal[];
}

export interface CashReconcile {
  day: string;
  paypal: Money;
  paypalCount: number;
  refunded: Money;
  paypalNet: Money;
  cash: Money;
  total: Money;
}

export interface InvoiceResult {
  id: string;
  amount: Money;
  payUrl: string;
  /** data: URL of the QR image (PayPal's PNG in sandbox, generated locally in mock mode). */
  qr: string;
}

export interface RefundRequest {
  saleId: string;
  amount: Money;
}

/** Who asks and with which PIN. The PIN only ever comes from the human's HTTP request. */
export interface Authority {
  actor: Actor;
  pin?: string;
  /** Client keys (IP, hashed session) that PIN failures are counted against. */
  client?: readonly string[];
}

export type RefundResult =
  | {
      ok: true;
      refundId: string;
      amount: Money;
      code: string;
      reason: string;
      params?: DecisionParams;
    }
  | { ok: false; code: string; reason: string; params?: DecisionParams };

export interface BackOfficeDeps {
  sales: SalesService;
  paypal: PayPalGateway;
  policy: PolicyEngine;
  clock?: () => number;
}

export class BackOffice {
  private readonly sales: SalesService;
  private readonly paypal: PayPalGateway;
  readonly policy: PolicyEngine;
  readonly payouts: PayoutDesk;
  private readonly clock: () => number;

  /** "mock" or "sandbox": the payouts panel warns that the sandbox has no PHONE payouts. */
  get paypalMode(): PayPalGateway["mode"] {
    return this.paypal.mode;
  }

  constructor(deps: BackOfficeDeps) {
    this.sales = deps.sales;
    this.paypal = deps.paypal;
    this.policy = deps.policy;
    this.clock = deps.clock ?? Date.now;
    this.payouts = new PayoutDesk({
      store: deps.sales.store,
      paypal: deps.paypal,
      policy: deps.policy,
      clock: this.clock,
    });
  }

  private today(): string {
    return localDay(new Date(this.clock()), this.policy.config.timeZone);
  }

  private paidToday(): Sale[] {
    const day = this.today();
    return this.sales.store
      .allSales()
      .filter(
        (s) =>
          (s.status === "paid" || s.status === "refunded") &&
          s.paidAt !== undefined &&
          localDay(new Date(s.paidAt), this.policy.config.timeZone) === day,
      );
  }

  salesToday(): SalesTodayReport {
    const currency = this.policy.config.currency;
    const paid = this.paidToday();
    let total = 0;
    let refunded = 0;
    let count = 0;
    const rows = paid.map((s) => {
      const r = (s.captureId && this.sales.store.refundedForCapture(s.captureId)) || 0;
      if (s.total.currency === currency) {
        total += s.total.minor;
        refunded += r;
        count += 1;
      }
      return {
        id: s.id,
        paidAt: s.paidAt ?? s.createdAt,
        total: s.total,
        status: s.status,
        refunded: money(r, s.total.currency),
        items: s.lines.map((l) => `${l.qty} × ${l.name}`).join(", "),
      };
    });
    return {
      day: this.today(),
      count,
      total: money(total, currency),
      refunded: money(refunded, currency),
      others: otherCurrencies(
        rows.map((r) => ({ total: r.total, paid: r.total, refunded: r.refunded })),
        currency,
      ),
      sales: rows,
    };
  }

  /** Every sale touched on `day` (local time zone): paid, open, failed or refunded, with lines. */
  ledger(day: string = this.today()): LedgerReport {
    const tz = this.policy.config.timeZone;
    const c = this.policy.config.currency;
    const all = this.sales.store.allSales();
    const rows: LedgerRow[] = all
      .filter((s) => localDay(new Date(s.paidAt ?? s.createdAt), tz) === day)
      .map((s) => this.ledgerRow(s))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    // Totals cover the stall's current currency only; a day with a currency switch lists the rest apart.
    const sum = (f: (r: LedgerRow) => number) =>
      rows.reduce((n, r) => n + (r.total.currency === c ? f(r) : 0), 0);
    const paid = sum((r) => (r.method === "paypal" ? r.paid.minor : 0));
    const cash = sum((r) => (r.method === "cash" ? r.paid.minor : 0));
    const refunded = sum((r) => r.refunded.minor);
    const unverified = sum((r) => (r.reconciliation === "vendor_confirmed" ? r.total.minor : 0));
    const terminals = [...new Set(all.map((s) => s.terminalId))].sort();
    const payouts = this.payouts.forDay(day);
    const paidOut = payouts
      .filter((p) => isMoneyOut(p.status) && p.amount.currency === c)
      .reduce((n, p) => n + p.amount.minor, 0);
    return {
      day,
      terminals,
      rows,
      totals: {
        paid: money(paid, c),
        refunded: money(refunded, c),
        net: money(paid + cash - refunded, c),
        cash: money(cash, c),
        count: rows.filter((r) => r.paid.minor > 0 && r.total.currency === c).length,
        unverified: money(unverified, c),
      },
      payouts,
      paidOut: money(paidOut, c),
      others: otherCurrencies(
        rows.filter((r) => r.paid.minor > 0 && r.method !== "cash"),
        c,
      ),
    };
  }

  /** The stall's local day right now (its time zone), so clients never trust the phone's clock. */
  currentDay(): string {
    return this.today();
  }

  /** Every settled sale reduced to day, method and amounts (sales passport input; no buyer data). */
  passportSales(): PassportSale[] {
    const tz = this.policy.config.timeZone;
    return this.sales.store
      .allSales()
      .filter(
        (s) =>
          (s.status === "paid" || s.status === "refunded" || s.status === "vendor_confirmed") &&
          s.paidAt !== undefined,
      )
      .map((s) => {
        const r = this.ledgerRow(s);
        return {
          day: localDay(new Date(s.paidAt ?? s.createdAt), tz),
          method: s.method,
          captured: s.method === "paypal" && !!s.captureId,
          vendorConfirmed: s.status === "vendor_confirmed",
          total: s.total.minor,
          refunded: r.refunded.minor,
          currency: s.total.currency,
        };
      });
  }

  private ledgerRow(s: Sale): LedgerRow {
    const c = s.total.currency;
    const settled = s.status === "paid" || s.status === "refunded";
    const paid = settled ? s.total.minor : 0;
    let refunded = (s.captureId && this.sales.store.refundedForCapture(s.captureId)) || 0;
    if (s.status === "refunded" && refunded === 0) refunded = s.total.minor;
    let reconciliation: Reconciliation;
    if (s.status === "vendor_confirmed") reconciliation = "vendor_confirmed";
    else if (!settled)
      reconciliation =
        s.status === "open" || s.status === "approved" || s.status === "pending_bank"
          ? "pending"
          : "void";
    else if (s.method === "cash") reconciliation = "cash";
    else if (!s.captureId) reconciliation = "missing_capture";
    else if (refunded >= s.total.minor) reconciliation = "refunded";
    else if (refunded > 0) reconciliation = "partial_refund";
    else reconciliation = "matched";
    return {
      id: s.id,
      kind: refunded > 0 ? "refund" : "sale",
      method: s.method,
      status: s.status,
      terminalId: s.terminalId,
      orderId: s.orderId,
      captureId: s.captureId ?? null,
      createdAt: s.createdAt,
      paidAt: s.paidAt ?? null,
      total: s.total,
      paid: money(paid, c),
      refunded: money(refunded, c),
      net: money(paid - refunded, c),
      items: s.lines.map((l) => `${l.qty} × ${l.name}`).join(", "),
      lines: s.lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        subtotal: money(l.unitPrice.minor * l.qty, c),
      })),
      reconciliation,
    };
  }

  /** Deterministic: PayPal captured today − refunds + cash the vendor dictates. */
  cashReconcile(cashMinor: number): CashReconcile {
    if (!Number.isSafeInteger(cashMinor) || cashMinor < 0 || cashMinor > 100_000_000)
      throw new RangeError("cash must be a non-negative integer of centavos");
    const report = this.salesToday();
    const c = this.policy.config.currency;
    const net = report.total.minor - report.refunded.minor;
    return {
      day: report.day,
      paypal: report.total,
      paypalCount: report.count,
      refunded: report.refunded,
      paypalNet: money(net, c),
      cash: money(cashMinor, c),
      total: money(net + cashMinor, c),
    };
  }

  async createInvoice(amount: Money, description: string, who: Authority): Promise<InvoiceResult> {
    const decision = this.policy.decide({ kind: "create_invoice", amount }, { actor: who.actor });
    if (!decision.allow || !decision.ticket)
      throw new BackOfficeError(decision.code, decision.reason, decision.params);
    try {
      const inv = await this.paypal.createInvoice({
        amount,
        description: description.trim().slice(0, 200) || "Venta",
        idempotencyKey: `invoice:${randomUUID()}`,
      });
      this.policy.commit(decision.ticket);
      const qr = inv.qrPngBase64
        ? `data:image/png;base64,${inv.qrPngBase64}`
        : await QRCode.toDataURL(inv.payUrl, { margin: 1, width: 300 });
      return { id: inv.id, amount: inv.amount, payUrl: inv.payUrl, qr };
    } catch (err) {
      this.policy.release(decision.ticket);
      throw err;
    }
  }

  /** The only path that moves money out. Policy decides; PayPal runs only on an allow. */
  async refund(req: RefundRequest, who: Authority): Promise<RefundResult> {
    const sale = this.sales.getSale(req.saleId);
    if (!sale || !sale.captureId || !sale.paidAt || sale.status !== "paid")
      return {
        ok: false,
        code: "SALE_NOT_REFUNDABLE",
        reason: "Esa venta no tiene un cobro pagado.",
      };
    const already = this.sales.store.refundedForCapture(sale.captureId);
    const decision = this.policy.decide(
      {
        kind: "refund",
        saleId: sale.id,
        captureId: sale.captureId,
        amount: req.amount,
        capturedAt: sale.paidAt,
        capturedAmount: sale.total,
        alreadyRefunded: money(already, sale.total.currency),
      },
      { actor: who.actor, pin: who.pin, client: who.client },
    );
    if (!decision.allow || !decision.ticket)
      return { ok: false, code: decision.code, reason: decision.reason, params: decision.params };
    try {
      const refund = await this.paypal.refundCapture(
        sale.captureId,
        req.amount,
        `${sale.id}:refund:${decision.ticket}`,
      );
      if (refund.status === "CANCELLED" || refund.status === "FAILED") {
        this.policy.release(decision.ticket);
        return { ok: false, code: "REFUND_FAILED", reason: "PayPal no aceptó la devolución." };
      }
      this.policy.commit(decision.ticket);
      const total = this.sales.store.addRefund(sale.captureId, req.amount.minor);
      if (total >= sale.total.minor) this.sales.store.saveSale({ ...sale, status: "refunded" });
      return {
        ok: true,
        refundId: refund.id,
        amount: req.amount,
        code: decision.code,
        reason: decision.reason,
        params: decision.params,
      };
    } catch (err) {
      this.policy.release(decision.ticket);
      if (err instanceof PayPalError)
        return { ok: false, code: "REFUND_FAILED", reason: "PayPal no aceptó la devolución." };
      throw err;
    }
  }
}

/** Per-currency totals of the rows not in `current`, in first-seen order. */
function otherCurrencies(
  rows: Array<{ total: Money; paid: Money; refunded: Money }>,
  current: string,
): OtherCurrencyTotal[] {
  const by = new Map<Money["currency"], { count: number; paid: number; refunded: number }>();
  for (const r of rows) {
    const cur = r.total.currency;
    if (cur === current) continue;
    const t = by.get(cur) ?? { count: 0, paid: 0, refunded: 0 };
    t.count += 1;
    t.paid += r.paid.minor;
    t.refunded += r.refunded.minor;
    by.set(cur, t);
  }
  return [...by].map(([currency, t]) => ({
    currency,
    count: t.count,
    paid: money(t.paid, currency),
    refunded: money(t.refunded, currency),
    net: money(t.paid - t.refunded, currency),
  }));
}

export class BackOfficeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly params?: DecisionParams,
  ) {
    super(message);
    this.name = "BackOfficeError";
  }
}
