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
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP_${res.status}`);
  return data as T;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  createSale: (terminal: string, amountMinor: number) =>
    request<{ sale: Sale }>(`/api/terminals/${terminal}/sales`, {
      method: "POST",
      body: JSON.stringify({ amount: amountMinor }),
    }),
  sale: (id: string) => request<{ sale: Sale; stall: string }>(`/api/sales/${id}`),
  createSaleFromCart: (terminal: string, lines: CartLine[]) =>
    request<{ sale: Sale }>(`/api/terminals/${terminal}/sales`, {
      method: "POST",
      body: JSON.stringify({ lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) }),
    }),
  parseVoice: (text: string, vendorId: string) =>
    request<{ lines: CartLine[]; unmatched: string[]; source: "llm" | "rules" }>(
      "/api/voice/parse",
      { method: "POST", body: JSON.stringify({ text, vendorId }) },
    ),
  cancelSale: (id: string) =>
    request<{ sale: Sale }>(`/api/sales/${id}/cancel`, { method: "POST" }),
  extendSale: (id: string) =>
    request<{ sale: Sale }>(`/api/sales/${id}/extend`, { method: "POST" }),
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
