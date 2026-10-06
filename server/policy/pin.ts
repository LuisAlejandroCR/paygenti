// server/policy/pin.ts: vendor PIN check — salted hash, constant-time compare, lockout.
// The PIN itself is never kept: only a salted SHA-256 digest. After 5 wrong attempts the guard
// refuses every attempt (right or wrong) for 5 minutes. The clock is injectable for tests.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface PinGuardOptions {
  pin: string;
  now?: () => number;
  maxAttempts?: number;
  lockoutMs?: number;
}

export type PinResult =
  | { ok: true; code: "PIN_OK" }
  | { ok: false; code: "PIN_WRONG"; attemptsLeft: number }
  | { ok: false; code: "PIN_LOCKED"; retryAfterMs: number };

export const PIN_PATTERN = /^\d{4,8}$/;

export class PinGuard {
  readonly #salt = randomBytes(16);
  readonly #digest: Buffer;
  readonly #now: () => number;
  readonly #maxAttempts: number;
  readonly #lockoutMs: number;
  #failures = 0;
  #lockedUntil = 0;

  constructor(opts: PinGuardOptions) {
    if (typeof opts.pin !== "string" || !PIN_PATTERN.test(opts.pin))
      throw new Error("pin: the vendor PIN must be 4 to 8 digits");
    this.#digest = this.#hash(opts.pin);
    this.#now = opts.now ?? Date.now;
    this.#maxAttempts = opts.maxAttempts ?? 5;
    this.#lockoutMs = opts.lockoutMs ?? 5 * 60_000;
  }

  verify(candidate: unknown): PinResult {
    const now = this.#now();
    if (now < this.#lockedUntil)
      return { ok: false, code: "PIN_LOCKED", retryAfterMs: this.#lockedUntil - now };
    if (this.#lockedUntil !== 0) {
      this.#lockedUntil = 0;
      this.#failures = 0;
    }

    const given = this.#hash(typeof candidate === "string" ? candidate : "");
    if (timingSafeEqual(given, this.#digest)) {
      this.#failures = 0;
      return { ok: true, code: "PIN_OK" };
    }

    this.#failures += 1;
    if (this.#failures >= this.#maxAttempts) {
      this.#lockedUntil = now + this.#lockoutMs;
      return { ok: false, code: "PIN_LOCKED", retryAfterMs: this.#lockoutMs };
    }
    return { ok: false, code: "PIN_WRONG", attemptsLeft: this.#maxAttempts - this.#failures };
  }

  isLocked(): boolean {
    return this.#now() < this.#lockedUntil;
  }

  #hash(pin: string): Buffer {
    return createHash("sha256").update(this.#salt).update(pin, "utf8").digest();
  }
}
