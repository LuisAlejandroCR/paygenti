// src/lib/api.ts: typed client for the existing paygent REST API (sales, voice, config, back office)
// against a configurable server URL. It only moves JSON and surfaces error codes; every rule
// (PIN, caps, refunds) stays on the server.
import type { Money } from "@shared/money";
import type { CartLine, CatalogItem, Sale, StallSummary, Vendor } from "@shared/types";
import { boPath, DEFAULT_STALL, sessionsHeader } from "./stalls";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason?: string,
  ) {
    super(code);
  }
}

export interface AppConfig {
  paypal: "mock" | "sandbox";
  clientId: string | null;
  publicUrl: string;
}

export interface TerminalInfo {
  terminal: { id: string; vendorId: string; label: string };
  vendor: Vendor & { catalog: CatalogItem[] };
  openSale: Sale | null;
  payUrl: string;
}

export interface SalesToday {
  day: string;
  count: number;
  total: Money;
  refunded: Money;
  /** Sales today in a currency the stall no longer charges in: shown apart, never summed. */
  others?: { currency: string; count: number; net: Money }[];
  sales: {
    id: string;
    paidAt: string;
    total: Money;
    status: Sale["status"];
    refunded: Money;
    items: string;
  }[];
}

export interface LedgerRow {
  id: string;
  kind: "sale" | "refund";
  method: Sale["method"];
  status: Sale["status"];
  terminalId: string;
  createdAt: string;
  paidAt: string | null;
  total: Money;
  paid: Money;
  refunded: Money;
}

export interface Ledger {
  day: string;
  rows: LedgerRow[];
  totals: { paid: Money; refunded: Money; net: Money; cash: Money; count: number };
}

/** A refund or payout Claude proposed; approved only with the stall PIN. */
export interface Approval {
  id: string;
  kind: "refund" | "payout";
  status: string;
  amount: Money;
  note: string;
  preview: { allow: boolean; code: string };
}

export interface OwnerOverview {
  stalls: { id: string; displayName: string; net: Money; count: number; pendingApprovals: number }[];
  /** One entry per currency: amounts are never converted or summed across currencies. */
  totals: { currency: string; net: Money; count: number; stalls: number }[];
}

/**
 * `device` is this phone's charge token for the terminal (POST /api/terminals/:id/unlock): opening
 * and cancelling sales send it, falling back to the back-office session.
 */
export function createApi(baseUrl: string, token?: string, stall: string = DEFAULT_STALL, device?: string) {
  const chargeAuth = device ?? token;
  const charging = chargeAuth ? { Authorization: `Bearer ${chargeAuth}` } : undefined;
  const bo = (path: string) => boPath(stall, path);
  async function request<T>(
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...init?.headers };
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP_${res.status}`, data.reason);
    return data as T;
  }

  return {
    config: () => request<AppConfig>("/api/config"),
    terminal: (id: string) => request<TerminalInfo>(`/api/terminals/${encodeURIComponent(id)}`),
    unlock: (terminal: string, pin: string) =>
      request<{ token: string; expiresInMs: number }>(`/api/terminals/${encodeURIComponent(terminal)}/unlock`, {
        method: "POST",
        body: { pin },
      }),
    createSale: (terminal: string, amountMinor: number) =>
      request<{ sale: Sale }>(`/api/terminals/${terminal}/sales`, {
        method: "POST",
        body: { amount: amountMinor },
        headers: charging,
      }),
    createSaleFromCart: (terminal: string, lines: CartLine[]) =>
      request<{ sale: Sale }>(`/api/terminals/${terminal}/sales`, {
        method: "POST",
        body: { lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) },
        headers: charging,
      }),
    sale: (id: string) => request<{ sale: Sale; stall: string }>(`/api/sales/${id}`),
    cancelSale: (id: string) =>
      request<{ sale: Sale }>(`/api/sales/${id}/cancel`, { method: "POST", headers: charging }),
    parseVoice: (text: string, vendorId: string) =>
      request<{ lines: CartLine[]; unmatched: string[]; source: "llm" | "rules" }>(
        "/api/voice/parse",
        { method: "POST", body: { text, vendorId } },
      ),
    login: (pin: string) =>
      request<{ token: string; expiresInMs: number }>(bo("/session"), {
        method: "POST",
        body: { pin },
      }),
    saveVendor: (body: { displayName: string; country: string; currency: string }) =>
      request<{ vendor: Vendor }>(bo("/vendor"), { method: "PUT", body }),
    salesToday: () => request<SalesToday>(bo("/sales-today")),
    /** One day's ledger (YYYY-MM-DD, stall time zone); today when omitted. */
    ledger: (date?: string) =>
      request<Ledger>(bo(date ? `/ledger?date=${encodeURIComponent(date)}` : "/ledger")),
    /** Day ledgers from..to (≤ 32 days), clamped to the stall's today, which it also returns. */
    ledgerRange: (from: string, to: string) =>
      request<{ today: string; days: Ledger[] }>(
        bo(`/ledger-range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      ),
    /** Vendor checked her bank app: PIN-gated; the sale becomes vendor_confirmed, never paid. */
    vendorConfirm: (saleId: string, pin: string) =>
      request<{ sale: Sale }>(`/api/sales/${encodeURIComponent(saleId)}/vendor-confirm`, {
        method: "POST",
        body: { pin },
      }),
    refund: (saleId: string, amountMinor: number, pin: string) =>
      request<{ ok: true; refundId: string; amount: Money }>(bo("/refunds"), {
        method: "POST",
        body: { saleId, amountMinor, pin },
      }),
    stalls: () => request<{ stalls: StallSummary[] }>("/api/stalls"),
    approvals: () => request<{ approvals: Approval[] }>(bo("/approvals")),
    approve: (id: string, pin: string) =>
      request<{ ok: true }>(bo(`/approvals/${encodeURIComponent(id)}/approve`), {
        method: "POST",
        body: { pin },
      }),
    reject: (id: string) =>
      request<{ ok: true }>(bo(`/approvals/${encodeURIComponent(id)}/reject`), {
        method: "POST",
        body: {},
      }),
    overview: (tokens: Record<string, string | undefined>) =>
      request<OwnerOverview>("/api/owner/overview", {
        headers: { "X-Paygent-Sessions": sessionsHeader(tokens) },
      }),
  };
}

export type Api = ReturnType<typeof createApi>;
