// src/lib/summary.ts: pure month math for the Resumen screen — splits ledger rows into verified
// (PayPal captured, minus refunds), self-declared (cash, vendor-confirmed transfers) and pending_bank,
// never summing the first two; per-day strip, delta vs last month and the transfers to confirm.
import type { LedgerRow } from "./api";

export interface Split {
  /** PayPal-captured money minus refunds (minor units). */
  verified: number;
  /** Cash and vendor-confirmed push-rail sales: the vendor's word, not verified. */
  declared: number;
  /** Push-rail sales still waiting for the bank: never paid. */
  pending: number;
  pendingCount: number;
}

export interface DaySplit {
  day: number;
  verified: number;
  declared: number;
}

export interface PendingTransfer {
  id: string;
  method: LedgerRow["method"];
  createdAt: string;
  total: LedgerRow["total"];
}

const MONTH = /^(\d{4})-(\d{2})$/;

function parts(month: string): [number, number] {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`summary: invalid month "${month}"`);
  return [Number(m[1]), Number(m[2])];
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = parts(month);
  return monthKey(new Date(y, m - 1 + by, 1));
}

export function daysIn(month: string): number {
  const [y, m] = parts(month);
  return new Date(y, m, 0).getDate();
}

/** Days with data so far: all of a past month, up to today in the current one, none in the future. */
export function elapsedDays(month: string, today: Date): number {
  const now = monthKey(today);
  if (month > now) return 0;
  return month === now ? today.getDate() : daysIn(month);
}

/** Same as elapsedDays, from the stall's own "YYYY-MM-DD" today (the server's, not the phone's). */
export function elapsedDaysOn(month: string, todayKey: string): number {
  const now = todayKey.slice(0, 7);
  if (month > now) return 0;
  return month === now ? Number(todayKey.slice(8, 10)) : daysIn(month);
}

/** "YYYY-MM-DD" of a local Date (the phone's guess until the server answers). */
export function localDayKey(d: Date): string {
  return dayKey(monthKey(d), d.getDate());
}

/** "2026-10-07" for day 7 of "2026-10". */
export function dayKey(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

const ZERO: Split = { verified: 0, declared: 0, pending: 0, pendingCount: 0 };

/** One ledger row's contribution; refund rows and other currencies count nothing. */
export function classify(row: LedgerRow, currency: string): Split {
  if (row.kind !== "sale" || row.total.currency !== currency) return ZERO;
  if (row.status === "pending_bank") return { ...ZERO, pending: row.total.minor, pendingCount: 1 };
  if (row.status === "vendor_confirmed") return { ...ZERO, declared: row.total.minor };
  const net = Math.max(0, row.paid.minor - row.refunded.minor);
  if (row.method === "cash") return { ...ZERO, declared: net };
  if (row.method === "paypal") return { ...ZERO, verified: net };
  return ZERO;
}

export function split(rows: readonly LedgerRow[], currency: string): Split {
  const out = { ...ZERO };
  for (const r of rows) {
    const c = classify(r, currency);
    out.verified += c.verified;
    out.declared += c.declared;
    out.pending += c.pending;
    out.pendingCount += c.pendingCount;
  }
  return out;
}

/** One entry per day of the month; `byDay` is keyed by day number (1-based). */
export function daily(
  byDay: ReadonlyMap<number, readonly LedgerRow[]>,
  month: string,
  currency: string,
): DaySplit[] {
  return Array.from({ length: daysIn(month) }, (_, i) => {
    const s = split(byDay.get(i + 1) ?? [], currency);
    return { day: i + 1, verified: s.verified, declared: s.declared };
  });
}

/** Percent change of verified money; undefined when last month had nothing to compare with. */
export function deltaPct(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined;
  return Math.round(((current - previous) / previous) * 100);
}

/** Bank transfers waiting for the vendor's PIN, newest first, without any payer data. */
export function pendingTransfers(rows: readonly LedgerRow[], limit = 5): PendingTransfer[] {
  return rows
    .filter((r) => r.kind === "sale" && r.status === "pending_bank")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({ id: r.id, method: r.method, createdAt: r.createdAt, total: r.total }));
}
