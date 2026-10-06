// shared/types.ts: domain types shared by the server and the web app — catalog, cart, sale, events.
// The server is the source of truth; the web app only renders these shapes.
import type { Currency, Money } from "./money";

export interface CatalogItem {
  sku: string;
  name: string;
  /** Extra names the voice parser should match, e.g. "rajas" for "tamal de rajas". */
  aliases: string[];
  price: Money;
}

export interface Vendor {
  id: string;
  displayName: string;
  currency: Currency;
  catalog: CatalogItem[];
}

/** A physical point of sale: one sticker / QR / soundbox. At most one open order at a time. */
export interface Terminal {
  id: string;
  vendorId: string;
  label: string;
}

export interface CartLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: Money;
}

export type SaleStatus = "open" | "approved" | "paid" | "failed" | "expired" | "refunded";

export interface Sale {
  id: string;
  vendorId: string;
  terminalId: string;
  lines: CartLine[];
  total: Money;
  status: SaleStatus;
  /** PayPal order id (or mock order id). */
  orderId: string;
  captureId?: string;
  createdAt: string;
  paidAt?: string;
  expiresAt: string;
  method: "paypal" | "cash";
}

export type TerminalEvent =
  | { type: "sale.open"; sale: Sale }
  | { type: "sale.paid"; sale: Sale }
  | { type: "sale.failed"; sale: Sale; reason: string }
  | { type: "sale.expired"; sale: Sale }
  | { type: "sale.refunded"; sale: Sale; amount: Money };
