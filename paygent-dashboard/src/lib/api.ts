// api.ts: single data layer. With VITE_PAYGENT_API set it talks to the real Paygent server
// (Hono: /api/stalls, /api/stalls/:id/backoffice/*, /api/sales/:id/vendor-confirm) through a PIN
// session; without it, it serves the seeded mock data in mock.ts and the header shows "Sandbox".
import {
  chargeState,
  daysBetween,
  pinOutcome,
  goalBody,
  mapApprovals,
  mapGoal,
  mapLedger,
  mapStall,
  mapStatementMonths,
  railsFor,
  toMinor,
  type SApproval,
  type SGoal,
  type SLedger,
  type SStall,
  type SStatementMonth,
  type ChargeState,
  type PinOutcome,
} from "./adapter";
import { db, STALLS, TODAY } from "./mock";
import type { Goal, Notification, RailInfo, Stall, Tx, TxQuery } from "./types";

/** Base URL of the Paygent server ("" = same origin through the Vite proxy). Unset = mock. */
const RAW = import.meta.env["VITE_PAYGENT_API"] as string | undefined;
export const LIVE = RAW !== undefined && RAW !== "";
export const SANDBOX = !LIVE;
const BASE =
  LIVE && /^https?:\/\//.test(RAW ?? "") && !import.meta.env.DEV ? RAW!.replace(/\/$/, "") : "";
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

/** Thrown when the server answers 401 SESSION_REQUIRED: the UI asks for the stall PIN. */
export class SessionRequired extends Error {
  constructor() {
    super("SESSION_REQUIRED");
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

// ---- session (one bearer token per stall, kept for the tab only) ----
let active = "";
const tokens = new Map<string, string>();
const tokenKey = (id: string) => `paygent-session-${id}`;
function token(id: string) {
  if (!tokens.has(id)) {
    try {
      const t = sessionStorage.getItem(tokenKey(id));
      if (t) tokens.set(id, t);
    } catch {
      /* storage blocked */
    }
  }
  return tokens.get(id);
}
export function setActiveStall(id: string) {
  active = id;
}
export const hasSession = (id = active) => SANDBOX || !!token(id);
const office = (id: string) => `/api/stalls/${encodeURIComponent(id)}/backoffice`;

async function call<T>(path: string, init: RequestInit & { stall?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = init.stall ? token(init.stall) : undefined;
  if (t) headers.set("authorization", `Bearer ${t}`);
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  const r = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 401 && body.error === "SESSION_REQUIRED") {
    if (init.stall) {
      tokens.delete(init.stall);
      try {
        sessionStorage.removeItem(tokenKey(init.stall));
      } catch {
        /* ignore */
      }
    }
    throw new SessionRequired();
  }
  if (!r.ok) throw new ApiError(r.status, body.error ?? `HTTP_${r.status}`);
  return body as T;
}

/** Checks the PIN. Live: POST /session, which also opens the stall's 8 h session. Tells a wrong
 *  PIN apart from a lockout (429) and from a server that cannot be reached. */
export async function checkPin(pin: string, stallId = active): Promise<PinOutcome> {
  if (SANDBOX) return pin === "1234" ? "ok" : "wrong";
  try {
    const r = await call<{ token: string }>(`${office(stallId)}/session`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
    tokens.set(stallId, r.token);
    try {
      sessionStorage.setItem(tokenKey(stallId), r.token);
    } catch {
      /* ignore */
    }
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return pinOutcome(e.status, e.code);
    if (e instanceof SessionRequired) return "wrong";
    return "offline";
  }
}
export async function verifyPin(pin: string, stallId = active): Promise<boolean> {
  return (await checkPin(pin, stallId)) === "ok";
}

// ---- live charge: a sale on the stall's terminal; the customer pays on /t/<terminal> ----
export interface LiveCharge {
  saleId: string;
  payUrl: string;
  qrUrl: string;
}
/** Live only. POST /api/terminals/:id/sales with the amount in minor units. */
export async function createCharge(
  terminalId: string,
  amount: number,
  currency: string,
): Promise<LiveCharge> {
  const t = encodeURIComponent(terminalId);
  // The stall's back-office session authorizes the charge (the server refuses anonymous ones).
  const r = await call<{ sale: { id: string } }>(`/api/terminals/${t}/sales`, {
    method: "POST",
    body: JSON.stringify({ amount: toMinor(amount, currency) }),
    stall: active,
  });
  const info = await call<{ payUrl: string }>(`/api/terminals/${t}`);
  return { saleId: r.sale.id, payUrl: info.payUrl, qrUrl: `${BASE}/api/terminals/${t}/qr.svg` };
}
/** Live only. Reads the sale back; "paid" only after the server recorded the PayPal capture. */
export async function chargeStatus(saleId: string): Promise<ChargeState> {
  const r = await call<{ sale: { status: string } }>(`/api/sales/${encodeURIComponent(saleId)}`);
  return chargeState(r.sale.status);
}
export async function cancelCharge(saleId: string) {
  await call(`/api/sales/${encodeURIComponent(saleId)}/cancel`, {
    method: "POST",
    stall: active,
  }).catch(() => undefined);
}

/** Split a date range into ≤31-day windows (kept for the grid datasource). */
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

// ---- live transactions: the server has a per-day ledger, so we fetch day by day and cache ----
const liveCache = new Map<string, Promise<Tx[]>>();
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await f(items[k]);
      }
    }),
  );
  return out;
}
async function liveTxs(stallId: string): Promise<Tx[]> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1); // this month + last (for "vs")
  const days = daysBetween(from, now);
  const ledgers = await pool(days, 6, (d) =>
    call<SLedger>(`${office(stallId)}/ledger?date=${d}`, { stall: stallId }),
  );
  const fp = await call<{ statement: SStatementMonth[] }>(`${office(stallId)}/footprint`, {
    stall: stallId,
  });
  const txs = [
    ...ledgers.flatMap((l) => mapLedger(l, stallId)),
    ...mapStatementMonths(fp.statement, stallId),
  ];
  return txs.sort((a, b) => b.date.localeCompare(a.date));
}
function cachedLive(stallId: string, fresh = false) {
  if (fresh || !liveCache.has(stallId)) {
    const p = liveTxs(stallId);
    p.catch(() => liveCache.delete(stallId));
    liveCache.set(stallId, p);
  }
  return liveCache.get(stallId)!;
}

