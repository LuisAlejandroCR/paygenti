// test/policy.test.ts: every rule of the deterministic lock, the PIN guard, the audit log, and
// the PolicyEngine's reserve/commit/release cycle with daily rollover at local midnight.
import { describe, expect, it } from "vitest";
import { AuditLog } from "../server/policy/audit";
import { PolicyEngine } from "../server/policy/index";
import { PinGuard } from "../server/policy/pin";
import {
  DEFAULT_POLICY_CONFIG,
  decide,
  localDay,
  type PolicyAction,
  type PolicyContext,
  speak,
} from "../server/policy/rules";
import { money } from "../shared/money";

const mxn = (minor: number) => money(minor, "MXN");
// 2026-10-06 12:00 in Mexico City (UTC-6).
const NOON = new Date("2026-10-06T18:00:00Z");

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    actor: "vendor",
    pinVerified: true,
    now: NOON,
    refundedToday: mxn(0),
    paidOutToday: mxn(0),
    config: DEFAULT_POLICY_CONFIG,
    vendorName: "Rosa",
    ...over,
  };
}

function refund(over: Partial<Extract<PolicyAction, { kind: "refund" }>> = {}): PolicyAction {
  return {
    kind: "refund",
    saleId: "sale-1",
    captureId: "cap-1",
    amount: mxn(5000),
    capturedAt: "2026-10-06T16:00:00Z",
    capturedAmount: mxn(9500),
    alreadyRefunded: mxn(0),
    ...over,
  };
}

const payoutCfg = { ...DEFAULT_POLICY_CONFIG, payoutAllowlist: ["proveedor@example.com"] };

describe("rules: refund", () => {
  it("allows a vendor refund with PIN, within caps, same day", () => {
    const d = decide(refund(), ctx());
    expect(d).toMatchObject({ allow: true, code: "REFUND_OK" });
    expect(d.reason).toBe("Devolución autorizada por 50 pesos.");
  });

  it("denies the customer", () => {
    expect(decide(refund(), ctx({ actor: "customer" })).code).toBe("CUSTOMER_NOT_AUTHORIZED");
  });

  it("denies the agent with a spoken reason naming the vendor", () => {
    const d = decide(refund(), ctx({ actor: "agent" }));
    expect(d).toMatchObject({ allow: false, code: "VENDOR_REQUIRED" });
    expect(d.reason).toBe("Solo Rosa puede autorizar devoluciones, y el máximo es 200 pesos.");
  });

  it("requires the PIN", () => {
    expect(decide(refund(), ctx({ pinVerified: false })).code).toBe("PIN_REQUIRED");
  });

  it("caps a single refund at 200 MXN (200.00 allowed, 200.01 denied)", () => {
    const cap = { capturedAmount: mxn(50000) };
    expect(decide(refund({ ...cap, amount: mxn(20000) }), ctx()).allow).toBe(true);
    expect(decide(refund({ ...cap, amount: mxn(20001) }), ctx()).code).toBe("REFUND_OVER_CAP");
  });

  it("never refunds more than captured minus already refunded", () => {
    const a = refund({ amount: mxn(5000), alreadyRefunded: mxn(5000) });
    const d = decide(a, ctx());
    expect(d.code).toBe("REFUND_EXCEEDS_CAPTURE");
    expect(d.reason).toContain("45 pesos");
    expect(decide(refund({ amount: mxn(4500), alreadyRefunded: mxn(5000) }), ctx()).allow).toBe(
      true,
    );
    expect(
      decide(refund({ amount: mxn(100), alreadyRefunded: mxn(9500) }), ctx()).reason,
    ).toContain("ya se devolvió completo");
  });

  it("only refunds captures from the same local day", () => {
    // 23:30 local on Oct 5 = 05:30Z Oct 6: same UTC day, previous local day.
    expect(decide(refund({ capturedAt: "2026-10-06T05:30:00Z" }), ctx()).code).toBe(
      "CAPTURE_NOT_TODAY",
    );
    // 00:30 local on Oct 6 = 06:30Z.
    expect(decide(refund({ capturedAt: "2026-10-06T06:30:00Z" }), ctx()).allow).toBe(true);
    expect(decide(refund({ capturedAt: "2026-10-05T18:00:00Z" }), ctx()).code).toBe(
      "CAPTURE_NOT_TODAY",
    );
  });

  it("rejects future and unparseable capture times", () => {
    expect(decide(refund({ capturedAt: "2026-10-06T23:00:00Z" }), ctx()).code).toBe(
      "CAPTURE_NOT_TODAY",
    );
    expect(decide(refund({ capturedAt: "ayer" }), ctx()).code).toBe("MALFORMED_ACTION");
  });

  it("honors a configurable time zone", () => {
    const cfg = { ...DEFAULT_POLICY_CONFIG, timeZone: "UTC" };
    expect(decide(refund({ capturedAt: "2026-10-06T05:30:00Z" }), ctx({ config: cfg })).allow).toBe(
      true,
    );
  });

  it("caps refunds per day at 1000 MXN", () => {
    expect(decide(refund(), ctx({ refundedToday: mxn(95000) })).allow).toBe(true);
    const d = decide(refund(), ctx({ refundedToday: mxn(96000) }));
    expect(d.code).toBe("REFUND_DAILY_CAP");
    expect(d.reason).toContain("quedan 40 pesos");
  });

  it("requires matching currencies everywhere", () => {
    expect(decide(refund({ amount: money(5000, "USD") }), ctx()).code).toBe("CURRENCY_MISMATCH");
    expect(decide(refund({ capturedAmount: money(9500, "USD") }), ctx()).code).toBe(
      "CURRENCY_MISMATCH",
    );
    expect(decide(refund(), ctx({ refundedToday: money(0, "USD") })).code).toBe(
      "CURRENCY_MISMATCH",
    );
  });

  it("rejects zero, negative, fractional and missing amounts", () => {
    for (const amount of [
      mxn(0),
      { minor: -100, currency: "MXN" },
      { minor: 10.5, currency: "MXN" },
      { minor: Number.NaN, currency: "MXN" },
      undefined,
    ])
      expect(decide(refund({ amount: amount as never }), ctx()).code).toBe("INVALID_AMOUNT");
  });
});

