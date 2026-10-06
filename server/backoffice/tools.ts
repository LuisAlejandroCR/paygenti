// server/backoffice/tools.ts: the vendor's back-office tools — today's sales, cash reconcile,
// invoice with QR and refund. Reports are deterministic arithmetic over the store; refunds and
// invoices always pass through the PolicyEngine (the lock) before PayPal is called.
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { type Money, money } from "../../shared/money";
import type { Sale } from "../../shared/types";
import { PayPalError, type PayPalGateway } from "../paypal/gateway";
import { type Actor, localDay, type PolicyEngine } from "../policy";
import type { SalesService } from "../sales";

export interface SalesTodayReport {
  day: string;
  count: number;
  total: Money;
  refunded: Money;
  sales: Array<{
    id: string;
    paidAt: string;
    total: Money;
    status: Sale["status"];
    refunded: Money;
    items: string;
  }>;
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
}

export type RefundResult =
  | { ok: true; refundId: string; amount: Money; reason: string }
  | { ok: false; code: string; reason: string };

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
  private readonly clock: () => number;
  /** Refunded minor units per capture id (committed refunds only). */
  private readonly refundedByCapture = new Map<string, number>();

  constructor(deps: BackOfficeDeps) {
    this.sales = deps.sales;
    this.paypal = deps.paypal;
    this.policy = deps.policy;
    this.clock = deps.clock ?? Date.now;
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
    const rows = paid.map((s) => {
      const r = (s.captureId && this.refundedByCapture.get(s.captureId)) || 0;
      total += s.total.minor;
      refunded += r;
      return {
        id: s.id,
        paidAt: s.paidAt ?? s.createdAt,
        total: s.total,
        status: s.status,
        refunded: money(r, currency),
        items: s.lines.map((l) => `${l.qty} × ${l.name}`).join(", "),
      };
    });
    return {
      day: this.today(),
      count: rows.length,
      total: money(total, currency),
      refunded: money(refunded, currency),
      sales: rows,
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
      throw new BackOfficeError(decision.code, decision.reason);
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
    const already = this.refundedByCapture.get(sale.captureId) ?? 0;
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
      { actor: who.actor, pin: who.pin },
    );
    if (!decision.allow || !decision.ticket)
      return { ok: false, code: decision.code, reason: decision.reason };
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
      const total = already + req.amount.minor;
      this.refundedByCapture.set(sale.captureId, total);
      if (total >= sale.total.minor) this.sales.store.saveSale({ ...sale, status: "refunded" });
      return { ok: true, refundId: refund.id, amount: req.amount, reason: decision.reason };
    } catch (err) {
      this.policy.release(decision.ticket);
      if (err instanceof PayPalError)
        return { ok: false, code: "REFUND_FAILED", reason: "PayPal no aceptó la devolución." };
      throw err;
    }
  }
}

export class BackOfficeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BackOfficeError";
  }
}
