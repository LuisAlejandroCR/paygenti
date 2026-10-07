import type { Currency, Rail, Tx } from "./types";

const USD_RATE: Record<Currency, number> = { MXN: 18, BRL: 5.2, USD: 1 };
export const toStall = (t: Tx, c: Currency) => (t.currency === c ? t.amount : t.currency === "USD" ? t.amount * USD_RATE[c] : t.amount);

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const parseMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1);
};
export const shiftMonth = (m: string, n: number) => {
  const d = parseMonth(m);
  d.setMonth(d.getMonth() + n);
  return monthKey(d);
};
export const daysIn = (m: string) => {
  const d = parseMonth(m);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};
export const monthName = (m: string, locale: string, style: "long" | "short" = "long") =>
  parseMonth(m).toLocaleDateString(locale, { month: style });

export const isSale = (t: Tx) => t.type === "venta" && t.status !== "denied" && t.status !== "refunded";

export function split(txs: Tx[], c: Currency) {
  let verified = 0, declared = 0, pending = 0, pendingCount = 0;
  for (const t of txs) {
    if (t.type !== "venta") continue;
    if (t.status === "pending_bank") { pending += toStall(t, c); pendingCount++; continue; }
    if (!isSale(t)) continue;
    if (t.origin === "verificado") verified += toStall(t, c);
    else declared += toStall(t, c);
  }
  return { verified, declared, pending, pendingCount };
}

export function inMonth(txs: Tx[], m: string) {
  return txs.filter((t) => t.date.slice(0, 7) === m || monthKey(new Date(t.date)) === m);
}

export function byRail(txs: Tx[], c: Currency) {
  const map = new Map<Rail, { verified: number; declared: number }>();
  for (const t of txs) {
    if (!isSale(t) || t.status === "pending_bank") continue;
    const e = map.get(t.rail) ?? { verified: 0, declared: 0 };
    e[t.origin === "verificado" ? "verified" : "declared"] += toStall(t, c);
    map.set(t.rail, e);
  }
  return [...map.entries()].map(([rail, v]) => ({ rail, ...v, total: v.verified + v.declared })).sort((a, b) => b.total - a.total);
}

export function topItems(txs: Tx[], c: Currency) {
  const map = new Map<string, { count: number; verified: number; declared: number }>();
  for (const t of txs) {
    if (!isSale(t) || t.status === "pending_bank") continue;
    const e = map.get(t.item) ?? { count: 0, verified: 0, declared: 0 };
    e.count++;
    e[t.origin === "verificado" ? "verified" : "declared"] += toStall(t, c);
    map.set(t.item, e);
  }
  return [...map.entries()].map(([item, v]) => ({ item, ...v })).sort((a, b) => b.verified + b.declared - (a.verified + a.declared)).slice(0, 5);
}

export function daily(txs: Tx[], m: string, c: Currency, uptoDay?: number) {
  const n = uptoDay ?? daysIn(m);
  const rows = Array.from({ length: n }, (_, i) => ({ day: i + 1, verified: 0, declared: 0, count: 0, avg7: 0 }));
  for (const t of inMonth(txs, m)) {
    if (!isSale(t) || t.status === "pending_bank") continue;
    const d = new Date(t.date).getDate();
    if (d > n) continue;
    rows[d - 1][t.origin === "verificado" ? "verified" : "declared"] += toStall(t, c);
    rows[d - 1].count++;
  }
  rows.forEach((r, i) => {
    const w = rows.slice(Math.max(0, i - 6), i + 1);
    r.avg7 = w.reduce((s, x) => s + x.verified + x.declared, 0) / w.length;
  });
  return rows;
}

export function heatmap(txs: Tx[]) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(16).fill(0)); // hours 7..22
  for (const t of txs) {
    if (!isSale(t)) continue;
    const d = new Date(t.date);
    const h = d.getHours() - 7;
    if (h >= 0 && h < 16) grid[(d.getDay() + 6) % 7][h]++;
  }
  return grid;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
export function downloadBlob(content: string | Blob, name: string, type = "text/csv") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