describe("rules: payout", () => {
  const payout = (recipient: string, minor: number): PolicyAction => ({
    kind: "payout",
    recipient,
    amount: mxn(minor),
  });

  it("denies everyone when the allowlist is empty (the default)", () => {
    expect(decide(payout("proveedor@example.com", 100), ctx()).code).toBe("PAYOUT_NOT_ALLOWLISTED");
  });

  it("allows a vendor payout with PIN to an allowlisted recipient", () => {
    const d = decide(payout("  Proveedor@Example.com ", 10000), ctx({ config: payoutCfg }));
    expect(d).toMatchObject({ allow: true, code: "PAYOUT_OK" });
  });

  it("applies the same actor and PIN gate as refunds", () => {
    const c = { config: payoutCfg };
    expect(
      decide(payout("proveedor@example.com", 100), ctx({ ...c, actor: "customer" })).code,
    ).toBe("CUSTOMER_NOT_AUTHORIZED");
    expect(decide(payout("proveedor@example.com", 100), ctx({ ...c, actor: "agent" })).code).toBe(
      "VENDOR_REQUIRED",
    );
    expect(
      decide(payout("proveedor@example.com", 100), ctx({ ...c, pinVerified: false })).code,
    ).toBe("PIN_REQUIRED");
  });

  it("caps payouts per day at 500 MXN", () => {
    const c = { config: payoutCfg };
    expect(decide(payout("proveedor@example.com", 50000), ctx(c)).allow).toBe(true);
    expect(decide(payout("proveedor@example.com", 50001), ctx(c)).code).toBe("PAYOUT_DAILY_CAP");
    expect(
      decide(payout("proveedor@example.com", 100), ctx({ ...c, paidOutToday: mxn(49950) })).code,
    ).toBe("PAYOUT_DAILY_CAP");
  });
});

