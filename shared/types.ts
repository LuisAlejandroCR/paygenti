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
  /** Push rail chosen (Pix, SPEI, Bre-B): "pending — check your bank app"; never paid by itself. */
  | "pending_bank"
  /** Vendor confirmed a push-rail payment with her PIN: "vendor-confirmed, not verified". */
  | "vendor_confirmed"
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
  /** When the sale settled: PayPal capture, or the vendor's confirmation for vendor_confirmed. */
  paidAt?: string;
  expiresAt: string;
  /** "paypal" covers every PayPal-confirmed rail (Apple Pay, Google Pay, OXXO, Venmo, card). */
  method: "paypal" | "cash" | "pix" | "spei" | "breb";
}

export type TerminalEvent =
  | { type: "sale.open"; sale: Sale }
  | { type: "sale.paid"; sale: Sale }
  | { type: "sale.failed"; sale: Sale; reason: string }
  | { type: "sale.expired"; sale: Sale }
  | { type: "sale.cancelled"; sale: Sale }
  | { type: "sale.pending_bank"; sale: Sale }
  | { type: "sale.vendor_confirmed"; sale: Sale }
  | { type: "sale.refunded"; sale: Sale; amount: Money };

/** How PayPal finds a supplier: Payouts v1 `recipient_type` (PAYPAL_ID is not offered in the UI). */
export type RecipientType = "EMAIL" | "PHONE";

/** A supplier on the vendor's payout allowlist (e.g. the masa supplier). */
export interface Supplier {
  id: string;
  name: string;
  recipientType: RecipientType;
  /** Normalized: email lowercased, phone as digits only. */
  receiver: string;
  currency: Currency;
  createdAt: string;
}

/**
 * Payout status: PayPal's batch_status (PENDING, PROCESSING, SUCCESS, DENIED, CANCELED) or, once
 * known, the item's transaction_status; UNKNOWN when PayPal's answer was lost (timeout).
 */
export type PayoutStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "DENIED"
  | "CANCELED"
  | "FAILED"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED"
  | "UNKNOWN";

export interface Payout {
  /** Our id; also PayPal's sender_batch_id and PayPal-Request-Id. */
  id: string;
  supplierId: string;
  supplierName: string;
  recipientType: RecipientType;
  receiver: string;
  amount: Money;
  note?: string;
  /** PayPal payout_batch_id; undefined until PayPal answers. */
  batchId?: string;
  /** PayPal payout_item_id. */
  itemId?: string;
  status: PayoutStatus;
  /** PayPal error name when an item failed. */
  error?: string;
  createdAt: string;
  updatedAt: string;
}
