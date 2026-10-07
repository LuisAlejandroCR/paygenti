// test/store.test.ts: one Store contract suite run against MemoryStore and PostgresStore (PGlite),
// plus Postgres-only checks: a restart keeps sales, catalog, audit, PIN lockouts and cap usage,
// concurrent refunds never overspend the daily cap, and concurrent writers never lose an increment.
import { afterEach, describe, expect, it } from "vitest";
import { PostgresStore } from "../server/db/postgres";
import { sslFromUrl } from "../server/db/sql";
import { PolicyEngine } from "../server/policy";
import { DEMO_VENDOR, MemoryStore, type Store } from "../server/store";
import { money } from "../shared/money";
import type { Sale } from "../shared/types";
import { newPglite, pgliteClient } from "./pglite";

const mxn = (minor: number) => money(minor, "MXN");
const NOON = new Date("2026-10-06T18:00:00Z"); // 12:00 in Mexico City
const DAY = "2026-10-06";

function sale(id: string, over: Partial<Sale> = {}): Sale {
  return {
    id,
    vendorId: "rosa",
    terminalId: "rosa-01",
    lines: [{ sku: "atole", name: "Atole", qty: 2, unitPrice: mxn(2000) }],
    total: mxn(4000),
    status: "open",
    orderId: `order-${id}`,
    createdAt: "2026-10-06T17:00:00.000Z",
    expiresAt: "2026-10-06T17:05:00.000Z",
    method: "paypal",
    ...over,
  };
}

interface Harness {
  store: Store;
  /** Waits for pending writes, then opens a fresh store on the same data (a process restart). */
  restart?: () => Promise<Store>;
}

const pglites: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const db of pglites.splice(0)) await db.close();
});

async function postgresHarness(): Promise<Harness & { restart: () => Promise<PostgresStore> }> {
  const db = newPglite();
  pglites.push(db);
  const store = await PostgresStore.open(pgliteClient(db));
  let current = store;
  return {
    store,
    restart: async () => {
      await current.flush();
      current = await PostgresStore.open(pgliteClient(db));
      return current;
    },
  };
}

const harnesses: [string, () => Promise<Harness>][] = [
  ["MemoryStore", async () => ({ store: new MemoryStore() })],
  ["PostgresStore", postgresHarness],
];

