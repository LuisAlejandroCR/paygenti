// web/src/api.ts: typed fetch helpers for the paygent API used by the vendor app and checkout.
// The server is the source of truth; these only move JSON and surface error codes.
import type { PaymentData, Rail } from "../../shared/rails";
import type { CartLine, Sale } from "../../shared/types";

export interface RailsInfo {
  rails: Rail[];
  payment: PaymentData | null;
  label: string;
}

export interface AppConfig {
  paypal: "mock" | "sandbox";
  clientId: string | null;
  publicUrl: string;
  /** True when opening, cancelling or extending a sale needs this device's unlock token. */
  chargeAuth?: boolean;
}

/**
 * This device's charge token per terminal (POST /api/terminals/:id/unlock with the stall PIN). It
 * only opens, cancels and extends that stall's sales, so it may live in localStorage on the
 * vendor's own phone; the back-office session stays in sessionStorage.
 */
export const deviceToken = {
  key: (terminal: string) => `paygent.device.${terminal}`,
  get(terminal: string): string | null {
    try {
      return localStorage.getItem(this.key(terminal));
    } catch {
      return null;
    }
  },
  set(terminal: string, token: string | null) {
    try {
      if (token) localStorage.setItem(this.key(terminal), token);
      else localStorage.removeItem(this.key(terminal));
    } catch {
      /* private mode: the vendor unlocks again next time */
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP_${res.status}`);
  return data as T;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  unlock: (terminal: string, pin: string) =>
    request<{ token: string; expiresInMs: number }>(`/api/terminals/${terminal}/unlock`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  createSale: (terminal: string, amountMinor: number) =>
    request<{ sale: Sale }>(
      `/api/terminals/${terminal}/sales`,
      { method: "POST", body: JSON.stringify({ amount: amountMinor }) },
      deviceToken.get(terminal),
    ),
  sale: (id: string) => request<{ sale: Sale; stall: string }>(`/api/sales/${id}`),
  createSaleFromCart: (terminal: string, lines: CartLine[]) =>
    request<{ sale: Sale }>(
      `/api/terminals/${terminal}/sales`,
      {
        method: "POST",
        body: JSON.stringify({ lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) }),
      },
      deviceToken.get(terminal),
    ),
  parseVoice: (text: string, vendorId: string) =>
    request<{ lines: CartLine[]; unmatched: string[]; source: "llm" | "rules" }>(
      "/api/voice/parse",
      { method: "POST", body: JSON.stringify({ text, vendorId }) },
    ),
  cancelSale: (id: string, terminal: string) =>
    request<{ sale: Sale }>(
      `/api/sales/${id}/cancel`,
      { method: "POST" },
      deviceToken.get(terminal),
    ),
  extendSale: (id: string, terminal: string) =>
    request<{ sale: Sale }>(
      `/api/sales/${id}/extend`,
      { method: "POST" },
      deviceToken.get(terminal),
    ),
  capture: (id: string) => request<{ sale: Sale }>(`/api/sales/${id}/capture`, { method: "POST" }),
  rails: (id: string) => request<RailsInfo>(`/api/sales/${id}/rails`),
  selectRail: (id: string, rail: string) =>
    request<RailsInfo & { sale: Sale }>(`/api/sales/${id}/rail`, {
      method: "POST",
      body: JSON.stringify({ rail }),
    }),
  vendorConfirm: (id: string, pin: string) =>
    request<{ sale: Sale; label: string }>(`/api/sales/${id}/vendor-confirm`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  mockApprove: (orderId: string, decline: boolean) =>
    request<unknown>(`/api/mock/orders/${orderId}/approve`, {
      method: "POST",
      body: JSON.stringify({ decline }),
    }),
};
