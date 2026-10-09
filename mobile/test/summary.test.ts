// test/summary.test.ts: Resumen month math — verified and self-declared stay apart, pending_bank is
// never paid, refunds and other currencies are excluded, delta and calendar helpers behave.
import type { LedgerRow } from "@/lib/api";
import {
  classify,
  daily,
  daysIn,
  deltaPct,
  elapsedDays,
  pendingTransfers,
  shiftMonth,
  split,
} from "@/lib/summary";

const m = (minor: number, currency = "MXN") => ({ minor, currency }) as LedgerRow["total"];
function row(p: Partial<Omit<LedgerRow, "total">> & { total: number }): LedgerRow {
  const { total, ...rest } = p;
  return {
    id: Math.random().toString(36).slice(2),
    kind: "sale",
    method: "paypal",
    status: "paid",
    terminalId: "rosa-01",
    createdAt: "2026-10-07T10:00:00.000Z",
    paidAt: "2026-10-07T10:01:00.000Z",
    total: m(total),
    paid: m(total),
    refunded: m(0),
    ...rest,
  } as LedgerRow;
}

describe("summary split", () => {
  const rows = [
    row({ total: 1000 }),
    row({ total: 500, refunded: m(200) }),
    row({ total: 300, method: "cash" }),
    row({ total: 700, method: "spei", status: "vendor_confirmed", paid: m(0) }),
    row({ total: 900, method: "breb", status: "pending_bank", paid: m(0), paidAt: null }),
    { ...row({ total: 0 }), total: m(400, "USD"), paid: m(400, "USD") },
  ];

  it("keeps verified, self-declared and pending apart", () => {
    expect(split(rows, "MXN")).toEqual({ verified: 1300, declared: 1000, pending: 900, pendingCount: 1 });
  });

  it("never counts pending_bank as paid", () => {
    const c = classify(rows[4] as LedgerRow, "MXN");
    expect(c.verified + c.declared).toBe(0);
    expect(c.pending).toBe(900);
  });

  it("ignores refund rows and other currencies", () => {
    expect(classify(row({ total: 50, kind: "refund" }), "MXN").verified).toBe(0);
    expect(classify(rows[5] as LedgerRow, "MXN").verified).toBe(0);
  });

  it("lists pending transfers newest first with no payer data", () => {
    const a = row({ total: 1, status: "pending_bank", createdAt: "2026-10-01T00:00:00Z" });
    const b = row({ total: 2, status: "pending_bank", createdAt: "2026-10-02T00:00:00Z" });
    const list = pendingTransfers([a, row({ total: 3 }), b]);
    expect(list.map((p) => p.total.minor)).toEqual([2, 1]);
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(["createdAt", "id", "method", "total"]);
  });
});

describe("summary calendar", () => {
  it("shifts months and counts days", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(daysIn("2028-02")).toBe(29);
    expect(() => daysIn("2026-1")).toThrow();
  });

  it("counts elapsed days", () => {
    const today = new Date(2026, 9, 7);
    expect(elapsedDays("2026-10", today)).toBe(7);
    expect(elapsedDays("2026-09", today)).toBe(30);
    expect(elapsedDays("2026-11", today)).toBe(0);
  });

  it("builds one entry per day", () => {
    const d = daily(new Map([[3, [row({ total: 100 }), row({ total: 50, method: "cash" })]]]), "2026-09", "MXN");
    expect(d).toHaveLength(30);
    expect(d[2]).toEqual({ day: 3, verified: 100, declared: 50 });
    expect(d[0]).toEqual({ day: 1, verified: 0, declared: 0 });
  });

  it("computes delta only with a base", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(10, 0)).toBeUndefined();
  });
});
