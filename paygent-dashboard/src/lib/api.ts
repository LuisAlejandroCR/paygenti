// Single data layer. In sandbox mode it serves seeded mock data; set SANDBOX=false
// to hit the real /api/* endpoints (GET /api/transactions wraps PayPal Transaction Search).
import { db, STALLS } from "./mock";
import type { Goal, Tx, TxQuery } from "./types";

export const SANDBOX = true;
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

/** Split a date range into ≤31-day windows (PayPal Transaction Search limit). */
export function chunkRange(start: string, end: string) {
  const out: { start_date: string; end_date: string }[] = [];
  let s = new Date(start).getTime();
  const e = new Date(end).getTime();
  while (s < e) {
    const ce = Math.min(e, s + 31 * DAY - 1);
    out.push({ start_date: new Date(s).toISOString(), end_date: new Date(ce).toISOString() });
    s = ce + 1;
  }
  return out;
}

const STATUS_MAP: Record<string, Tx["status"][]> = {
  S: ["COMPLETED"],
  P: ["pending_bank"],
  V: ["refunded"],
  D: ["denied"],
};

async function fetchChunk(q: TxQuery, win: { start_date: string; end_date: string }, page: number, pageSize: number) {
  if (!SANDBOX) {
    const p = new URLSearchParams({ ...win, page: String(page), page_size: String(Math.min(500, pageSize)), stall: q.stallId });
    if (q.status) p.set("transaction_status", q.status);
    const r = await fetch(`/api/transactions?${p}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as { rows: Tx[]; total: number };
  }
  const rows = db.txs.filter(
    (t) =>
      t.stallId === q.stallId &&
      t.date >= win.start_date &&
      t.date <= win.end_date &&
      (!q.status || STATUS_MAP[q.status].includes(t.status)),
  );
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
}

/** Grid datasource: merges 31-day chunks, server sorts by date desc. */
export async function getTransactions(q: TxQuery): Promise<{ rows: Tx[]; total: number }> {
  await wait(300);
  const wins = chunkRange(q.start, q.end).reverse();
  const merged: Tx[] = [];
  for (const w of wins) {
    const { rows } = await fetchChunk(q, w, 1, 500 * 20);
    merged.push(...rows);
  }
  merged.sort((a, b) => b.date.localeCompare(a.date));
  const from = (q.page - 1) * q.pageSize;
  return { rows: merged.slice(from, from + q.pageSize), total: merged.length };
}

export async function getAllForStall(stallId: string): Promise<Tx[]> {
  await wait(200);
  return db.txs.filter((t) => t.stallId === stallId).map((t) => ({ ...t }));
}

export async function getStalls() {
  return STALLS;
}
export async function getRails(stallId: string) {
  await wait(150);
  return db.rails[stallId].map((r) => ({ ...r }));
}
export async function setRailEnabled(stallId: string, rail: string, enabled: boolean) {
  await wait(400);
  const r = db.rails[stallId].find((x) => x.rail === rail);
  if (r && !r.reason) r.enabled = enabled;
}
export async function getGoals(stallId: string) {
  await wait(150);
  return db.goals[stallId].map((g) => ({ ...g }));
}
export async function saveGoal(stallId: string, goal: Goal) {
  await wait(300);
  const list = db.goals[stallId];
  const i = list.findIndex((g) => g.id === goal.id);
  if (i >= 0) list[i] = goal;
  else list.push(goal);
}
export async function confirmPending(ids: string[]) {
  await wait(500);
  db.txs.forEach((t) => {
    if (ids.includes(t.id) && t.status === "pending_bank") t.status = "COMPLETED";
  });
}
export async function executeRefund(txId: string) {
  await wait(600);
  const t = db.txs.find((x) => x.id === txId);
  if (t) t.status = "refunded";
}
export async function executePayout(stallId: string, amount: number, currency: Tx["currency"]) {
  await wait(600);
  db.txs.unshift({ id: `${stallId}-p${Date.now()}`, date: new Date().toISOString(), amount, currency, rail: "paypal", status: "COMPLETED", type: "payout", origin: "verificado", item: "Proveedor", fee: 0, stallId });
}
export async function importStatement(stallId: string, rows: Tx[]) {
  await wait(500);
  db.txs.push(...rows.map((r) => ({ ...r, stallId })));
  db.txs.sort((a, b) => b.date.localeCompare(a.date));
}
export async function getNotifications() {
  return db.notifications.map((n) => ({ ...n }));
}
export async function markRead(id: string) {
  const n = db.notifications.find((x) => x.id === id);
  if (n) n.read = true;
}
export function verifyPin(pin: string) {
  return pin === "1234";
}
