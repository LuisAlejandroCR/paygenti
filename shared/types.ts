// shared/types.ts: domain types shared by the server and the web app — catalog, cart, sale, events.
// The server is the source of truth; the web app only renders these shapes.
import type { Currency, Money } from "./money";

/** Display name per UI locale; `name` stays the English canonical name sent to PayPal. */
export interface LocalizedName {
  en: string;
  es: string;
}

export interface CatalogItem {
  sku: string;
  /** English canonical name (PayPal line items, logs). */
  name: string;
  names?: LocalizedName;
  /** Extra names the voice parser should match, e.g. "rajas" for "tamal de rajas". */
  aliases: string[];
  price: Money;
}

export interface Vendor {
  id: string;
  displayName: string;
  currency: Currency;
  catalog: CatalogItem[];
  /** ISO 3166 alpha-2, chosen in onboarding. */
  country?: string;
  /** IANA zone for "today" (ledger, daily caps). */
  timeZone?: string;
  /** False until the vendor completes onboarding (first-run screen). */
  onboarded?: boolean;
  /** Set when the currency changed: catalog prices were kept at face value and need a re-check. */
  pricesNeedReview?: boolean;
}

/** A physical point of sale: one sticker / QR / soundbox. At most one open order at a time. */
export interface Terminal {
  id: string;
  vendorId: string;
  label: string;
}

export interface CartLine {
  sku: string;
  /** English canonical name (PayPal line items). */
  name: string;
  names?: LocalizedName;
  qty: number;
  unitPrice: Money;
}

export type SaleStatus =
  | "open"
  | "approved"
  | "paid"
  | "failed"
  | "expired"
  | "refunded"
  | "cancelled";

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
  | { type: "sale.cancelled"; sale: Sale }
  | { type: "sale.refunded"; sale: Sale; amount: Money };
