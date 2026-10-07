// shared/passport.ts: the signed sales passport format shared by server and browser — report
// shape, canonical JSON (sorted keys) that gets signed, base64url helpers, the verify-link payload
// and Ed25519 verification with WebCrypto (works in Node 22+ and current browsers).

export const PASSPORT_KIND = "paygent.sales-passport";

/** Amounts are integer minor units (centavos) in `currency`. */
export interface PassportDay {
  day: string;
  count: number;
  gross: number;
  refunds: number;
  net: number;
}

export interface PassportReport {
  kind: typeof PASSPORT_KIND;
  version: 1;
  issuer: string;
  issuedAt: string;
  /** True when signed with an ephemeral key generated at startup (no PASSPORT_SIGNING_KEY). */
  demoKey: boolean;
  vendor: { id: string; name: string };
  currency: string;
  period: { from: string; to: string; timeZone: string };
  /** Only PayPal-captured sales; refunds subtracted. */
  verified: {
    source: string;
    count: number;
    gross: number;
    refunds: number;
    net: number;
    daysActive: number;
    averageTicket: number;
    /** Days with at least one verified sale, oldest first. */
    daily: PassportDay[];
  };
  /** What the vendor says she sold in cash: shown, never counted as verified. */
  selfReported: {
    label: string;
    cash: number;
    cashSalesCount: number;
    /** Push-rail sales (Pix, SPEI, Bre-B) only the vendor confirmed: not verified by any provider. */
    vendorConfirmed?: { label: string; amount: number; count: number };
  };
}

export interface SignedPassport {
  report: PassportReport;
  /** base64url Ed25519 signature over canonicalJson(report). */
  signature: string;
  keyId: string;
}

/** Deterministic JSON: object keys sorted, no whitespace; rejects values JSON cannot round-trip. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new TypeError("not base64url");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The verify-link fragment: base64url(UTF-8 JSON of the signed passport). */
export function encodePayload(p: SignedPassport): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(p)));
}

export function decodePayload(text: string): SignedPassport | undefined {
  try {
    const p = JSON.parse(new TextDecoder().decode(fromBase64Url(text.trim()))) as SignedPassport;
    if (!p || typeof p !== "object" || typeof p.signature !== "string") return undefined;
    if (typeof p.keyId !== "string" || p.report?.kind !== PASSPORT_KIND) return undefined;
    return p;
  } catch {
    return undefined;
  }
}

/** Ed25519 check of `signature` over canonicalJson(report) against a raw 32-byte public key. */
export async function verifyPassport(
  p: Pick<SignedPassport, "report" | "signature">,
  publicKeyRaw: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyRaw as Uint8Array<ArrayBuffer>,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  let sig: Uint8Array;
  try {
    sig = fromBase64Url(p.signature);
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(canonicalJson(p.report));
  return crypto.subtle.verify("Ed25519", key, sig as Uint8Array<ArrayBuffer>, data);
}
