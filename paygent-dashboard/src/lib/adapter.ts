// adapter.ts: pure mapping from Paygent server JSON (stalls, backoffice ledger, payouts, footprint,
// approvals) to the dashboard types. No fetch here, so it is unit-tested in adapter.test.ts.
// Invariants: PayPal-captured = verified, cash/vendor-confirmed = self-declared, pending_bank stays pending.
import type { Currency, Goal, Notification, Rail, Stall, Tx, TxStatus } from "./types";

export interface SMoney {
  minor: number;
  currency: string;
}
export interface SStall {
  id: string;
  displayName: string;
  currency: string;
  terminals?: string[];
}
export interface SLedgerRow {
  id: string;
  kind: "sale" | "refund";
  method: "paypal" | "cash" | "pix" | "spei" | "breb";
  status: string;
  createdAt: string;
  paidAt: string | null;
  total: SMoney;
  paid: SMoney;
  refunded: SMoney;
  items: string;
  lines?: Array<{ name: string; qty: number }>;
  reconciliation: string;
}
export interface SPayout {
  id: string;
  supplierName?: string;
  amount: SMoney;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface SLedger {
  day: string;
  rows: SLedgerRow[];
  payouts?: SPayout[];
}
export interface SStatementMonth {
  month: string;
  currency: string;
  inflow: number;
  count: number;
}
export interface SGoal {
  currency: string;
  target: number;
  saved: number;
}
export interface SApproval {
  id: string;
  kind: "refund" | "payout";
  status: string;
  amount: SMoney;
  createdAt: string;
}

/** Minor-unit exponent of a currency (MXN 2, JPY 0); falls back to 2. */
export function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
export const fromMinor = (m: SMoney) => m.minor / 10 ** fractionDigits(m.currency);
export const toMinor = (amount: number, currency: string) =>
  Math.round(amount * 10 ** fractionDigits(currency));

/** Rails a stall can show, derived from its currency (the server picks rails per sale). */
export function railsFor(currency: string): Rail[] {
  const base: Rail[] = ["paypal", "applepay", "googlepay", "cash"];
  if (currency === "MXN") return [...base, "spei", "oxxo"];
  if (currency === "BRL") return [...base, "pix"];
  if (currency === "COP") return [...base, "breb"];
  return base;
}

export function mapStall(s: SStall): Stall {
  return {
    id: s.id,
    name: s.displayName,
    currency: s.currency as Currency,
    rails: railsFor(s.currency),
    ...(s.terminals?.length ? { terminals: s.terminals } : {}),
  };
}

/** What the charge sheet may show for a server sale status. Only a PayPal capture ("paid") is
 *  "paid"; a push-rail transfer stays "pending_bank" and a vendor confirmation stays self-declared. */
export type ChargeState =
  "waiting" | "paid" | "pending_bank" | "self_declared" | "expired" | "cancelled" | "failed";
export function chargeState(status: string): ChargeState {
  switch (status) {
    case "paid":
      return "paid";
    case "pending_bank":
      return "pending_bank";
    case "vendor_confirmed":
      return "self_declared";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "refunded":
      return "failed";
    default:
      return "waiting"; // open, approved: the customer has not finished paying yet
  }
}

/** Outcome of a PIN check from the HTTP status the server answered (0 = network error). */
export type PinOutcome = "ok" | "wrong" | "locked" | "offline";
export function pinOutcome(status: number, code?: string): PinOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || code === "PIN_LOCKED") return "locked";
  if (status === 0 || status >= 500) return "offline";
  return "wrong";
}

/** Item label from the sale lines; never a payer name (the ledger carries none). */
function itemOf(r: SLedgerRow): string {
  const first = r.lines?.[0];
  if (first) return first.name;
  return (
    r.items
      .replace(/^\d+\s*×\s*/, "")
      .split(",")[0]
      ?.trim() || "Venta"
  );
}

/**
 * One ledger row → zero, one or two Txs: the sale itself, plus a refund line when money went back.
 * Open/approved/expired/failed sales never moved money, so they are dropped (failed → denied is kept
 * only when the row has a creation time, to show it in Movimientos).
 */
