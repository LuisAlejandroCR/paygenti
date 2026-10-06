// server/policy/index.ts: PolicyEngine — the lock the back-office agent must go through.
// decide() checks PIN + rules and reserves budget with a ticket; commit(ticket) consumes it only once
// PayPal confirms, release(ticket) frees it on failure. Daily counters roll over at local midnight.
import { randomUUID } from "node:crypto";
import type { Money } from "../../shared/money";
import { AuditLog } from "./audit";
import { PinGuard, type PinResult } from "./pin";
import {
  type Actor,
  DEFAULT_POLICY_CONFIG,
  type Decision,
  decide,
  localDay,
  type PolicyAction,
  type PolicyConfig,
} from "./rules";

export { type AuditEntry, AuditLog } from "./audit";
export { PinGuard, type PinResult } from "./pin";
export * from "./rules";

export interface PolicyEngineOptions {
  vendorName: string;
  pin: string;
  config?: Partial<PolicyConfig>;
  now?: () => Date;
  audit?: AuditLog;
  /** How long an unconfirmed reservation holds budget before it lapses. */
  ticketTtlMs?: number;
}

export interface Request {
  actor: Actor;
  /** Raw PIN as typed by the vendor; verified here, never stored or logged. */
  pin?: string;
}

export type EngineDecision = Decision & { ticket?: string };

interface Ticket {
  kind: "refund" | "payout" | "other";
  amount: number;
  captureId?: string;
  day: string;
  expiresAt: number;
}

export class PolicyEngine {
  readonly config: PolicyConfig;
  readonly audit: AuditLog;
  readonly #vendorName: string;
  readonly #pin: PinGuard;
  readonly #now: () => Date;
  readonly #ttl: number;
  readonly #tickets = new Map<string, Ticket>();
  #day: string;
  #refunded = 0;
  #paidOut = 0;

  constructor(opts: PolicyEngineOptions) {
    this.config = Object.freeze({
      ...DEFAULT_POLICY_CONFIG,
      ...opts.config,
      payoutAllowlist: [...(opts.config?.payoutAllowlist ?? DEFAULT_POLICY_CONFIG.payoutAllowlist)],
    });
    this.#vendorName = opts.vendorName;
    this.#now = opts.now ?? (() => new Date());
    this.#pin = new PinGuard({ pin: opts.pin, now: () => this.#now().getTime() });
    this.audit = opts.audit ?? new AuditLog();
    this.#ttl = opts.ticketTtlMs ?? 5 * 60_000;
    this.#day = localDay(this.#now(), this.config.timeZone);
  }

