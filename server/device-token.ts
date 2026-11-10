// server/device-token.ts: charge tokens for the vendor's own devices (vendor screen, /judge, phone).
// Creating, cancelling and extending a sale need one: without it anyone on the internet could open a
// charge on a stall's sticker or cancel the sale a customer is about to pay. The vendor unlocks the
// terminal once with the stall PIN and gets a token that can only charge for that stall — no ledger,
// refunds or payouts. Stateless (HMAC-SHA256 over stall and expiry), so it survives a restart when
// DEVICE_TOKEN_SECRET is set; without it every start uses a random secret and devices unlock again.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A market week: the counter phone stays unlocked without asking the PIN every day. */
export const DEVICE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "pgd";
const TOKEN = /^pgd\.([a-z0-9-]{1,40})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

export class DeviceTokens {
  readonly #secret: Buffer;
  readonly #now: () => number;
  readonly ttlMs: number;
  /** True when the secret was generated at boot (tokens die on restart). */
  readonly ephemeral: boolean;

  constructor(opts: { secret?: string; now?: () => number; ttlMs?: number } = {}) {
    const secret = opts.secret?.trim();
    if (secret !== undefined && secret !== "" && secret.length < 32)
      throw new Error("device tokens: DEVICE_TOKEN_SECRET must be at least 32 characters");
    this.ephemeral = !secret;
    this.#secret = secret ? Buffer.from(secret, "utf8") : randomBytes(32);
    this.#now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? DEVICE_TOKEN_TTL_MS;
  }

  issue(stallId: string): { token: string; expiresInMs: number } {
    const exp = this.#now() + this.ttlMs;
    return {
      token: `${PREFIX}.${stallId}.${exp}.${this.#sign(stallId, exp)}`,
      expiresInMs: this.ttlMs,
    };
  }

  /** True only for an unexpired token signed for exactly this stall. */
  verify(token: string, stallId: string): boolean {
    const m = TOKEN.exec(token);
    if (!m || m[1] !== stallId) return false;
    const exp = Number(m[2]);
    if (!(exp > this.#now())) return false;
    const given = Buffer.from(m[3] ?? "", "base64url");
    const want = Buffer.from(this.#sign(stallId, exp), "base64url");
    return given.length === want.length && timingSafeEqual(given, want);
  }

  #sign(stallId: string, exp: number): string {
    return createHmac("sha256", this.#secret)
      .update(`device:${stallId}:${exp}`)
      .digest("base64url");
  }
}
