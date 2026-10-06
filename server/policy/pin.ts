// server/policy/pin.ts: vendor PIN check — salted hash, constant-time compare, lockout.
// The PIN itself is never kept: only a salted SHA-256 digest. Failures are counted per client key
// (IP, session): 5 wrong attempts lock that client, and each further lockout doubles (5, 10, 20 min,
// capped at 1 h). A global backstop locks everyone after many failures across all clients, so
// rotating keys does not buy unlimited guesses. A locked client is refused even with the right PIN.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface PinGuardOptions {
  pin: string;
  now?: () => number;
  /** Wrong attempts per client before that client is locked. */
  maxAttempts?: number;
  /** First lockout; each later lockout of the same client doubles, up to maxLockoutMs. */
  lockoutMs?: number;
  maxLockoutMs?: number;
  /** Wrong attempts from all clients within globalWindowMs that lock everyone. */
  globalMaxAttempts?: number;
  globalWindowMs?: number;
}

export type PinResult =
  | { ok: true; code: "PIN_OK" }
  | { ok: false; code: "PIN_WRONG"; attemptsLeft: number }
  | { ok: false; code: "PIN_LOCKED"; retryAfterMs: number };

export const PIN_PATTERN = /^\d{4,8}$/;
const ANON = "anonymous";
const MAX_TRACKED = 10_000;

interface ClientState {
  failures: number;
  lockedUntil: number;
  lockouts: number;
  lastSeen: number;
}

export class PinGuard {
  readonly #salt = randomBytes(16);
  readonly #digest: Buffer;
  readonly #now: () => number;
  readonly #maxAttempts: number;
  readonly #lockoutMs: number;
  readonly #maxLockoutMs: number;
  readonly #globalMax: number;
  readonly #globalWindow: number;
  readonly #clients = new Map<string, ClientState>();
  #globalFailures: number[] = [];
  #globalLockedUntil = 0;

  constructor(opts: PinGuardOptions) {
    if (typeof opts.pin !== "string" || !PIN_PATTERN.test(opts.pin))
      throw new Error("pin: the vendor PIN must be 4 to 8 digits");
    this.#digest = this.#hash(opts.pin);
    this.#now = opts.now ?? Date.now;
    this.#maxAttempts = opts.maxAttempts ?? 5;
    this.#lockoutMs = opts.lockoutMs ?? 5 * 60_000;
    this.#maxLockoutMs = opts.maxLockoutMs ?? 60 * 60_000;
    this.#globalMax = opts.globalMaxAttempts ?? 50;
    this.#globalWindow = opts.globalWindowMs ?? 15 * 60_000;
  }

  /**
   * `clients` names who is asking (e.g. ["ip:1.2.3.4", "session:ab12"]). Every key is charged on
   * a failure; any locked key (or the global backstop) refuses the attempt.
   */
  verify(candidate: unknown, clients: string | readonly string[] = ANON): PinResult {
    const now = this.#now();
    const keys = [...new Set(typeof clients === "string" ? [clients] : clients)];
    if (keys.length === 0) keys.push(ANON);

    if (now < this.#globalLockedUntil)
      return { ok: false, code: "PIN_LOCKED", retryAfterMs: this.#globalLockedUntil - now };
    const states = keys.map((k) => this.#state(k, now));
    const lockedUntil = Math.max(...states.map((s) => s.lockedUntil));
    if (now < lockedUntil)
      return { ok: false, code: "PIN_LOCKED", retryAfterMs: lockedUntil - now };
    for (const s of states) {
      if (s.lockedUntil !== 0) {
        s.lockedUntil = 0;
        s.failures = 0;
      }
    }

    const given = this.#hash(typeof candidate === "string" ? candidate : "");
    if (timingSafeEqual(given, this.#digest)) {
      for (const s of states) {
        s.failures = 0;
        s.lockouts = 0;
      }
      return { ok: true, code: "PIN_OK" };
    }

    this.#globalFailures = this.#globalFailures.filter((t) => t > now - this.#globalWindow);
    this.#globalFailures.push(now);
    if (this.#globalFailures.length >= this.#globalMax) {
      this.#globalLockedUntil = now + this.#lockoutMs;
      this.#globalFailures = [];
    }

    let retryAfterMs = 0;
    let attemptsLeft = this.#maxAttempts;
    for (const s of states) {
      s.failures += 1;
      if (s.failures >= this.#maxAttempts) {
        const ms = Math.min(this.#lockoutMs * 2 ** s.lockouts, this.#maxLockoutMs);
        s.lockouts += 1;
        s.lockedUntil = now + ms;
        retryAfterMs = Math.max(retryAfterMs, ms);
      }
      attemptsLeft = Math.min(attemptsLeft, this.#maxAttempts - s.failures);
    }
    if (retryAfterMs > 0) return { ok: false, code: "PIN_LOCKED", retryAfterMs };
    if (now < this.#globalLockedUntil)
      return { ok: false, code: "PIN_LOCKED", retryAfterMs: this.#globalLockedUntil - now };
    return { ok: false, code: "PIN_WRONG", attemptsLeft };
  }

  /** True when this client (or everyone, via the global backstop) is locked right now. */
  isLocked(clients: string | readonly string[] = ANON): boolean {
    const now = this.#now();
    if (now < this.#globalLockedUntil) return true;
    const keys = typeof clients === "string" ? [clients] : clients;
    return keys.some((k) => now < (this.#clients.get(k)?.lockedUntil ?? 0));
  }

  #state(key: string, now: number): ClientState {
    let s = this.#clients.get(key);
    if (!s) {
      if (this.#clients.size >= MAX_TRACKED) this.#prune(now);
      s = { failures: 0, lockedUntil: 0, lockouts: 0, lastSeen: now };
      this.#clients.set(key, s);
    }
    s.lastSeen = now;
    return s;
  }

  /** Drops clients that are not locked and were idle longer than the longest lockout. */
  #prune(now: number): void {
    for (const [k, s] of this.#clients)
      if (s.lockedUntil <= now && now - s.lastSeen > this.#maxLockoutMs) this.#clients.delete(k);
  }

  #hash(pin: string): Buffer {
    return createHash("sha256").update(this.#salt).update(pin, "utf8").digest();
  }
}
