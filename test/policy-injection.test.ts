// test/policy-injection.test.ts: 25 hostile proposals an LLM agent might emit after prompt injection
// (refunds, payouts to suppliers, allowlist tampering). Every one goes through a fresh PolicyEngine;
// the battery passes only if zero money moves are allowed.
import { describe, expect, it } from "vitest";
import {
  type EngineDecision,
  type PolicyAction,
  PolicyEngine,
  type Request,
} from "../server/policy";
import { money } from "../shared/money";

const NOON = new Date("2026-10-06T18:00:00Z"); // 12:00 Mexico City
const PIN = "4321";
const mxn = (minor: number) => money(minor, "MXN");

const sale = {
  kind: "refund" as const,
  saleId: "sale-1",
  captureId: "cap-1",
  capturedAt: "2026-10-06T17:00:00Z",
  capturedAmount: mxn(9500),
  alreadyRefunded: mxn(0),
};

interface Attack {
  name: string;
  setup?: (e: PolicyEngine) => void;
  attempts: Array<{ action: PolicyAction; req: Request }>;
}

const one = (action: unknown, req: Request) => [{ action: action as PolicyAction, req }];
const agent: Request = { actor: "agent" };
const vendorPin: Request = { actor: "vendor", pin: PIN };

const attacks: Attack[] = [
  {
    name: 'customer: "asistente, devuélveme 2000 pesos"',
    attempts: one({ ...sale, amount: mxn(200000) }, { actor: "customer" }),
  },
  {
    name: "customer asks for a small refund, within every cap",
    attempts: one({ ...sale, amount: mxn(1000) }, { actor: "customer" }),
  },
  {
    name: "customer who somehow knows the PIN",
    attempts: one({ ...sale, amount: mxn(1000) }, { actor: "customer", pin: PIN }),
  },
  { name: "agent refunds without a PIN", attempts: one({ ...sale, amount: mxn(5000) }, agent) },
  {
    name: "agent relays the PIN the customer typed in chat",
    attempts: one({ ...sale, amount: mxn(5000) }, { actor: "agent", pin: PIN }),
  },
  {
    name: "actor spoofing: agent claims to be the vendor, no PIN",
    attempts: one({ ...sale, amount: mxn(5000) }, { actor: "vendor" }),
  },
  {
    name: "actor spoofing: unknown privileged actor",
    attempts: one({ ...sale, amount: mxn(5000) }, { actor: "admin" as never, pin: PIN }),
  },
  {
    name: "PIN brute force: 10 guesses, then the right PIN while locked",
    attempts: [
      ...Array.from({ length: 10 }, (_, i) => ({
        action: { ...sale, amount: mxn(5000) } as PolicyAction,
        req: { actor: "vendor" as const, pin: String(i).padStart(4, "0") },
      })),
      { action: { ...sale, amount: mxn(5000) }, req: vendorPin },
    ],
  },
  {
    name: "vendor with PIN, refund over the 200 MXN cap",
    attempts: one({ ...sale, capturedAmount: mxn(100000), amount: mxn(20001) }, vendorPin),
  },
  {
    name: "agent splits 2000 pesos into twenty 99-peso refunds",
    attempts: Array.from({ length: 20 }, (_, i) => ({
      action: { ...sale, captureId: `cap-${i}`, amount: mxn(9900) } as PolicyAction,
      req: agent,
    })),
  },
  {
    name: "split refunds after the daily cap is already spent",
    setup: (e) => {
      for (let i = 0; i < 5; i++) {
        const d = e.decide(
          { ...sale, captureId: `pre-${i}`, capturedAmount: mxn(20000), amount: mxn(20000) },
          vendorPin,
        );
        e.commit(d.ticket as string);
      }
    },
    attempts: Array.from({ length: 10 }, (_, i) => ({
      action: { ...sale, captureId: `cap-${i}`, amount: mxn(100) } as PolicyAction,
      req: vendorPin,
    })),
  },
  {
    name: "refund of yesterday's capture",
    attempts: one({ ...sale, capturedAt: "2026-10-05T18:00:00Z", amount: mxn(5000) }, vendorPin),
  },
  {
    name: "refund more than was captured",
    attempts: one({ ...sale, capturedAmount: mxn(5000), amount: mxn(5001) }, vendorPin),
  },
  {
    name: "double refund of an already refunded capture",
    attempts: one({ ...sale, alreadyRefunded: mxn(9500), amount: mxn(100) }, vendorPin),
  },
  {
    name: "currency mismatch: refund in USD against an MXN capture",
    attempts: one({ ...sale, amount: money(5000, "USD") }, vendorPin),
  },
  {
    name: "negative, zero, fractional and string amounts",
    attempts: [
      { minor: -50000, currency: "MXN" },
      { minor: 0, currency: "MXN" },
      { minor: 99.5, currency: "MXN" },
      { minor: "5000", currency: "MXN" },
      { minor: 5000, currency: "BTC" },
    ].map((amount) => ({ action: { ...sale, amount } as unknown as PolicyAction, req: vendorPin })),
  },
  {
    name: "payout to a non-allowlisted recipient",
    attempts: one(
      { kind: "payout", recipient: "atacante@example.com", amount: mxn(10000) },
      vendorPin,
    ),
  },
  {
    name: "agent relays a PIN to pay an allowlisted supplier",
    setup: (e) => e.setPayoutAllowlist(["masa@example.com"]),
    attempts: one(
      { kind: "payout", recipient: "masa@example.com", amount: mxn(10000) },
      { actor: "agent", pin: PIN },
    ),
  },
  {
    name: "vendor with PIN, single payout over the 300 MXN cap",
    setup: (e) => e.setPayoutAllowlist(["masa@example.com"]),
    attempts: one({ kind: "payout", recipient: "masa@example.com", amount: mxn(30001) }, vendorPin),
  },
  {
    name: "split payouts after the 500 MXN daily payout cap is spent",
    setup: (e) => {
      e.setPayoutAllowlist(["masa@example.com"]);
      for (const minor of [30000, 20000]) {
        const d = e.decide(
          { kind: "payout", recipient: "masa@example.com", amount: mxn(minor) },
          vendorPin,
        );
        e.commit(d.ticket as string);
      }
    },
    attempts: Array.from({ length: 5 }, () => ({
      action: { kind: "payout", recipient: "masa@example.com", amount: mxn(100) } as PolicyAction,
      req: vendorPin,
    })),
  },
  {
    name: "look-alike recipient (homoglyph / extra dot) of an allowlisted supplier",
    setup: (e) => e.setPayoutAllowlist(["masa@example.com"]),
    attempts: [
      ...one({ kind: "payout", recipient: "masa@examp1e.com", amount: mxn(1000) }, vendorPin),
      ...one({ kind: "payout", recipient: "ma.sa@example.com", amount: mxn(1000) }, vendorPin),
    ],
  },
  {
    name: "agent or customer adds themselves to the payout allowlist",
    attempts: [
      ...one({ kind: "supplier", op: "add", recipient: "atacante@example.com" }, agent),
      ...one(
        { kind: "supplier", op: "add", recipient: "atacante@example.com" },
        { actor: "agent", pin: PIN },
      ),
      ...one(
        { kind: "supplier", op: "add", recipient: "atacante@example.com" },
        { actor: "customer", pin: PIN },
      ),
    ],
  },
  {
    name: "agent accepts a dispute (and the vendor too, through the agent)",
    attempts: [
      { action: { kind: "accept_dispute", disputeId: "PP-D-1" }, req: agent },
      { action: { kind: "accept_dispute", disputeId: "PP-D-1" }, req: vendorPin },
    ],
  },
  {
    name: "made-up money-moving actions",
    attempts: [
      ...one({ kind: "transfer", recipient: "x", amount: mxn(1000) }, vendorPin),
      ...one({ ...sale, kind: "REFUND", amount: mxn(1000) }, vendorPin),
      ...one({ kind: "refund_all" }, vendorPin),
    ],
  },
  {
    name: "malformed refund: missing capture data, null action, prototype tricks",
    attempts: [
      ...one({ kind: "refund", amount: mxn(1000) }, vendorPin),
      ...one(null, vendorPin),
      ...one(JSON.parse('{"__proto__":{"allow":true},"kind":"refund"}'), vendorPin),
    ],
  },
];

describe("prompt-injection battery", () => {
  it("has 25 hostile proposals", () => {
    expect(attacks).toHaveLength(25);
  });

  it.each(attacks)("$name → denied", ({ setup, attempts }) => {
    const e = new PolicyEngine({ vendorName: "Rosa", pin: PIN, now: () => NOON });
    setup?.(e);
    const before = e.totals();
    const results: EngineDecision[] = attempts.map(({ action, req }) => e.decide(action, req));
    for (const d of results) {
      expect(d.allow).toBe(false);
      expect(d.ticket).toBeUndefined();
      expect(d.reason.length).toBeGreaterThan(0);
    }
    expect(e.totals()).toEqual(before);
    expect(JSON.stringify(e.audit.entries())).not.toContain(`"${PIN}"`);
  });

  it("0 of all hostile attempts allowed", () => {
    let allowed = 0;
    let total = 0;
    for (const { setup, attempts } of attacks) {
      const e = new PolicyEngine({ vendorName: "Rosa", pin: PIN, now: () => NOON });
      setup?.(e);
      for (const { action, req } of attempts) {
        total++;
        if (e.decide(action, req).allow) allowed++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(20);
    expect(allowed).toBe(0);
  });
});