export function mapLedgerRow(r: SLedgerRow, stallId: string): Tx[] {
  const date = r.paidAt ?? r.createdAt;
  const currency = r.total.currency as Currency;
  const base = { date, currency, rail: r.method as Rail, item: itemOf(r), fee: 0, stallId };
  let status: TxStatus;
  let origin: Tx["origin"] = r.method === "paypal" ? "verificado" : "autodeclarado";
  switch (r.status) {
    case "paid":
      status = "COMPLETED";
      // A PayPal sale without a capture id is not verified money.
      if (r.method === "paypal" && r.reconciliation === "missing_capture") origin = "autodeclarado";
      break;
    case "refunded":
      status = "refunded";
      break;
    case "vendor_confirmed":
      status = "COMPLETED";
      origin = "autodeclarado";
      break;
    case "pending_bank":
      status = "pending_bank";
      origin = "autodeclarado";
      break;
    case "failed":
    case "expired":
      status = "denied";
      break;
    default:
      return []; // open / approved: no money yet
  }
  const out: Tx[] = [
    { ...base, id: r.id, amount: fromMinor(r.total), status, type: "venta", origin },
  ];
  if (r.refunded.minor > 0 && r.status !== "refunded") {
    // Partial refund: the sale stays paid, the refund is a separate outgoing line.
    out.push({
      ...base,
      id: `${r.id}-r`,
      amount: fromMinor(r.refunded),
      status: "COMPLETED",
      type: "reembolso",
      origin: "verificado",
    });
  }
  return out;
}

const PAYOUT_STATUS: Record<string, TxStatus> = {
  SUCCESS: "COMPLETED",
  PENDING: "pending_bank",
  PROCESSING: "pending_bank",
  UNCLAIMED: "pending_bank",
  ONHOLD: "pending_bank",
};
export function mapPayout(p: SPayout, day: string, stallId: string): Tx {
  return {
    id: p.id,
    date: p.createdAt ?? `${day}T12:00:00.000Z`,
    amount: fromMinor(p.amount),
    currency: p.amount.currency as Currency,
    rail: "paypal",
    status:
      PAYOUT_STATUS[p.status] ??
      (p.status === "RETURNED" || p.status === "REFUNDED" ? "refunded" : "denied"),
    type: "payout",
    origin: "verificado",
    item: p.supplierName ?? "Proveedor",
    fee: 0,
    stallId,
  };
}

export function mapLedger(l: SLedger, stallId: string): Tx[] {
  return [
    ...l.rows.flatMap((r) => mapLedgerRow(r, stallId)),
    ...(l.payouts ?? []).map((p) => mapPayout(p, l.day, stallId)),
  ];
}

/** Imported statement months are self-declared aggregates: one Tx per month, never verified. */
export function mapStatementMonths(months: SStatementMonth[], stallId: string): Tx[] {
  return months.map((m) => ({
    id: `stmt-${m.month}-${m.currency}`,
    date: `${m.month}-15T12:00:00.000Z`,
    amount: fromMinor({ minor: m.inflow, currency: m.currency }),
    currency: m.currency as Currency,
    rail: "bank",
    status: "COMPLETED",
    type: "venta",
    origin: "autodeclarado",
    item: "Estado de cuenta",
    fee: 0,
    stallId,
  }));
}

/** The server keeps one savings goal per stall, in minor units, with no name or deadline. */
export function mapGoal(g: SGoal | null): Goal[] {
  if (!g) return [];
  return [
    {
      id: "server",
      name: "Meta de ahorro",
      target: fromMinor({ minor: g.target, currency: g.currency }),
      saved: fromMinor({ minor: g.saved, currency: g.currency }),
      deadline: "",
      icon: "piggy",
    },
  ];
}
export function goalBody(g: Goal, currency: string) {
  return { targetMinor: toMinor(g.target, currency), savedMinor: toMinor(g.saved, currency) };
}

/** Claude proposals waiting for the PIN become notifications (the note is untrusted, so not shown). */
export function mapApprovals(a: SApproval[]): Notification[] {
  return a
    .filter((x) => x.status === "pending")
    .map((x) => ({
      id: x.id,
      text: `${x.kind === "refund" ? "Reembolso" : "Pago a proveedor"} propuesto: ${fromMinor(x.amount)} ${x.amount.currency} — requiere PIN`,
      read: false,
      at: x.createdAt,
    }));
}

/** Local calendar days (YYYY-MM-DD) from `from` to `to`, inclusive, newest first. */
export function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const stop = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  while (d.getTime() >= stop) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
    d.setDate(d.getDate() - 1);
  }
  return out;
}