describe.each(harnesses)("Store contract: %s", (_name, make) => {
  it("seeds the demo vendor and terminal", async () => {
    const { store } = await make();
    expect(store.getVendor("rosa")).toEqual(DEMO_VENDOR);
    expect(store.getTerminal("rosa-01")?.vendorId).toBe("rosa");
    expect(store.getVendor("nobody")).toBeUndefined();
  });

  it("saves, updates and finds sales, newest first", async () => {
    const { store } = await make();
    store.saveSale(sale("a"));
    store.saveSale(sale("b", { terminalId: "other" }));
    store.saveSale(sale("a", { status: "paid", captureId: "cap-a", paidAt: NOON.toISOString() }));
    expect(store.getSale("a")?.status).toBe("paid");
    expect(store.findSaleByOrderId("order-b")?.id).toBe("b");
    expect(store.findSaleByCaptureId("cap-a")?.id).toBe("a");
    expect(store.salesForTerminal("rosa-01").map((s) => s.id)).toEqual(["a"]);
    expect(store.allSales().map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("replaces the catalog and patches the vendor", async () => {
    const { store } = await make();
    store.updateVendor("rosa", { pricesNeedReview: true, currency: "USD" });
    store.setCatalog("rosa", [
      { sku: "x", name: "X", aliases: ["equis"], price: money(150, "USD") },
    ]);
    const v = store.getVendor("rosa");
    expect(v?.catalog).toEqual([
      { sku: "x", name: "X", aliases: ["equis"], price: money(150, "USD") },
    ]);
    expect(v?.pricesNeedReview).toBe(false);
    expect(v?.currency).toBe("USD");
    expect(() => store.setCatalog("nobody", [])).toThrow();
  });

  it("tracks refunds per capture and cap usage per day and currency", async () => {
    const { store } = await make();
    expect(store.refundedForCapture("cap")).toBe(0);
    expect(store.addRefund("cap", 100)).toBe(100);
    expect(store.addRefund("cap", 50)).toBe(150);
    store.addUsage(DAY, "MXN", 100, 0);
    store.addUsage(DAY, "MXN", 50, 20);
    store.addUsage("2026-10-05", "MXN", 999, 0);
    expect(store.usageForDay(DAY)).toEqual([{ currency: "MXN", refunded: 150, paidOut: 20 }]);
  });

  it("keeps the audit log and PIN lockout state", async () => {
    const { store } = await make();
    const engine = new PolicyEngine({ vendorName: "Rosa", pin: "4321", now: () => NOON, store });
    for (let i = 0; i < 5; i++) engine.verifyPin("vendor", "0000", ["ip:1"]);
    expect(store.auditEntries()).toHaveLength(5);
    expect(store.pinState()?.clients[0]).toMatchObject({ key: "ip:1", lockouts: 1 });
  });
});

describe("PostgresStore restart", () => {
  it("keeps sales, catalog, vendor, refunds, audit, PIN lockout and cap usage", async () => {
    const h = await postgresHarness();
    const { store } = h;
    store.saveSale(sale("s1", { status: "paid", captureId: "cap-1", paidAt: NOON.toISOString() }));
    store.setCatalog("rosa", [{ sku: "elote", name: "Corn", aliases: [], price: mxn(3000) }]);
    store.updateVendor("rosa", { displayName: "Rosa B", onboarded: true });
    store.addRefund("cap-1", 1000);
    const engine = new PolicyEngine({ vendorName: "Rosa", pin: "4321", now: () => NOON, store });
    const d = engine.decide(
      {
        kind: "refund",
        saleId: "s1",
        captureId: "cap-1",
        amount: mxn(1000),
        capturedAt: NOON.toISOString(),
        capturedAmount: mxn(4000),
        alreadyRefunded: mxn(0),
      },
      { actor: "vendor", pin: "4321" },
    );
    expect(d.allow).toBe(true);
    engine.commit(d.ticket as string);
    for (let i = 0; i < 5; i++) engine.verifyPin("vendor", "0000", ["ip:9"]);
    const audit = engine.audit.entries();

    const again = await h.restart();
    expect(again.getSale("s1")).toEqual(store.getSale("s1"));
    expect(again.getVendor("rosa")).toEqual(store.getVendor("rosa"));
    expect(again.refundedForCapture("cap-1")).toBe(1000);
    const reborn = new PolicyEngine({
      vendorName: "Rosa",
      pin: "4321",
      now: () => NOON,
      store: again,
    });
    expect(reborn.totals().refunded).toEqual(mxn(1000));
    expect(reborn.audit.entries()).toEqual(audit);
    expect(reborn.verifyPin("vendor", "4321", ["ip:9"]).code).toBe("PIN_LOCKED");
    reborn.verifyPin("vendor", "4321", ["ip:other"]);
    expect(reborn.audit.entries().at(-1)?.seq).toBe(audit.length + 2);
  });

  it("migrations are idempotent", async () => {
    const h = await postgresHarness();
    await h.restart();
    await h.restart();
    expect(h.store.getVendor("rosa")).toBeDefined();
  });

  it("concurrent refunds never overspend the daily cap, before or after a restart", async () => {
    const h = await postgresHarness();
    const engine = new PolicyEngine({
      vendorName: "Rosa",
      pin: "4321",
      now: () => NOON,
      store: h.store,
    });
    // Cap: 1,000 MXN/day; each refund 200 MXN on its own capture: only 5 of 12 may pass.
    const attempt = async (i: number) => {
      const d = engine.decide(
        {
          kind: "refund",
          saleId: `s${i}`,
          captureId: `cap-${i}`,
          amount: mxn(20000),
          capturedAt: NOON.toISOString(),
          capturedAmount: mxn(50000),
          alreadyRefunded: mxn(0),
        },
        { actor: "vendor", pin: "4321" },
      );
      if (!d.allow || !d.ticket) return false;
      await new Promise((r) => setTimeout(r, Math.random() * 20)); // PayPal round-trip
      return engine.commit(d.ticket);
    };
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => attempt(i)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(engine.totals().refunded).toEqual(mxn(100000));

    const again = await h.restart();
    expect(again.usageForDay(DAY)).toEqual([{ currency: "MXN", refunded: 100000, paidOut: 0 }]);
    const reborn = new PolicyEngine({
      vendorName: "Rosa",
      pin: "4321",
      now: () => NOON,
      store: again,
    });
    expect(reborn.totals().refunded).toEqual(mxn(100000));
  });

  it("two processes incrementing the same counters never lose an update", async () => {
    const db = newPglite();
    pglites.push(db);
    const a = await PostgresStore.open(pgliteClient(db));
    const b = await PostgresStore.open(pgliteClient(db));
    for (let i = 0; i < 25; i++) {
      a.addUsage(DAY, "MXN", 100, 0);
      b.addUsage(DAY, "MXN", 100, 1);
      a.addRefund("cap", 10);
      b.addRefund("cap", 10);
    }
    await Promise.all([a.flush(), b.flush()]);
    const c = await PostgresStore.open(pgliteClient(db));
    expect(c.usageForDay(DAY)).toEqual([{ currency: "MXN", refunded: 5000, paidOut: 25 }]);
    expect(c.refundedForCapture("cap")).toBe(500);
    expect(a.writeErrors + b.writeErrors).toBe(0);
  });
});

describe("sslFromUrl", () => {
  it("maps sslmode to pg's ssl option and strips it from the URL", () => {
    expect(sslFromUrl("postgres://u:p@localhost/db").ssl).toBe(false);
    const req = sslFromUrl("postgres://u:p@ep-x.neon.tech/db?sslmode=require");
    expect(req.ssl).toEqual({ rejectUnauthorized: true });
    expect(req.connectionString).not.toContain("sslmode");
    expect(sslFromUrl("postgres://h/db?sslmode=no-verify").ssl).toEqual({
      rejectUnauthorized: false,
    });
  });
});
