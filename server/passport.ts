// server/passport.ts: the signed sales passport — builds the report from the vendor's settled
// sales (only PayPal captures count as verified; cash is a separate self-reported line) and signs
// its canonical JSON with Ed25519. The key comes from PASSPORT_SIGNING_KEY or is ephemeral (demo).
// The financial footprint (server/footprint.ts) rides inside the same signed report.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";
import {
  canonicalJson,
  PASSPORT_KIND,
  type PassportDay,
  type PassportReport,
  type SavingsGoal,
  type SignedPassport,
  type StatementMonth,
  toBase64Url,
} from "../shared/passport";
import { VENDOR_CONFIRMED_LABEL } from "../shared/rails";
import type { Sale } from "../shared/types";
import { computeFootprint } from "./footprint";

export const SELF_REPORTED_LABEL = "self-reported — not verified by PayPal";
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

export class PassportSigner {
  readonly keyId: string;
  /** Raw 32-byte Ed25519 public key. */
  readonly publicKeyRaw: Uint8Array;
  readonly publicKeyPem: string;

  constructor(
    private readonly privateKey: KeyObject,
    readonly demo: boolean,
  ) {
    if (privateKey.asymmetricKeyType !== "ed25519")
      throw new Error("passport: signing key must be Ed25519");
    const pub = createPublicKey(privateKey);
    const x = pub.export({ format: "jwk" }).x;
    if (!x) throw new Error("passport: cannot export public key");
    this.publicKeyRaw = new Uint8Array(Buffer.from(x, "base64url"));
    this.publicKeyPem = pub.export({ format: "pem", type: "spki" }).toString();
    this.keyId = createHash("sha256").update(this.publicKeyRaw).digest("hex").slice(0, 16);
  }

  /** PEM, or base64 of the PKCS8 DER. Without a value: an ephemeral demo key. */
  static fromEnv(value: string | undefined): PassportSigner {
    const v = value?.trim();
    if (!v) return PassportSigner.ephemeral();
    const key = v.includes("BEGIN")
      ? createPrivateKey(v.replace(/\\n/g, "\n"))
      : createPrivateKey({ key: Buffer.from(v, "base64"), format: "der", type: "pkcs8" });
    return new PassportSigner(key, false);
  }

  static ephemeral(): PassportSigner {
    return new PassportSigner(generateKeyPairSync("ed25519").privateKey, true);
  }

  sign(report: PassportReport): SignedPassport {
    const sig = sign(null, Buffer.from(canonicalJson(report)), this.privateKey);
    return { report, signature: toBase64Url(new Uint8Array(sig)), keyId: this.keyId };
  }
}

/** One settled sale as the passport sees it: no buyer data, no ids, just money and day. */
export interface PassportSale {
  day: string;
  method: Sale["method"];
  captured: boolean;
  /** Push-rail sale confirmed only by the vendor: self-reported, never verified. */
  vendorConfirmed?: boolean;
  total: number;
  refunded: number;
  /** Sale currency; defaults to the passport currency. */
  currency?: string;
}

export interface PassportInput {
  vendor: { id: string; name: string };
  currency: string;
  timeZone: string;
  from: string;
  to: string;
  issuedAt: string;
  demoKey: boolean;
  sales: PassportSale[];
  /** Cash the vendor dictates on top of cash sales recorded in the app. */
  cashDictated?: number;
  /** Imported statement aggregates (self-reported) and the vendor's savings goal. */
  statement?: StatementMonth[];
  goal?: SavingsGoal;
}

export function buildPassport(input: PassportInput): PassportReport {
  const days = new Map<string, PassportDay>();
  let cash = 0;
  let cashSalesCount = 0;
  let confirmed = 0;
  let confirmedCount = 0;
  for (const s of input.sales) {
    if (s.day < input.from || s.day > input.to) continue;
    if (s.method === "cash") {
      cash += s.total - s.refunded;
      cashSalesCount++;
      continue;
    }
    if (s.vendorConfirmed) {
      confirmed += s.total;
      confirmedCount++;
      continue;
    }
    if (!s.captured) continue;
    const d = days.get(s.day) ?? { day: s.day, count: 0, gross: 0, refunds: 0, net: 0 };
    d.count++;
    d.gross += s.total;
    d.refunds += Math.min(s.refunded, s.total);
    d.net = d.gross - d.refunds;
    days.set(s.day, d);
  }
  const daily = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const sum = (f: (d: PassportDay) => number) => daily.reduce((n, d) => n + f(d), 0);
  const count = sum((d) => d.count);
  const gross = sum((d) => d.gross);
  const refunds = sum((d) => d.refunds);
  return {
    kind: PASSPORT_KIND,
    version: 2,
    issuer: "paygent",
    issuedAt: input.issuedAt,
    demoKey: input.demoKey,
    vendor: input.vendor,
    currency: input.currency,
    period: { from: input.from, to: input.to, timeZone: input.timeZone },
    verified: {
      source: "PayPal captured payments",
      count,
      gross,
      refunds,
      net: gross - refunds,
      daysActive: daily.length,
      averageTicket: count ? Math.round(gross / count) : 0,
      daily,
    },
    selfReported: {
      label: SELF_REPORTED_LABEL,
      cash: cash + (input.cashDictated ?? 0),
      cashSalesCount,
      ...(confirmedCount > 0 && {
        vendorConfirmed: {
          label: VENDOR_CONFIRMED_LABEL,
          amount: confirmed,
          count: confirmedCount,
        },
      }),
    },
    footprint: computeFootprint({
      to: input.to,
      sales: input.sales.map((s) => ({ ...s, currency: s.currency ?? input.currency })),
      statement: input.statement ?? [],
      goal: input.goal,
    }),
  };
}

/** YYYY-MM-DD shifted by whole days (calendar arithmetic in UTC, no time zone involved). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