/** Grid datasource: rows for a date range, date desc, paged. */
export async function getTransactions(q: TxQuery): Promise<{ rows: Tx[]; total: number }> {
  const all = LIVE ? await cachedLive(q.stallId) : (await wait(300), db.txs);
  const rows = all
    .filter(
      (t) =>
        t.stallId === q.stallId &&
        t.date >= q.start &&
        t.date <= q.end &&
        (!q.status || STATUS_MAP[q.status].includes(t.status)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const from = (q.page - 1) * q.pageSize;
  return { rows: rows.slice(from, from + q.pageSize), total: rows.length };
}

export async function getAllForStall(stallId: string): Promise<Tx[]> {
  if (LIVE) return (await cachedLive(stallId, true)).map((t) => ({ ...t }));
  await wait(200);
  return db.txs.filter((t) => t.stallId === stallId).map((t) => ({ ...t }));
}

export async function getStalls(): Promise<Stall[]> {
  if (!LIVE) return STALLS;
  const r = await call<{ stalls: SStall[] }>("/api/stalls");
  return r.stalls.map(mapStall);
}

/** Mock-only stats (conversion, confirm time): the server has no rail metrics endpoint. */
export async function getRails(stallId: string, currency = "MXN"): Promise<RailInfo[]> {
  await wait(150);
  if (LIVE || !db.rails[stallId])
    return railsFor(currency).map((rail) => ({
      rail,
      enabled: true,
      conversion: -1,
      avgConfirmMin: -1,
      trend: [],
    }));
  return db.rails[stallId].map((r) => ({ ...r }));
}
/** Mock-only: rails are chosen per sale on the server; there is no toggle endpoint. */
export async function setRailEnabled(stallId: string, rail: string, enabled: boolean) {
  await wait(400);
  const r = db.rails[stallId]?.find((x) => x.rail === rail);
  if (r && !r.reason) r.enabled = enabled;
}

export async function getGoals(stallId: string): Promise<Goal[]> {
  if (LIVE) {
    const r = await call<{ goal: SGoal | null }>(`${office(stallId)}/footprint`, {
      stall: stallId,
    });
    return mapGoal(r.goal);
  }
  await wait(150);
  return (db.goals[stallId] ?? []).map((g) => ({ ...g }));
}
export async function saveGoal(stallId: string, goal: Goal, currency = "MXN") {
  if (LIVE) {
    await call(`${office(stallId)}/savings-goal`, {
      method: "PUT",
      stall: stallId,
      body: JSON.stringify(goalBody(goal, currency)),
    });
    return;
  }
  await wait(300);
  const list = (db.goals[stallId] ??= []);
  const i = list.findIndex((g) => g.id === goal.id);
  if (i >= 0) list[i] = goal;
  else list.push(goal);
}

/** Vendor confirms push-rail payments she saw in her bank app: stays "not verified". */
export async function confirmPending(ids: string[], pin = "") {
  if (LIVE) {
    for (const id of ids)
      await call(`/api/sales/${encodeURIComponent(id)}/vendor-confirm`, {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
    return;
  }
  await wait(500);
  db.txs.forEach((t) => {
    if (ids.includes(t.id) && t.status === "pending_bank") {
      t.status = "COMPLETED";
      t.origin = "autodeclarado";
    }
  });
}
export async function executeRefund(
  tx: Pick<Tx, "id" | "amount" | "currency" | "stallId">,
  pin = "",
) {
  if (LIVE) {
    await call(`${office(tx.stallId)}/refunds`, {
      method: "POST",
      stall: tx.stallId,
      body: JSON.stringify({ saleId: tx.id, amountMinor: toMinor(tx.amount, tx.currency), pin }),
    });
    return;
  }
  await wait(600);
  const t = db.txs.find((x) => x.id === tx.id);
  if (t) t.status = "refunded";
}

export interface Supplier {
  id: string;
  name: string;
}
export async function getSuppliers(stallId: string): Promise<Supplier[]> {
  if (!LIVE) return [{ id: "demo", name: "PayPal ••42" }];
  const r = await call<{ suppliers: Array<{ id: string; name: string }> }>(
    `${office(stallId)}/suppliers`,
    { stall: stallId },
  );
  return r.suppliers.map((s) => ({ id: s.id, name: s.name }));
}
export async function executePayout(
  stallId: string,
  amount: number,
  currency: Tx["currency"],
  pin = "",
  supplierId = "demo",
) {
  if (LIVE) {
    await call(`${office(stallId)}/payouts`, {
      method: "POST",
      stall: stallId,
      body: JSON.stringify({
        supplierId,
        amountMinor: toMinor(amount, currency),
        pin,
        requestId: crypto.randomUUID(),
      }),
    });
    return;
  }
  await wait(600);
  db.txs.unshift({
    id: `${stallId}-p${Date.now()}`,
    date: new Date().toISOString(),
    amount,
    currency,
    rail: "paypal",
    status: "COMPLETED",
    type: "payout",
    origin: "verificado",
    item: "Proveedor",
    fee: 0,
    stallId,
  });
}

/** Live: the server parses the file itself and keeps only monthly aggregates (self-declared). */
export async function importStatement(
  stallId: string,
  rows: Tx[],
  file?: File,
  pin = "",
  currency?: string,
) {
  if (LIVE && file) {
    const form = new FormData();
    form.set("file", file);
    form.set("pin", pin);
    if (currency) form.set("currency", currency);
    await call(`${office(stallId)}/statement`, { method: "POST", stall: stallId, body: form });
    return;
  }
  await wait(500);
  db.txs.push(...rows.map((r) => ({ ...r, stallId })));
  db.txs.sort((a, b) => b.date.localeCompare(a.date));
}

/** Live: Claude proposals awaiting the PIN (GET /approvals). Mock: seeded notices. */
export async function getNotifications(): Promise<Notification[]> {
  if (LIVE) {
    if (!hasSession()) return [];
    const r = await call<{ approvals: SApproval[] }>(`${office(active)}/approvals`, {
      stall: active,
    });
    return mapApprovals(r.approvals).map((n) => ({ ...n, read: readIds.has(n.id) }));
  }
  return db.notifications.map((n) => ({ ...n }));
}
const readIds = new Set<string>();
export async function markRead(id: string) {
  readIds.add(id);
  const n = db.notifications.find((x) => x.id === id);
  if (n) n.read = true;
}

export const today = () => (LIVE ? new Date() : TODAY);