describe("rules: other actions", () => {
  it("always denies accepting a dispute, even for the vendor with PIN", () => {
    const d = decide({ kind: "accept_dispute", disputeId: "d-1" }, ctx());
    expect(d).toMatchObject({ allow: false, code: "DISPUTE_MANUAL_ONLY" });
    expect(d.reason).toContain("Rosa");
  });

  it("allows create_order and create_invoice for anyone", () => {
    for (const actor of ["vendor", "agent", "customer"] as const) {
      expect(
        decide({ kind: "create_order", amount: mxn(9500) }, ctx({ actor, pinVerified: false }))
          .allow,
      ).toBe(true);
      expect(
        decide({ kind: "create_invoice", amount: mxn(9500) }, ctx({ actor, pinVerified: false }))
          .code,
      ).toBe("INVOICE_OK");
    }
    expect(decide({ kind: "create_order", amount: mxn(0) }, ctx()).code).toBe("INVALID_AMOUNT");
  });

  it("fails closed on unknown kinds, unknown actors, garbage and bad config", () => {
    expect(decide({ kind: "transfer_all" } as never, ctx()).code).toBe("UNKNOWN_ACTION");
    expect(decide(refund(), ctx({ actor: "admin" as never })).code).toBe("UNKNOWN_ACTOR");
    expect(decide(null as never, ctx()).code).toBe("MALFORMED_ACTION");
    const bad = { ...DEFAULT_POLICY_CONFIG, timeZone: "Mars/Olympus" };
    expect(decide(refund(), ctx({ config: bad }))).toMatchObject({
      allow: false,
      code: "POLICY_ERROR",
    });
  });

  it("speaks amounts in Spanish and computes local days", () => {
    expect(speak(mxn(20000))).toBe("200 pesos");
    expect(speak(mxn(1050))).toBe("10 pesos con 50 centavos");
    expect(speak(money(100, "USD"))).toBe("1 dólares");
    expect(localDay(new Date("2026-10-06T05:59:00Z"), "America/Mexico_City")).toBe("2026-10-05");
  });
});

describe("PinGuard", () => {
  it("accepts the right PIN and rejects malformed setup", () => {
    const g = new PinGuard({ pin: "4321" });
    expect(g.verify("4321").ok).toBe(true);
    expect(g.verify("1234")).toMatchObject({ ok: false, code: "PIN_WRONG", attemptsLeft: 4 });
    expect(g.verify(4321 as never).ok).toBe(false);
    expect(() => new PinGuard({ pin: "12" })).toThrow();
    expect(() => new PinGuard({ pin: "abcd" })).toThrow();
  });

  it("locks for 5 minutes after 5 wrong attempts, refusing even the right PIN", () => {
    let t = 0;
    const g = new PinGuard({ pin: "4321", now: () => t });
    for (let i = 0; i < 4; i++) expect(g.verify("0000").code).toBe("PIN_WRONG");
    expect(g.verify("0000").code).toBe("PIN_LOCKED");
    t = 4 * 60_000;
    expect(g.verify("4321")).toMatchObject({ ok: false, code: "PIN_LOCKED", retryAfterMs: 60_000 });
    expect(g.isLocked()).toBe(true);
    t = 5 * 60_000;
    expect(g.verify("4321").ok).toBe(true);
    expect(g.verify("0000")).toMatchObject({ attemptsLeft: 4 });
  });

  it("a correct PIN resets the failure count", () => {
    const g = new PinGuard({ pin: "4321", now: () => 0 });
    for (let i = 0; i < 4; i++) g.verify("0000");
    expect(g.verify("4321").ok).toBe(true);
    expect(g.verify("0000")).toMatchObject({ attemptsLeft: 4 });
  });
});

