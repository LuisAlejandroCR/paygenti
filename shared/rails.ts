// shared/rails.ts: pluggable payment rails — a registry built from config (missing config hides a
// rail), which rails a sale may offer, the payment data for push rails (Pix BR Code, SPEI, Bre-B)
// and the plain labels for unverified states. Pure, so it is unit-tested. See docs/payment-rails.md.
import type { Money } from "./money";
import { toPayPalValue } from "./money";
import type { SaleStatus } from "./types";

/** "paypal": PayPal confirms server-side. "push": customer pushes money; no provider confirms it. */
export type RailConfirmation = "paypal" | "push";
export type PushRailId = "pix" | "spei" | "breb";
export type RailId = "applepay" | "googlepay" | "oxxo" | PushRailId;
export const PUSH_RAILS: readonly PushRailId[] = ["pix", "spei", "breb"];

export interface Rail {
  id: RailId;
  label: string;
  confirmation: RailConfirmation;
  /** Sale currencies the rail accepts; undefined = any. */
  currencies?: readonly string[];
  /** Max amount in minor units, if the rail caps it. */
  maxMinor?: number;
}

export interface PixConfig {
  key: string;
  name: string;
  city: string;
}
export interface SpeiConfig {
  clabe: string;
  beneficiary: string;
}
export interface BrebConfig {
  key: string;
}

export interface PaymentData {
  rail: PushRailId;
  /** What the QR encodes (BR Code for Pix; plain text for SPEI/Bre-B). */
  qr: string;
  /** Human-readable data to copy into a bank app. */
  text: string;
  label: string;
}

export const PENDING_BANK_LABEL = "pending — check your bank app";
export const VENDOR_CONFIRMED_LABEL = "vendor-confirmed, not verified";

export function isPushRail(id: string): id is PushRailId {
  return (PUSH_RAILS as readonly string[]).includes(id);
}

export class RailRegistry {
  constructor(
    private readonly rails: readonly Rail[],
    readonly pix?: PixConfig,
    readonly spei?: SpeiConfig,
    readonly breb?: BrebConfig,
  ) {}

  enabled(): readonly Rail[] {
    return this.rails;
  }

  get(id: string): Rail | undefined {
    return this.rails.find((r) => r.id === id);
  }

  /** Payment data for a push rail; undefined when that rail is not configured. */
  paymentData(id: PushRailId, amount: Money, reference: string): PaymentData | undefined {
    const value = toPayPalValue(amount);
    if (id === "pix" && this.pix) {
      const qr = pixBrCode(this.pix, amount, reference);
      return {
        rail: id,
        qr,
        text: `Pix ${value} BRL — ${this.pix.key}\n${qr}`,
        label: PENDING_BANK_LABEL,
      };
    }
    if (id === "spei" && this.spei) {
      const ref = speiReference(reference);
      const text = `SPEI\nCLABE: ${this.spei.clabe}\nBeneficiario: ${this.spei.beneficiary}\nMonto: ${value} MXN\nReferencia: ${ref}`;
      return { rail: id, qr: text, text, label: PENDING_BANK_LABEL };
    }
    if (id === "breb" && this.breb) {
      const text = `Bre-B\nLlave: ${this.breb.key}\nMonto: ${value} COP`;
      return { rail: id, qr: text, text, label: PENDING_BANK_LABEL };
    }
    return undefined;
  }
}

const on = (v: string | undefined) => v?.trim() === "1" || v?.trim().toLowerCase() === "true";

/** Builds the registry from env-like config. Absent or invalid config leaves the rail out. */
export function buildRailRegistry(env: Record<string, string | undefined>): RailRegistry {
  const rails: Rail[] = [];
  if (on(env.RAIL_APPLE_PAY))
    rails.push({ id: "applepay", label: "Apple Pay", confirmation: "paypal" });
  if (on(env.RAIL_GOOGLE_PAY))
    rails.push({ id: "googlepay", label: "Google Pay", confirmation: "paypal" });
  if (on(env.RAIL_OXXO))
    rails.push({
      id: "oxxo",
      label: "OXXO",
      confirmation: "paypal",
      currencies: ["MXN"],
      maxMinor: 1_000_000,
    });
  const pixKey = env.PIX_KEY?.trim();
  const pix = pixKey
    ? {
        key: pixKey.slice(0, 77),
        name: (env.PIX_MERCHANT_NAME?.trim() || "Vendedor").slice(0, 25),
        city: (env.PIX_MERCHANT_CITY?.trim() || "Brasil").slice(0, 15),
      }
    : undefined;
  if (pix) rails.push({ id: "pix", label: "Pix", confirmation: "push", currencies: ["BRL"] });
  const clabe = env.SPEI_CLABE?.replace(/\s/g, "");
  const spei =
    clabe && isValidClabe(clabe)
      ? { clabe, beneficiary: env.SPEI_BENEFICIARY?.trim() || "Vendedor" }
      : undefined;
  if (spei) rails.push({ id: "spei", label: "SPEI", confirmation: "push", currencies: ["MXN"] });
  const brebKey = env.BREB_KEY?.trim();
  const breb = brebKey ? { key: brebKey.slice(0, 64) } : undefined;
  if (breb) rails.push({ id: "breb", label: "Bre-B", confirmation: "push", currencies: ["COP"] });
  return new RailRegistry(rails, pix, spei, breb);
}

/** Rails a sale of `total` may offer, in registry order. */
export function railsForSale(reg: RailRegistry, total: Money): Rail[] {
  return reg
    .enabled()
    .filter(
      (r) =>
        (!r.currencies || r.currencies.includes(total.currency)) &&
        (r.maxMinor === undefined || total.minor <= r.maxMinor),
    );
}

/** Plain label for a sale status; unverified states say so. */
export function saleStatusLabel(status: SaleStatus): string {
  if (status === "pending_bank") return PENDING_BANK_LABEL;
  if (status === "vendor_confirmed") return VENDOR_CONFIRMED_LABEL;
  return status;
}

/** CLABE: 18 digits, last one a weighted (3,7,1) mod-10 check digit. */
export function isValidClabe(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(clabe[i]) * (w[i % 3] as number)) % 10;
  return (10 - (sum % 10)) % 10 === Number(clabe[17]);
}

/** SPEI numeric reference (max 7 digits) derived from the sale id. */
export function speiReference(saleId: string): string {
  let h = 0;
  for (const ch of saleId) h = (h * 31 + ch.charCodeAt(0)) % 10_000_000;
  return String(h).padStart(7, "0");
}

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), 4 uppercase hex digits, as the BR Code requires. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;
const ascii = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();

/** Static Pix BR Code (EMV MPM) with amount and txid; the payee is the vendor's Pix key. */
export function pixBrCode(cfg: PixConfig, amount: Money, reference: string): string {
  const txid = reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const payload =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", cfg.key)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", toPayPalValue(amount)) +
    tlv("58", "BR") +
    tlv("59", ascii(cfg.name).slice(0, 25) || "Vendedor") +
    tlv("60", ascii(cfg.city).slice(0, 15) || "Brasil") +
    tlv("62", tlv("05", txid)) +
    "6304";
  return payload + crc16(payload);
}
