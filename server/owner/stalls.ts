// server/owner/stalls.ts: one owner, several paygents. Builds a Stall per vendor — its own scoped
// store, PIN, PolicyEngine (caps), BackOffice, sessions and approvals inbox — so one stall's refund
// or payout budget can never be spent from another. Also parses STALL_PINS ("beto:5678,...").
import { BackOffice } from "../backoffice/tools";
import type { PayPalGateway } from "../paypal/gateway";
import { PolicyEngine } from "../policy";
import { PIN_PATTERN } from "../policy/pin";
import { type Clock, SalesService } from "../sales";
import { StallStore } from "../scoped";
import type { Store } from "../store";
import { ApprovalDesk } from "./approvals";

/** Demo PINs per stall when nothing is configured (Rosa keeps VENDOR_PIN / 1234). */
export const DEMO_STALL_PINS: Readonly<Record<string, string>> = { beto: "5678" };

export interface Stall {
  id: string;
  store: StallStore;
  sales: SalesService;
  policy: PolicyEngine;
  office: BackOffice;
  approvals: ApprovalDesk;
  /** Back-office session tokens of this stall only (token -> expiry ms). */
  sessions: Map<string, number>;
}

export interface StallOptions {
  base: Store;
  vendorId: string;
  paypal: PayPalGateway;
  pin: string;
  clock?: Clock;
  /** A pre-built lock (tests); it must be bound to this stall's store. */
  policy?: PolicyEngine;
}

export function createStall(opts: StallOptions): Stall {
  const store = new StallStore(opts.base, opts.vendorId);
  const vendor = store.getVendor(opts.vendorId);
  if (!vendor) throw new Error(`stalls: unknown vendor ${opts.vendorId}`);
  const sales = new SalesService({ store, paypal: opts.paypal, clock: opts.clock });
  const policy =
    opts.policy ??
    new PolicyEngine({
      vendorName: vendor.displayName.split(" ")[0] ?? vendor.id,
      pin: opts.pin,
      now: opts.clock ? () => new Date(opts.clock?.() ?? Date.now()) : undefined,
      store,
    });
  if (!opts.policy) policy.setCurrency(vendor.currency, vendor.timeZone);
  const office = new BackOffice({ sales, paypal: opts.paypal, policy, clock: opts.clock });
  const approvals = new ApprovalDesk({ store, office, clock: opts.clock });
  return { id: vendor.id, store, sales, policy, office, approvals, sessions: new Map() };
}

/** "beto:5678, luz:2468" -> { beto: "5678", luz: "2468" }; malformed entries are skipped. */
export function parseStallPins(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [id, pin] = part.split(":").map((s) => s.trim());
    if (id && pin && /^[a-z0-9-]{1,40}$/.test(id) && PIN_PATTERN.test(pin)) out[id] = pin;
  }
  return out;
}