  /** Decide a proposal. An allowed money move returns a ticket that must be committed or released. */
  decide(action: PolicyAction, req: Request): EngineDecision {
    const now = this.#now();
    this.#roll(now);

    let pinVerified = false;
    if (req.pin !== undefined) {
      const result = this.#pin.verify(req.pin);
      this.#logPin(now, req.actor, result);
      pinVerified = result.ok;
    }

    const kind = action?.kind;
    const pending = this.#pending(kind === "refund" ? action.captureId : undefined);
    const ctxAction =
      kind === "refund" && pending.capture > 0 && isCount(action.alreadyRefunded)
        ? {
            ...action,
            alreadyRefunded: {
              ...action.alreadyRefunded,
              minor: action.alreadyRefunded.minor + pending.capture,
            },
          }
        : action;

    const decision: EngineDecision = decide(ctxAction, {
      actor: req.actor,
      pinVerified,
      now,
      refundedToday: this.#money(this.#refunded + pending.refund),
      paidOutToday: this.#money(this.#paidOut + pending.payout),
      config: this.config,
      vendorName: this.#vendorName,
    });

    if (decision.allow) {
      const ticket = randomUUID();
      const moves = kind === "refund" || kind === "payout";
      this.#tickets.set(ticket, {
        kind: moves ? kind : "other",
        amount: moves ? action.amount.minor : 0,
        captureId: kind === "refund" ? action.captureId : undefined,
        day: this.#day,
        expiresAt: now.getTime() + this.#ttl,
      });
      decision.ticket = ticket;
    }

    this.audit.append({
      at: now.toISOString(),
      event: "decide",
      actor: req.actor,
      action,
      decision,
    });
    return decision;
  }

  /** The action ran (PayPal confirmed): consume the reserved budget. False for unknown/used tickets. */
  commit(ticket: string): boolean {
    const now = this.#now();
    this.#roll(now);
    const t = this.#tickets.get(ticket);
    const ok = t !== undefined && t.expiresAt > now.getTime();
    if (t) this.#tickets.delete(ticket);
    if (ok && t.day === this.#day) {
      if (t.kind === "refund") this.#refunded += t.amount;
      if (t.kind === "payout") this.#paidOut += t.amount;
    }
    this.audit.append({
      at: now.toISOString(),
      event: "commit",
      actor: "system",
      action: { ticket, kind: t?.kind ?? "unknown", amount: t?.amount ?? 0 },
      decision: ok
        ? { allow: true, code: "COMMITTED", reason: "Operación registrada." }
        : { allow: false, code: "TICKET_INVALID", reason: "Ese permiso no existe o ya venció." },
    });
    return ok;
  }

  /** The action failed: free the reservation without touching the daily counters. */
  release(ticket: string): boolean {
    const now = this.#now();
    const existed = this.#tickets.delete(ticket);
    this.audit.append({
      at: now.toISOString(),
      event: "release",
      actor: "system",
      action: { ticket },
      decision: existed
        ? { allow: true, code: "RELEASED", reason: "Permiso liberado sin cobrar presupuesto." }
        : { allow: false, code: "TICKET_INVALID", reason: "Ese permiso no existe o ya venció." },
    });
    return existed;
  }

  /** Check the vendor PIN to open a back-office session; same guard and lockout as decide(). */
  verifyPin(actor: Actor, pin: unknown): PinResult {
    const result = this.#pin.verify(pin);
    this.#logPin(this.#now(), actor, result);
    return result;
  }

  /** Committed totals for the current local day. */
  totals(): { day: string; refunded: Money; paidOut: Money } {
    this.#roll(this.#now());
    return {
      day: this.#day,
      refunded: this.#money(this.#refunded),
      paidOut: this.#money(this.#paidOut),
    };
  }

  #roll(now: Date): void {
    const today = localDay(now, this.config.timeZone);
    if (today !== this.#day) {
      this.#day = today;
      this.#refunded = 0;
      this.#paidOut = 0;
    }
    for (const [id, t] of this.#tickets) if (t.expiresAt <= now.getTime()) this.#tickets.delete(id);
  }

  #pending(captureId: string | undefined): { refund: number; payout: number; capture: number } {
    const sum = { refund: 0, payout: 0, capture: 0 };
    for (const t of this.#tickets.values()) {
      if (t.day !== this.#day) continue;
      if (t.kind === "refund") sum.refund += t.amount;
      if (t.kind === "payout") sum.payout += t.amount;
      if (t.kind === "refund" && captureId !== undefined && t.captureId === captureId)
        sum.capture += t.amount;
    }
    return sum;
  }

  #money(minor: number): Money {
    return { minor, currency: this.config.currency };
  }

  #logPin(now: Date, actor: Actor, result: PinResult): void {
    this.audit.append({
      at: now.toISOString(),
      event: "pin",
      actor,
      action: { check: "vendor_pin" },
      decision: {
        allow: result.ok,
        code: result.code,
        reason: result.ok
          ? "PIN correcto."
          : result.code === "PIN_LOCKED"
            ? "Demasiados intentos; el PIN está bloqueado unos minutos."
            : "PIN incorrecto.",
      },
    });
  }
}

function isCount(m: unknown): m is Money {
  return !!m && typeof m === "object" && Number.isSafeInteger((m as Money).minor);
}
