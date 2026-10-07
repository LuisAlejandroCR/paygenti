// server/backoffice/payouts.ts: payouts to suppliers ("pay the masa supplier"). The allowlist (add or
// remove needs the vendor PIN, decided by the policy lock), PIN-confirmed payouts through the lock,
// AI proposals that never execute, status refresh and PayPal payout webhooks.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isPayPalCurrency } from "../../shared/currency";
import { formatMoney, type Money, money } from "../../shared/money";
import type { Payout, PayoutStatus, RecipientType, Supplier } from "../../shared/types";
import {
  type GatewayPayout,
  type PayoutItemStatus,
  PayPalError,
  type PayPalGateway,
} from "../paypal/gateway";
import { type DecisionParams, localDay, type PolicyEngine } from "../policy";
import type { Store } from "../store";
import type { Authority } from "./tools";

export const supplierInput = z.strictObject({
  name: z.string().trim().min(1).max(60),
  recipientType: z.enum(["EMAIL", "PHONE"]),
  receiver: z.string().trim().min(3).max(127),
  currency: z.string().refine(isPayPalCurrency).optional(),
});
export type SupplierInput = z.infer<typeof supplierInput>;

export interface PayRequest {
  supplierId: string;
  amountMinor: number;
  note?: string;
  /** Client-generated id: a retried submit returns the first payout instead of paying twice. */
  requestId?: string;
}

export interface ProposeRequest {
  /** Supplier id, name, email or phone as the model wrote it. */
  supplier: string;
  amountMinor: number;
  note?: string;
}

type Fail = { ok: false; code: string; reason: string; params?: DecisionParams };
type Ok<T> = { ok: true; code: string; reason: string; params?: DecisionParams } & T;
export type DeskResult<T> = Ok<T> | Fail;

export interface PayoutProposal {
  status: "PENDING_CONFIRMATION";
  supplierId: string;
  supplierName: string;
  amount: Money;
  note?: string;
}

export interface PayoutLimits {
  maxPayout: Money;
  maxPayoutPerDay: Money;
  paidOutToday: Money;
  leftToday: Money;
}

