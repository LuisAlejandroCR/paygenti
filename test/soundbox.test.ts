// test/soundbox.test.ts: soundbox logic — only a server-confirmed sale.paid announces, each sale id
// at most once (also across a reload via the stored set), storage failures degrade safely, backoff.
import { describe, expect, it } from "vitest";
import { money } from "../shared/money";
import type { Sale, TerminalEvent } from "../shared/types";
import {
  AnnouncedSales,
  applyEvent,
  backoffMs,
  type KeyValue,
  type SoundboxView,
} from "../web/src/soundbox-logic";

const sale = (id: string, status: Sale["status"] = "open"): Sale => ({
  id,
  vendorId: "rosa",
  terminalId: "rosa-01",
  lines: [],
  total: money(9500, "MXN"),
  status,
  orderId: `o-${id}`,
  createdAt: "2026-10-06T00:00:00Z",
  expiresAt: "2026-10-06T00:10:00Z",
  method: "paypal",
});

class MemoryKV implements KeyValue {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const idle: SoundboxView = { kind: "idle" };

describe("applyEvent", () => {
  it("open shows the amount and does not announce", () => {
    const r = applyEvent(idle, { type: "sale.open", sale: sale("a") }, new AnnouncedSales());
    expect(r.view.kind).toBe("open");
    expect(r.announce).toBeUndefined();
  });

  it("paid announces once per sale id", () => {
    const set = new AnnouncedSales();
    const ev: TerminalEvent = { type: "sale.paid", sale: sale("a", "paid") };
    const first = applyEvent(idle, ev, set);
    expect(first.view.kind).toBe("paid");
    expect(first.announce).toEqual(money(9500, "MXN"));
    expect(applyEvent(first.view, ev, set).announce).toBeUndefined();
    expect(applyEvent(idle, { type: "sale.paid", sale: sale("b") }, set).announce).toBeDefined();
  });

  it("failed, expired, cancelled and refunded never announce", () => {
    const set = new AnnouncedSales();
    const s = sale("c");
    const events: TerminalEvent[] = [
      { type: "sale.failed", sale: s, reason: "DECLINED" },
      { type: "sale.expired", sale: s },
      { type: "sale.cancelled", sale: s },
      { type: "sale.refunded", sale: s, amount: s.total },
    ];
    for (const ev of events) {
      const r = applyEvent(idle, ev, set);
      expect(r.view.kind).toBe(ev.type.slice(5));
      expect(r.announce).toBeUndefined();
    }
  });
});

describe("AnnouncedSales", () => {
  it("survives a reload through storage", () => {
    const kv = new MemoryKV();
    expect(new AnnouncedSales(kv).claim("x")).toBe(true);
    const reloaded = new AnnouncedSales(kv);
    expect(reloaded.has("x")).toBe(true);
    expect(reloaded.claim("x")).toBe(false);
  });

  it("ignores junk and throwing storage", () => {
    const junk = new MemoryKV();
    junk.setItem("paygent.soundbox.announced", "{not json");
    expect(new AnnouncedSales(junk).claim("y")).toBe(true);
    const broken: KeyValue = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const set = new AnnouncedSales(broken);
    expect(set.claim("z")).toBe(true);
    expect(set.claim("z")).toBe(false);
  });

  it("keeps only the most recent ids", () => {
    const set = new AnnouncedSales(undefined, 2);
    set.claim("1");
    set.claim("2");
    set.claim("3");
    expect(set.has("1")).toBe(false);
    expect(set.has("3")).toBe(true);
  });
});

describe("backoffMs", () => {
  it("doubles from 1s and caps at 30s", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(20)).toBe(30_000);
  });
});
