// adapter.test.ts: server JSON → dashboard types; checks the verified/self-declared split,
// that pending_bank never becomes paid, refunds and payouts, statement months and goals.
import { describe, expect, it } from "vitest";
import {
  daysBetween,
  fromMinor,
  goalBody,
  mapApprovals,
  mapGoal,
  mapLedger,
  mapLedgerRow,
  mapStall,
  mapStatementMonths,
  toMinor,
  type SLedgerRow,
} from "@/lib/adapter";
import { split } from "@/lib/stats";

const mxn = (minor: number) => ({ minor, currency: "MXN" });
const row = (o: Partial<SLedgerRow>): SLedgerRow => ({
  id: "s1",
  kind: "sale",
  method: "paypal",
  status: "paid",
  createdAt: "2026-10-07T15:00:00.000Z",
  paidAt: "2026-10-07T15:01:00.000Z",
  total: mxn(9500),
  paid: mxn(9500),
  refunded: mxn(0),
  items: "2 × Tamal verde, 1 × Atole",
  lines: [{ name: "Tamal verde", qty: 2 }],
  reconciliation: "matched",
  ...o,
});

describe("money", () => {
  it("converts minor units by currency exponent", () => {
    expect(fromMinor(mxn(9500))).toBe(95);
    expect(fromMinor({ minor: 950, currency: "JPY" })).toBe(950);
    expect(toMinor(95.5, "MXN")).toBe(9550);
  });
});

describe("mapLedgerRow", () => {
  it("PayPal captured sale is verified and paid", () => {
    const [t] = mapLedgerRow(row({}), "rosa");
    expect(t).toMatchObject({
      id: "s1",
      amount: 95,
      currency: "MXN",
      rail: "paypal",
      status: "COMPLETED",
      type: "venta",
      origin: "verificado",
      item: "Tamal verde",
      stallId: "rosa",
      date: "2026-10-07T15:01:00.000Z",
    });
  });
  it("cash and vendor-confirmed are self-declared", () => {
    expect(mapLedgerRow(row({ method: "cash", reconciliation: "cash" }), "r")[0]?.origin).toBe(
      "autodeclarado",
    );
    const [v] = mapLedgerRow(
      row({
        method: "spei",
        status: "vendor_confirmed",
        reconciliation: "vendor_confirmed",
        paid: mxn(0),
      }),
      "r",
    );
    expect(v).toMatchObject({ status: "COMPLETED", origin: "autodeclarado" });
  });
  it("PayPal without capture is not verified", () => {
    expect(mapLedgerRow(row({ reconciliation: "missing_capture" }), "r")[0]?.origin).toBe(
      "autodeclarado",
    );
  });
  it("pending_bank stays pending, never paid", () => {
    const [p] = mapLedgerRow(
      row({
        method: "pix",
        status: "pending_bank",
        paidAt: null,
        paid: mxn(0),
        reconciliation: "pending",
      }),
      "r",
    );
    expect(p?.status).toBe("pending_bank");
    const s = split([p!], "MXN");
    expect(s.verified + s.declared).toBe(0);
    expect(s.pending).toBe(95);
  });
  it("drops open sales and maps failed to denied", () => {
    expect(mapLedgerRow(row({ status: "open" }), "r")).toEqual([]);
    expect(mapLedgerRow(row({ status: "expired" }), "r")[0]?.status).toBe("denied");
  });
  it("full refund marks the sale refunded; partial adds a refund line", () => {
    expect(
      mapLedgerRow(row({ status: "refunded", refunded: mxn(9500), kind: "refund" }), "r"),
    ).toHaveLength(1);
    const two = mapLedgerRow(
      row({ refunded: mxn(2000), kind: "refund", reconciliation: "partial_refund" }),
      "r",
    );
    expect(two).toHaveLength(2);
    expect(two[1]).toMatchObject({ id: "s1-r", type: "reembolso", amount: 20 });
  });
  it("never carries payer data: item comes from the sale lines", () => {
    const [t] = mapLedgerRow(row({ lines: [], items: "3 × Champurrado" }), "r");
    expect(t?.item).toBe("Champurrado");
    expect(Object.keys(t!)).not.toContain("payer");
  });
});

describe("mapLedger", () => {
  it("keeps verified and self-declared apart in the totals", () => {
    const txs = mapLedger(
      {
        day: "2026-10-07",
        rows: [
          row({}),
          row({
            id: "s2",
            method: "cash",
            reconciliation: "cash",
            total: mxn(5000),
            paid: mxn(5000),
          }),
        ],
        payouts: [
          { id: "p1", amount: mxn(30000), status: "SUCCESS", supplierName: "Masa SA" },
          { id: "p2", amount: mxn(100), status: "PENDING" },
        ],
      },
      "rosa",
    );
    const s = split(txs, "MXN");
    expect(s.verified).toBe(95);
    expect(s.declared).toBe(50);
    const payouts = txs.filter((t) => t.type === "payout");
    expect(payouts.map((p) => p.status)).toEqual(["COMPLETED", "pending_bank"]);
    expect(payouts[0]?.date).toBe("2026-10-07T12:00:00.000Z");
  });
});

describe("other mappers", () => {
  it("stall rails follow the currency", () => {
    expect(mapStall({ id: "rosa", displayName: "Rosa", currency: "MXN" }).rails).toContain("spei");
    expect(mapStall({ id: "x", displayName: "X", currency: "BRL" }).rails).toContain("pix");
  });
  it("statement months are self-declared aggregates", () => {
    const [m] = mapStatementMonths(
      [{ month: "2026-09", currency: "MXN", inflow: 1234500, count: 40 }],
      "rosa",
    );
    expect(m).toMatchObject({
      amount: 12345,
      origin: "autodeclarado",
      rail: "bank",
      date: "2026-09-15T12:00:00.000Z",
    });
  });
  it("goal round-trips minor units", () => {
    const [g] = mapGoal({ currency: "MXN", target: 600000, saved: 410000 });
    expect(g).toMatchObject({ target: 6000, saved: 4100 });
    expect(goalBody(g!, "MXN")).toEqual({ targetMinor: 600000, savedMinor: 410000 });
    expect(mapGoal(null)).toEqual([]);
  });
  it("only pending approvals become notices, without Claude's note", () => {
    const n = mapApprovals([
      {
        id: "a1",
        kind: "refund",
        status: "pending",
        amount: mxn(5000),
        createdAt: "2026-10-07T10:00:00Z",
      },
      {
        id: "a2",
        kind: "payout",
        status: "approved",
        amount: mxn(5000),
        createdAt: "2026-10-07T10:00:00Z",
      },
    ]);
    expect(n).toHaveLength(1);
    expect(n[0]?.text).toContain("50 MXN");
  });
  it("lists days newest first", () => {
    expect(daysBetween(new Date(2026, 8, 29), new Date(2026, 9, 1))).toEqual([
      "2026-10-01",
      "2026-09-30",
      "2026-09-29",
    ]);
  });
});