/** Statuses where no money left (or it came back): they do not count as money out in the ledger. */
const NOT_OUT = new Set<PayoutStatus>([
  "DENIED",
  "CANCELED",
  "FAILED",
  "RETURNED",
  "REFUNDED",
  "REVERSED",
  "BLOCKED",
]);
/** A payout still waiting on PayPal: batch webhooks may move it, item statuses are final-er. */
const OPEN = new Set<PayoutStatus>(["PENDING", "PROCESSING", "UNKNOWN"]);
const ITEM_EVENT: Record<string, PayoutItemStatus | "CANCELED"> = {
  SUCCEEDED: "SUCCESS",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  CANCELED: "CANCELED",
  HELD: "ONHOLD",
  REFUNDED: "REFUNDED",
  RETURNED: "RETURNED",
  UNCLAIMED: "UNCLAIMED",
  DENIED: "FAILED",
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email lowercased, phone as 8–15 digits; undefined when it cannot be a PayPal receiver. */
export function normalizeReceiver(type: RecipientType, raw: string): string | undefined {
  if (type === "EMAIL") {
    const e = raw.trim().toLowerCase();
    return e.length <= 127 && EMAIL.test(e) ? e : undefined;
  }
  const digits = raw.replace(/[\s()+.-]/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : undefined;
}

export function isMoneyOut(status: PayoutStatus): boolean {
  return !NOT_OUT.has(status);
}

export interface PayoutDeskDeps {
  store: Store;
  paypal: PayPalGateway;
  policy: PolicyEngine;
  clock?: () => number;
}

export class PayoutDesk {
  readonly #store: Store;
  readonly #paypal: PayPalGateway;
  readonly #policy: PolicyEngine;
  readonly #clock: () => number;

  constructor(deps: PayoutDeskDeps) {
    this.#store = deps.store;
    this.#paypal = deps.paypal;
    this.#policy = deps.policy;
    this.#clock = deps.clock ?? Date.now;
    this.#syncAllowlist();
  }

  suppliers(): Supplier[] {
    return this.#store.suppliers();
  }

  history(): Payout[] {
    return this.#store.payouts();
  }

  /** Payouts created on `day` (policy time zone), newest first. */
  forDay(day: string): Payout[] {
    const tz = this.#policy.config.timeZone;
    return this.history().filter((p) => localDay(new Date(p.createdAt), tz) === day);
  }

  limits(): PayoutLimits {
    const cfg = this.#policy.config;
    const used = this.#policy.totals().paidOut.minor;
    return {
      maxPayout: cfg.maxPayout,
      maxPayoutPerDay: cfg.maxPayoutPerDay,
      paidOutToday: money(used, cfg.currency),
      leftToday: money(Math.max(0, cfg.maxPayoutPerDay.minor - used), cfg.currency),
    };
  }

  /** Adds a supplier to the allowlist; the policy checks vendor session + PIN and audits it. */
  addSupplier(input: SupplierInput, who: Authority): DeskResult<{ supplier: Supplier }> {
    const receiver = normalizeReceiver(input.recipientType, input.receiver);
    if (!receiver)
      return fail("INVALID_SUPPLIER", "Ese correo o teléfono no es válido para PayPal.");
    if (this.#store.suppliers().some((s) => s.receiver === receiver))
      return fail("SUPPLIER_EXISTS", "Ese proveedor ya está en la lista.");
    const decision = this.#policy.decide(
      { kind: "supplier", op: "add", recipient: receiver },
      { actor: who.actor, pin: who.pin, client: who.client },
    );
    if (!decision.allow || !decision.ticket) return refused(decision);
    const supplier: Supplier = {
      id: randomUUID(),
      name: input.name.trim(),
      recipientType: input.recipientType,
      receiver,
      currency: (input.currency as Supplier["currency"]) ?? this.#policy.config.currency,
      createdAt: this.#iso(),
    };
    this.#store.saveSupplier(supplier);
    this.#syncAllowlist();
    this.#policy.commit(decision.ticket);
    return { ok: true, supplier, code: "SUPPLIER_ADDED", reason: decision.reason };
  }

  removeSupplier(id: string, who: Authority): DeskResult<{ supplier: Supplier }> {
    const supplier = this.#store.getSupplier(id);
    if (!supplier) return fail("SUPPLIER_NOT_FOUND", "Ese proveedor no está en la lista.");
    const decision = this.#policy.decide(
      { kind: "supplier", op: "remove", recipient: supplier.receiver },
      { actor: who.actor, pin: who.pin, client: who.client },
    );
    if (!decision.allow || !decision.ticket) return refused(decision);
    this.#store.deleteSupplier(id);
    this.#syncAllowlist();
    this.#policy.commit(decision.ticket);
    return { ok: true, supplier, code: "SUPPLIER_REMOVED", reason: decision.reason };
  }

  /**
   * The only path that pays a supplier. The policy decides (session + PIN, allowlist, per-payout and
   * daily caps); budget is committed only once PayPal accepts and released when it refuses. A lost
   * answer (timeout, 5xx) keeps the budget spent: the payout may exist, so the cap is never freed.
   */
  async pay(req: PayRequest, who: Authority): Promise<DeskResult<{ payout: Payout }>> {
    if (req.requestId && who.actor === "vendor") {
      const prior = this.#store.getPayout(req.requestId);
      if (prior?.status === "UNKNOWN") return unconfirmed();
      if (prior) return sent(prior);
    }
    const supplier = this.#store.getSupplier(req.supplierId);
    const amount = money(req.amountMinor, supplier?.currency ?? this.#policy.config.currency);
    const decision = this.#policy.decide(
      { kind: "payout", recipient: supplier?.receiver ?? "", amount },
      { actor: who.actor, pin: who.pin, client: who.client },
    );
    if (!decision.allow || !decision.ticket) return refused(decision);
    if (!supplier) {
      this.#policy.release(decision.ticket);
      return fail("SUPPLIER_NOT_FOUND", "Ese proveedor no está en la lista.");
    }
    const id = req.requestId ?? randomUUID();
    const note = req.note?.trim().slice(0, 200) || undefined;
    const base: Payout = {
      id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      recipientType: supplier.recipientType,
      receiver: supplier.receiver,
      amount,
      ...(note && { note }),
      status: "PENDING",
      createdAt: this.#iso(),
      updatedAt: this.#iso(),
    };
    try {
      const gw = await this.#paypal.createPayout(this.#createInput(base));
      this.#policy.commit(decision.ticket);
      let payout = this.#apply(base, gw);
      this.#store.savePayout(payout);
      this.#audit(payout, "PAYOUT_SENT");
      payout = (await this.#refreshQuietly(payout)) ?? payout;
      return sent(payout);
    } catch (err) {
      if (!(err instanceof PayPalError)) {
        this.#policy.release(decision.ticket);
        throw err;
      }
      if (ambiguous(err)) {
        this.#policy.commit(decision.ticket);
        const payout: Payout = { ...base, status: "UNKNOWN", error: err.issue ?? "TIMEOUT" };
        this.#store.savePayout(payout);
        this.#audit(payout, "PAYOUT_UNCONFIRMED");
        return unconfirmed();
      }
      this.#policy.release(decision.ticket);
      return paypalFailure(err);
    }
  }

  /** The agent's only payout tool: a dry run through the lock. It never pays and never sees a PIN. */
  propose(req: ProposeRequest): DeskResult<{ proposal: PayoutProposal }> {
    const supplier = this.#resolve(req.supplier);
    const amount = money(req.amountMinor, supplier?.currency ?? this.#policy.config.currency);
    const decision = this.#policy.preview({
      kind: "payout",
      recipient: supplier?.receiver ?? String(req.supplier).slice(0, 127),
      amount,
    });
    if (!decision.allow || !supplier) return refused(decision);
    const note = req.note?.trim().slice(0, 200) || undefined;
    return {
      ok: true,
      code: "PAYOUT_PROPOSED",
      reason: `Propuesta: pagar ${formatMoney(amount)} a ${supplier.name}; confírmalo con tu PIN.`,
      params: { amount: formatMoney(amount), name: supplier.name },
      proposal: {
        status: "PENDING_CONFIRMATION",
        supplierId: supplier.id,
        supplierName: supplier.name,
        amount,
        ...(note && { note }),
      },
    };
  }

  /**
   * Asks PayPal for the latest status. A payout whose create answer was lost is re-sent with the
   * same sender_batch_id (PayPal-Request-Id), which PayPal treats as the same request.
   */
  async refresh(id: string): Promise<Payout | undefined> {
    const payout = this.#store.getPayout(id);
    if (!payout) return undefined;
    if (payout.batchId) return (await this.#refreshQuietly(payout, true)) ?? payout;
    try {
      const gw = await this.#paypal.createPayout(this.#createInput(payout));
      const { error: _lost, ...rest } = payout;
      const next = this.#apply(rest, gw);
      this.#store.savePayout(next);
      return (await this.#refreshQuietly(next)) ?? next;
    } catch (err) {
      if (!(err instanceof PayPalError) || ambiguous(err)) throw err;
      const failed: Payout = {
        ...payout,
        status: "FAILED",
        error: err.issue ?? "PAYPAL_ERROR",
        updatedAt: this.#iso(),
      };
      this.#store.savePayout(failed);
      return failed;
    }
  }

  /** PAYMENT.PAYOUTSBATCH.* and PAYMENT.PAYOUTS-ITEM.* (signature already verified). */
  handleWebhook(event: { event_type: string; resource: Record<string, unknown> }): boolean {
    const type = event.event_type;
    const r = event.resource;
    if (type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
      const h = (r.batch_header ?? {}) as {
        payout_batch_id?: unknown;
        batch_status?: unknown;
        sender_batch_header?: { sender_batch_id?: unknown };
      };
      const payout = this.#find(h.payout_batch_id, h.sender_batch_header?.sender_batch_id);
      const status = typeof h.batch_status === "string" ? h.batch_status : type.split(".").at(-1);
      if (!payout || !isStatus(status)) return false;
      if (status !== "DENIED" && !OPEN.has(payout.status)) return true;
      const batchId = typeof h.payout_batch_id === "string" ? h.payout_batch_id : payout.batchId;
      this.#save({ ...payout, ...(batchId && { batchId }), status });
      return true;
    }
    if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
      const payout = this.#find(r.payout_batch_id, r.sender_batch_id);
      const fromEvent = ITEM_EVENT[type.split(".").at(-1) ?? ""];
      const status = isStatus(r.transaction_status) ? r.transaction_status : fromEvent;
      if (!payout || !status) return false;
      const errors = r.errors as { name?: unknown } | undefined;
      this.#save({
        ...payout,
        ...(typeof r.payout_item_id === "string" && { itemId: r.payout_item_id }),
        status,
        ...(typeof errors?.name === "string" && { error: errors.name.slice(0, 64) }),
      });
      return true;
    }
    return false;
  }

  #find(batchId: unknown, senderBatchId: unknown): Payout | undefined {
    if (typeof batchId === "string") {
      const p = this.#store.findPayoutByBatchId(batchId);
      if (p) return p;
    }
    return typeof senderBatchId === "string" ? this.#store.getPayout(senderBatchId) : undefined;
  }

  #save(p: Payout): void {
    this.#store.savePayout({ ...p, updatedAt: this.#iso() });
  }

  async #refreshQuietly(p: Payout, loud = false): Promise<Payout | undefined> {
    if (!p.batchId) return undefined;
    try {
      const next = this.#apply(p, await this.#paypal.getPayout(p.batchId));
      this.#store.savePayout(next);
      return next;
    } catch (err) {
      if (loud) throw err;
      return undefined;
    }
  }

  #apply(p: Payout, gw: GatewayPayout): Payout {
    const item = gw.items[0];
    const status: PayoutStatus =
      gw.batchStatus === "DENIED" || gw.batchStatus === "CANCELED"
        ? gw.batchStatus
        : (item?.status ?? gw.batchStatus);
    return {
      ...p,
      batchId: gw.batchId,
      ...(item?.itemId && { itemId: item.itemId }),
      status,
      ...(item?.error && { error: item.error }),
      updatedAt: this.#iso(),
    };
  }

  #createInput(p: Payout) {
    return {
      senderBatchId: p.id,
      senderItemId: p.id,
      recipientType: p.recipientType,
      receiver: p.receiver,
      amount: p.amount,
      ...(p.note && { note: p.note }),
    };
  }

  /** Supplier by id, then name, then receiver (what the model may have written). */
  #resolve(text: string): Supplier | undefined {
    const q = String(text ?? "").trim();
    if (!q) return undefined;
    const all = this.#store.suppliers();
    const lower = q.toLowerCase();
    return (
      all.find((s) => s.id === q) ??
      all.find((s) => s.name.toLowerCase() === lower) ??
      all.find(
        (s) =>
          s.receiver === normalizeReceiver("EMAIL", q) ||
          s.receiver === normalizeReceiver("PHONE", q),
      )
    );
  }

  #syncAllowlist(): void {
    this.#policy.setPayoutAllowlist(this.#store.suppliers().map((s) => s.receiver));
  }

  #audit(p: Payout, code: string): void {
    this.#policy.audit.append({
      at: this.#iso(),
      event: "payout",
      actor: "system",
      action: {
        payoutId: p.id,
        supplierId: p.supplierId,
        batchId: p.batchId ?? null,
        amount: p.amount,
        status: p.status,
      },
      decision: {
        allow: code === "PAYOUT_SENT",
        code,
        reason:
          code === "PAYOUT_SENT"
            ? `PayPal aceptó el pago a ${p.supplierName}.`
            : "PayPal no confirmó el pago a tiempo.",
      },
    });
  }

  #iso(): string {
    return new Date(this.#clock()).toISOString();
  }
}

