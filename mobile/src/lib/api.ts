// src/lib/api.ts: typed client for the existing paygent REST API (sales, voice, config, back office)
// against a configurable server URL. It only moves JSON and surfaces error codes; every rule
// (PIN, caps, refunds) stays on the server.
import type { Money } from "@shared/money";
import type { CartLine, CatalogItem, Sale, Vendor } from "@shared/types";

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

export function createApi(baseUrl: string, token?: string) {
  async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
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
    createSale: (terminal: string, amountMinor: number) =>
      request<{ sale: Sale }>(`/api/terminals/${terminal}/sales`, {
        method: "POST",
        body: { amount: amountMinor },
      }),
    createSaleFromCart: (terminal: string, lines: CartLine[]) =>
      request<{ sale: Sale }>(`/api/terminals/${terminal}/sales`, {
        method: "POST",
        body: { lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) },
      }),
    sale: (id: string) => request<{ sale: Sale; stall: string }>(`/api/sales/${id}`),
    cancelSale: (id: string) =>
      request<{ sale: Sale }>(`/api/sales/${id}/cancel`, { method: "POST" }),
    parseVoice: (text: string, vendorId: string) =>
      request<{ lines: CartLine[]; unmatched: string[]; source: "llm" | "rules" }>(
        "/api/voice/parse",
        { method: "POST", body: { text, vendorId } },
      ),
    login: (pin: string) =>
      request<{ token: string; expiresInMs: number }>("/api/backoffice/session", {
        method: "POST",
        body: { pin },
      }),
    saveVendor: (body: { displayName: string; country: string; currency: string }) =>
      request<{ vendor: Vendor }>("/api/backoffice/vendor", { method: "PUT", body }),
    salesToday: () => request<SalesToday>("/api/backoffice/sales-today"),
    ledger: () => request<Ledger>("/api/backoffice/ledger"),
    refund: (saleId: string, amountMinor: number, pin: string) =>
      request<{ ok: true; refundId: string; amount: Money }>("/api/backoffice/refunds", {
        method: "POST",
        body: { saleId, amountMinor, pin },
      }),
  };
}

export type Api = ReturnType<typeof createApi>;
