// test/feed.test.ts: SSE feed logic — event parsing, dedupe of replayed events (a reconnect re-sends
// the open sale; a paid sale must be announced once) and the reconnect backoff.
import type { Sale, TerminalEvent } from "@shared/types";
import { backoffMs, EventDeduper, eventKey, parseEvent, viewFor } from "@/lib/feed";

const sale = (id: string, status: Sale["status"] = "open"): Sale => ({
  id,
  vendorId: "rosa",
  terminalId: "rosa-01",
  lines: [],
  total: { minor: 9500, currency: "MXN" },
  status,
  orderId: "o1",
  createdAt: "2026-10-06T12:00:00Z",
  expiresAt: "2026-10-06T12:05:00Z",
  method: "paypal",
});

describe("parseEvent", () => {
  it("accepts sale events and rejects pings and garbage", () => {
    const e = parseEvent(JSON.stringify({ type: "sale.paid", sale: sale("a", "paid") }));
    expect(e?.type).toBe("sale.paid");
    expect(parseEvent("{}")).toBeUndefined();
    expect(parseEvent("not json")).toBeUndefined();
    expect(parseEvent(null)).toBeUndefined();
    expect(parseEvent(JSON.stringify({ type: "sale.paid", sale: {} }))).toBeUndefined();
  });
});

describe("EventDeduper", () => {
  it("passes each transition once, even when replayed after a reconnect", () => {
    const d = new EventDeduper();
    const open: TerminalEvent = { type: "sale.open", sale: sale("a") };
    const paid: TerminalEvent = { type: "sale.paid", sale: sale("a", "paid") };
    expect(d.accept(open)).toBe(true);
    expect(d.accept(open)).toBe(false);
    expect(d.accept(paid)).toBe(true);
    expect(d.accept({ ...paid })).toBe(false);
    expect(d.accept({ type: "sale.paid", sale: sale("b", "paid") })).toBe(true);
  });

  it("treats two partial refunds of different amounts as different events", () => {
    const d = new EventDeduper();
    const r = (minor: number): TerminalEvent => ({
      type: "sale.refunded",
      sale: sale("a", "refunded"),
      amount: { minor, currency: "MXN" },
    });
    expect(d.accept(r(100))).toBe(true);
    expect(d.accept(r(200))).toBe(true);
    expect(d.accept(r(100))).toBe(false);
    expect(eventKey(r(100))).toBe("sale.refunded:a:100");
  });

  it("forgets the oldest keys beyond its window", () => {
    const d = new EventDeduper(2);
    const ev = (id: string): TerminalEvent => ({ type: "sale.open", sale: sale(id) });
    d.accept(ev("a"));
    d.accept(ev("b"));
    d.accept(ev("c"));
    expect(d.accept(ev("a"))).toBe(true);
    expect(d.accept(ev("c"))).toBe(false);
  });
});

describe("backoff and views", () => {
  it("doubles from 1s and caps at 30s", () => {
    expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 30000]);
    expect(backoffMs(-1)).toBe(1000);
  });

  it("maps an event to its soundbox view", () => {
    expect(viewFor({ type: "sale.expired", sale: sale("a", "expired") }).kind).toBe("expired");
  });
});