function isStatus(s: unknown): s is PayoutStatus {
  return (
    typeof s === "string" &&
    [
      "PENDING",
      "PROCESSING",
      "SUCCESS",
      "DENIED",
      "CANCELED",
      "FAILED",
      "UNCLAIMED",
      "RETURNED",
      "ONHOLD",
      "BLOCKED",
      "REFUNDED",
      "REVERSED",
    ].includes(s)
  );
}

/** PayPal may have created the payout: the request timed out, the network failed or it 5xx'd. */
function ambiguous(err: PayPalError): boolean {
  return err.issue === "TIMEOUT" || err.issue === "NETWORK_ERROR" || err.status >= 500;
}

function paypalFailure(err: PayPalError): Fail {
  if (err.issue === "PAYOUTS_NOT_ENABLED")
    return fail(
      "PAYOUTS_NOT_ENABLED",
      "Los pagos a proveedores (Payouts) no están activados en esta app de PayPal.",
    );
  if (err.issue === "INSUFFICIENT_FUNDS")
    return fail("PAYOUT_INSUFFICIENT_FUNDS", "No hay saldo suficiente en PayPal para este pago.");
  return fail("PAYOUT_FAILED", "PayPal no aceptó el pago.", { issue: err.issue ?? "UNKNOWN" });
}

function unconfirmed(): Fail {
  return fail(
    "PAYOUT_UNCONFIRMED",
    "PayPal no respondió a tiempo; revisa el estado antes de pagar otra vez.",
  );
}

function sent(payout: Payout): Ok<{ payout: Payout }> {
  return {
    ok: true,
    payout,
    code: "PAYOUT_SENT",
    reason: `Pago enviado: ${formatMoney(payout.amount)} a ${payout.supplierName}.`,
    params: { amount: formatMoney(payout.amount), name: payout.supplierName },
  };
}

function refused(d: { code: string; reason: string; params?: DecisionParams }): Fail {
  return { ok: false, code: d.code, reason: d.reason, ...(d.params && { params: d.params }) };
}

function fail(code: string, reason: string, params?: DecisionParams): Fail {
  return { ok: false, code, reason, ...(params && { params }) };
}
