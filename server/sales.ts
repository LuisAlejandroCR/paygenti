// server/sales.ts: the sale lifecycle — create (one open sale per terminal, 5 min TTL), capture
// (idempotent, server-confirmed), cancel (refused once a capture started), webhook updates, and a
// per-terminal event bus feeding SSE.
// Only this service changes a sale's status; routes and webhooks go through it.
import { randomUUID } from "node:crypto";
import { addMoney, fromPayPalValue, type Money, money } from "../shared/money";
import type { CartLine, Sale, TerminalEvent, Vendor } from "../shared/types";
import { PayPalError, type PayPalGateway } from "./paypal/gateway";
import type { Store } from "./store";

export type Clock = () => number;
export type CreateSaleInput = { lines: { sku: string; qty: number }[] } | { amount: number };
type Listener = (event: TerminalEvent) => void;

export const SALE_TTL_MS = 5 * 60 * 1000;
const DECLINE_ISSUES = new Set([
  "INSTRUMENT_DECLINED",
  "TRANSACTION_REFUSED",
  "PAYER_CANNOT_PAY",
  "PAYEE_BLOCKED_TRANSACTION",
]);

export class SaleError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "SaleError";
  }
}

export interface SalesDeps {
  store: Store;
  paypal: PayPalGateway;
  clock?: Clock;
  ttlMs?: number;
}

export interface WebhookEvent {
  event_type: string;
  resource: Record<string, unknown>;
}

export class SalesService {
  readonly store: Store;
  private readonly paypal: PayPalGateway;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly inflight = new Map<string, Promise<Sale>>();
  private readonly terminalQueue = new Map<string, Promise<unknown>>();

  constructor(deps: SalesDeps) {
    this.store = deps.store;
    this.paypal = deps.paypal;
    this.clock = deps.clock ?? Date.now;
    this.ttlMs = deps.ttlMs ?? SALE_TTL_MS;
  }