describe("PinGuard per-client lockout", () => {
  it("one client's wrong guesses do not lock out another client", () => {
    const g = new PinGuard({ pin: "4321", now: () => 0 });
    for (let i = 0; i < 4; i++) expect(g.verify("0000", "ip:attacker").code).toBe("PIN_WRONG");
    expect(g.verify("0000", "ip:attacker").code).toBe("PIN_LOCKED");
    expect(g.verify("4321", "ip:attacker").ok).toBe(false);
    expect(g.isLocked("ip:attacker")).toBe(true);
    expect(g.isLocked("ip:vendor")).toBe(false);
    expect(g.verify("4321", "ip:vendor").ok).toBe(true);
    expect(g.verify("0000", "ip:vendor")).toMatchObject({ code: "PIN_WRONG", attemptsLeft: 4 });
  });

  it("charges every key: a locked session stays locked from a new IP", () => {
    const g = new PinGuard({ pin: "4321", now: () => 0 });
    for (let i = 0; i < 5; i++) g.verify("0000", ["ip:a", "session:s1"]);
    expect(g.verify("4321", ["ip:b", "session:s1"]).code).toBe("PIN_LOCKED");
    expect(g.verify("4321", ["ip:b"]).ok).toBe(true);
  });

  it("backs off exponentially on repeated lockouts, capped", () => {
    let t = 0;
    const g = new PinGuard({ pin: "4321", now: () => t, maxLockoutMs: 15 * 60_000 });
    const lockOut = () => {
      let last = g.verify("0000", "ip:x");
      for (let i = 1; i < 5; i++) last = g.verify("0000", "ip:x");
      return last;
    };
    expect(lockOut()).toMatchObject({ code: "PIN_LOCKED", retryAfterMs: 5 * 60_000 });
    t += 5 * 60_000;
    expect(lockOut()).toMatchObject({ code: "PIN_LOCKED", retryAfterMs: 10 * 60_000 });
    t += 10 * 60_000;
    expect(lockOut()).toMatchObject({ code: "PIN_LOCKED", retryAfterMs: 15 * 60_000 });
    t += 15 * 60_000;
    // The right PIN after the lock lapses resets the backoff.
    expect(g.verify("4321", "ip:x").ok).toBe(true);
    expect(lockOut()).toMatchObject({ code: "PIN_LOCKED", retryAfterMs: 5 * 60_000 });
  });

  it("a global backstop locks everyone after many failures from rotating clients", () => {
    let t = 0;
    const g = new PinGuard({ pin: "4321", now: () => t, globalMaxAttempts: 20 });
    for (let i = 0; i < 19; i++) expect(g.verify("0000", `ip:bot-${i}`).code).toBe("PIN_WRONG");
    expect(g.verify("0000", "ip:bot-19").code).toBe("PIN_LOCKED");
    expect(g.verify("4321", "ip:vendor")).toMatchObject({ ok: false, code: "PIN_LOCKED" });
    t = 5 * 60_000;
    expect(g.verify("4321", "ip:vendor").ok).toBe(true);
  });

  it("the engine audits PIN checks with the client keys and never the PIN", () => {
    const engine = new PolicyEngine({ vendorName: "Rosa", pin: "4321", now: () => NOON });
    expect(engine.verifyPin("vendor", "0000", ["ip:9.9.9.9"]).ok).toBe(false);
    const [entry] = engine.audit.entries();
    expect(entry).toMatchObject({
      event: "pin",
      action: { check: "vendor_pin", client: ["ip:9.9.9.9"] },
      decision: { allow: false, code: "PIN_WRONG" },
    });
    expect(JSON.stringify(entry)).not.toContain("0000");
  });
});

describe("AuditLog", () => {
  it("is append-only, frozen, and strips PIN-like fields", () => {
    const log = new AuditLog();
    log.append({
      at: NOON.toISOString(),
      event: "decide",
      actor: "agent",
      action: { kind: "refund", pin: "4321", nested: { vendorPin: "4321", ok: 1 } },
      decision: { allow: false, code: "X", reason: "r" },
    });
    const [e] = log.entries();
    expect(JSON.stringify(e)).not.toContain("4321");
    expect(e?.seq).toBe(1);
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => {
      (e as { actor: string }).actor = "vendor";
    }).toThrow();
    (log.entries() as unknown[]).length = 0;
    expect(log.size).toBe(1);
  });
});

describe("PolicyEngine", () => {
  function engine(start = NOON) {
    const clock = { t: start };
    const e = new PolicyEngine({
      vendorName: "Rosa",
      pin: "4321",
      now: () => clock.t,
      config: { payoutAllowlist: ["proveedor@example.com"] },
    });
    return { e, clock };
  }
  const vendor = { actor: "vendor" as const, pin: "4321" };

  it("verifies the PIN itself and never logs it", () => {
    const { e } = engine();
    expect(e.decide(refund(), { actor: "vendor" }).code).toBe("PIN_REQUIRED");
    expect(e.decide(refund(), { actor: "vendor", pin: "9999" }).code).toBe("PIN_REQUIRED");
    expect(e.decide(refund(), vendor).allow).toBe(true);
    expect(JSON.stringify(e.audit.entries())).not.toContain("4321");
    expect(JSON.stringify(e.audit.entries())).not.toContain("9999");
  });

  it("audits every decision", () => {
    const { e } = engine();
    e.decide(refund(), { actor: "agent" });
    e.decide({ kind: "create_order", amount: mxn(100) }, { actor: "customer" });
    const decides = e.audit.entries().filter((x) => x.event === "decide");
    expect(decides).toHaveLength(2);
    expect(decides[0]).toMatchObject({ actor: "agent", decision: { code: "VENDOR_REQUIRED" } });
  });

  it("consumes budget only on commit; release frees it", () => {
    const { e } = engine();
    const d = e.decide(refund({ amount: mxn(20000), capturedAmount: mxn(50000) }), vendor);
    expect(d.ticket).toBeDefined();
    expect(e.totals().refunded.minor).toBe(0);
    expect(e.release(d.ticket as string)).toBe(true);
    expect(e.commit(d.ticket as string)).toBe(false);
    expect(e.totals().refunded.minor).toBe(0);

    const d2 = e.decide(refund({ amount: mxn(20000), capturedAmount: mxn(50000) }), vendor);
    expect(e.commit(d2.ticket as string)).toBe(true);
    expect(e.commit(d2.ticket as string)).toBe(false);
    expect(e.totals().refunded.minor).toBe(20000);
  });

  it("pending reservations count against the daily cap and the capture balance", () => {
    const { e } = engine();
    const big = { capturedAmount: mxn(500000), amount: mxn(20000) };
    for (let i = 0; i < 5; i++)
      expect(e.decide(refund({ ...big, captureId: `c${i}` }), vendor).allow).toBe(true);
    expect(e.decide(refund({ ...big, captureId: "c9" }), vendor).code).toBe("REFUND_DAILY_CAP");

    const { e: e2 } = engine();
    expect(e2.decide(refund({ amount: mxn(9000) }), vendor).allow).toBe(true);
    expect(e2.decide(refund({ amount: mxn(1000) }), vendor).code).toBe("REFUND_EXCEEDS_CAPTURE");
  });

  it("rolls the daily counters over at local midnight, not UTC midnight", () => {
    const { e, clock } = engine(new Date("2026-10-07T04:00:00Z")); // 22:00 local Oct 6
    const ok = e.decide(
      refund({
        amount: mxn(20000),
        capturedAmount: mxn(50000),
        capturedAt: "2026-10-07T03:00:00Z",
      }),
      vendor,
    );
    e.commit(ok.ticket as string);
    clock.t = new Date("2026-10-07T05:59:00Z"); // 23:59 local, still Oct 6
    expect(e.totals()).toMatchObject({ day: "2026-10-06", refunded: { minor: 20000 } });
    clock.t = new Date("2026-10-07T06:00:00Z"); // 00:00 local Oct 7
    expect(e.totals()).toMatchObject({ day: "2026-10-07", refunded: { minor: 0 } });
  });

  it("tracks payouts separately and expires stale reservations", () => {
    const { e, clock } = engine();
    const p: PolicyAction = {
      kind: "payout",
      recipient: "proveedor@example.com",
      amount: mxn(50000),
    };
    const d = e.decide(p, vendor);
    expect(d.allow).toBe(true);
    expect(e.decide({ ...p, amount: mxn(100) }, vendor).code).toBe("PAYOUT_DAILY_CAP");
    clock.t = new Date(NOON.getTime() + 6 * 60_000);
    expect(e.commit(d.ticket as string)).toBe(false);
    expect(e.decide(p, vendor).allow).toBe(true);
    expect(e.totals().paidOut.minor).toBe(0);
  });
});