  subscribe(terminalId: string, fn: Listener): () => void {
    let set = this.listeners.get(terminalId);
    if (!set) {
      set = new Set();
      this.listeners.set(terminalId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** Applies expiry lazily: an open sale past its TTL becomes expired on first read. */
  getSale(id: string): Sale | undefined {
    const sale = this.store.getSale(id);
    return sale && this.refresh(sale);
  }

  openSale(terminalId: string): Sale | undefined {
    for (const s of this.store.salesForTerminal(terminalId)) {
      const sale = this.refresh(s);
      if (isOpen(sale)) return sale;
    }
    return undefined;
  }

  vendorOf(sale: Sale): Vendor | undefined {
    return this.store.getVendor(sale.vendorId);
  }

  createSale(terminalId: string, input: CreateSaleInput): Promise<Sale> {
    const prev = this.terminalQueue.get(terminalId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.doCreate(terminalId, input));
    this.terminalQueue.set(terminalId, next);
    return next;
  }

  /** Idempotent: a paid sale returns as-is; concurrent calls share one PayPal capture. */
  capture(saleId: string): Promise<Sale> {
    const running = this.inflight.get(saleId);
    if (running) return running;
    const p = this.doCapture(saleId).finally(() => this.inflight.delete(saleId));
    this.inflight.set(saleId, p);
    return p;
  }

  /**
   * Vendor cancels an unpaid sale. Race-safe because both checks and the status write happen
   * synchronously: a capture already in flight wins (CAPTURE_IN_PROGRESS), a paid sale stays paid
   * (SALE_ALREADY_PAID), and any capture started afterwards sees "cancelled" and is refused.
   * PayPal Orders v2 has no void for an uncaptured CAPTURE-intent order, so the order is left to
   * lapse; we never capture it.
   */
  cancel(saleId: string): Sale {
    const sale = this.getSale(saleId);
    if (!sale) throw new SaleError("SALE_NOT_FOUND", 404, "unknown sale");
    if (sale.status === "cancelled") return sale;
    if (sale.status === "paid" || sale.status === "refunded")
      throw new SaleError("SALE_ALREADY_PAID", 409, "sale already paid");
    if (!isOpen(sale)) throw new SaleError("SALE_NOT_OPEN", 409, `sale is ${sale.status}`);
    if (this.inflight.has(saleId))
      throw new SaleError("CAPTURE_IN_PROGRESS", 409, "a capture is already running");
    const updated = this.save(sale, { status: "cancelled" });
    this.emit({ type: "sale.cancelled", sale: updated });
    return updated;
  }

  async handleWebhook(event: WebhookEvent): Promise<void> {
    const r = event.resource;
    switch (event.event_type) {
      case "CHECKOUT.ORDER.APPROVED": {
        const sale = typeof r.id === "string" ? this.store.findSaleByOrderId(r.id) : undefined;
        if (sale && isOpen(this.refresh(sale))) await this.capture(sale.id);
        return;
      }
      case "PAYMENT.CAPTURE.COMPLETED": {
        const sale = this.saleForCapture(r);
        if (sale && sale.status !== "paid" && sale.status !== "refunded") {
          this.markPaid(sale, str(r.id));
        }
        return;
      }
      case "PAYMENT.CAPTURE.DENIED": {
        const sale = this.saleForCapture(r);
        if (sale && sale.status !== "refunded" && sale.status !== "failed") {
          this.markFailed(sale, "CAPTURE_DENIED");
        }
        return;
      }
      case "PAYMENT.CAPTURE.REFUNDED": {
        const captureId = upCaptureId(r);
        const sale = captureId ? this.store.findSaleByCaptureId(captureId) : undefined;
        if (!sale || sale.status === "refunded") return;
        const amt = r.amount as { value?: string } | undefined;
        const amount = amt?.value ? fromPayPalValue(amt.value, sale.total.currency) : sale.total;
        const updated = this.save(sale, { status: "refunded" });
        this.emit({ type: "sale.refunded", sale: updated, amount });
        return;
      }
    }
  }

  private async doCreate(terminalId: string, input: CreateSaleInput): Promise<Sale> {
    const terminal = this.store.getTerminal(terminalId);
    const vendor = terminal && this.store.getVendor(terminal.vendorId);
    if (!terminal || !vendor) throw new SaleError("TERMINAL_NOT_FOUND", 404, "unknown terminal");
    const lines = resolveLines(vendor, input);
    const total = lines.reduce<Money>(
      (sum, l) => addMoney(sum, money(l.unitPrice.minor * l.qty, l.unitPrice.currency)),
      money(0, vendor.currency),
    );
    if (total.minor <= 0) throw new SaleError("EMPTY_SALE", 400, "total must be positive");

    for (const s of this.store.salesForTerminal(terminalId)) {
      if (isOpen(s)) this.expire(s);
    }

    const id = randomUUID();
    const now = this.clock();
    const order = await this.paypal.createOrder({
      amount: total,
      lines,
      referenceId: id,
      description: vendor.displayName,
      idempotencyKey: `${id}:create`,
    });
    const sale: Sale = {
      id,
      vendorId: vendor.id,
      terminalId,
      lines,
      total,
      status: "open",
      orderId: order.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      method: "paypal",
    };
    this.store.saveSale(sale);
    this.emit({ type: "sale.open", sale });
    return sale;
  }

  private async doCapture(saleId: string): Promise<Sale> {
    const sale = this.getSale(saleId);
    if (!sale) throw new SaleError("SALE_NOT_FOUND", 404, "unknown sale");
    if (sale.status === "paid" || sale.status === "refunded") return sale;
    if (sale.status === "expired") throw new SaleError("SALE_EXPIRED", 409, "sale expired");
    if (sale.status === "failed") throw new SaleError("SALE_FAILED", 409, "sale failed");
    if (sale.status === "cancelled")
      throw new SaleError("SALE_CANCELLED", 409, "sale was cancelled");
    try {
      const cap = await this.paypal.captureOrder(sale.orderId, `${sale.id}:capture`);
      if (cap.status === "COMPLETED") return this.markPaid(sale, cap.id);
      if (cap.status === "PENDING")
        return this.save(sale, { status: "approved", captureId: cap.id });
      return this.markFailed(sale, cap.status);
    } catch (err) {
      if (err instanceof PayPalError) {
        if (err.issue === "ORDER_ALREADY_CAPTURED") return this.markPaid(sale, sale.captureId);
        if (err.issue === "ORDER_NOT_APPROVED") {
          throw new SaleError("NOT_APPROVED", 409, "payer has not approved yet");
        }
        if (err.issue && DECLINE_ISSUES.has(err.issue)) return this.markFailed(sale, err.issue);
      }
      throw err;
    }
  }

  private refresh(sale: Sale): Sale {
    if (isOpen(sale) && this.clock() >= Date.parse(sale.expiresAt)) return this.expire(sale);
    return sale;
  }

  private expire(sale: Sale): Sale {
    const updated = this.save(sale, { status: "expired" });
    this.emit({ type: "sale.expired", sale: updated });
    return updated;
  }

  private markPaid(sale: Sale, captureId: string | undefined): Sale {
    const current = this.store.getSale(sale.id) ?? sale;
    if (current.status === "paid") return current;
    const updated = this.save(current, {
      status: "paid",
      captureId: captureId ?? current.captureId,
      paidAt: new Date(this.clock()).toISOString(),
    });
    this.emit({ type: "sale.paid", sale: updated });
    return updated;
  }

  private markFailed(sale: Sale, reason: string): Sale {
    const updated = this.save(this.store.getSale(sale.id) ?? sale, { status: "failed" });
    this.emit({ type: "sale.failed", sale: updated, reason });
    return updated;
  }

  private save(sale: Sale, patch: Partial<Sale>): Sale {
    const updated = { ...sale, ...patch };
    this.store.saveSale(updated);
    return updated;
  }

  private emit(event: TerminalEvent): void {
    for (const fn of this.listeners.get(event.sale.terminalId) ?? []) {
      try {
        fn(event);
      } catch {
        // A broken subscriber must not break the sale.
      }
    }
  }

  private saleForCapture(r: Record<string, unknown>): Sale | undefined {
    const related = (r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)
      ?.related_ids;
    if (related?.order_id) {
      const byOrder = this.store.findSaleByOrderId(related.order_id);
      if (byOrder) return byOrder;
    }
    return typeof r.id === "string" ? this.store.findSaleByCaptureId(r.id) : undefined;
  }
}

function isOpen(sale: Sale): boolean {
  return sale.status === "open" || sale.status === "approved";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** A refund resource links to its capture with rel "up": .../v2/payments/captures/{id}. */
function upCaptureId(r: Record<string, unknown>): string | undefined {
  const links = Array.isArray(r.links) ? (r.links as { rel?: string; href?: string }[]) : [];
  const up = links.find((l) => l.rel === "up")?.href;
  return up ? /\/captures\/([^/?]+)/.exec(up)?.[1] : undefined;
}

function resolveLines(vendor: Vendor, input: CreateSaleInput): CartLine[] {
  if ("amount" in input) {
    return [
      {
        sku: "monto",
        name: "Sale",
        names: { en: "Sale", es: "Cobro" },
        qty: 1,
        unitPrice: money(input.amount, vendor.currency),
      },
    ];
  }
  return input.lines.map((l) => {
    const item = vendor.catalog.find((c) => c.sku === l.sku);
    if (!item) throw new SaleError("UNKNOWN_SKU", 400, `unknown sku ${l.sku}`);
    return {
      sku: item.sku,
      name: item.name,
      ...(item.names && { names: item.names }),
      qty: l.qty,
      unitPrice: item.price,
    };
  });
}
