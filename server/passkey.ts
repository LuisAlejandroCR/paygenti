// server/passkey.ts: Face ID / fingerprint unlock for a terminal with WebAuthn platform passkeys.
// Enrolling needs the device token the stall PIN gives (the PIN stays the root of trust); a verified
// assertion then earns the same device token. Challenges are single-use and live 5 minutes in memory;
// failures are rate-limited per client like the PIN (5 tries, then 5 min doubling to 1 h).
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { PasskeyCredential, Terminal } from "../shared/types";
import type { Store } from "./store";

export const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 1000;
const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;

/** Who the passkey is bound to: the deployed host (PUBLIC_URL) or localhost in dev. */
export interface RelyingParty {
  rpID: string;
  origins: string[];
}

/** `base` is the app's public origin; on localhost any local port counts (Vite dev proxy). */
export function relyingParty(base: string, requestOrigin?: string): RelyingParty {
  const url = new URL(base);
  const origins = [url.origin];
  if (url.hostname === "localhost" && requestOrigin && LOCALHOST_ORIGIN.test(requestOrigin))
    origins.push(requestOrigin);
  return { rpID: url.hostname, origins };
}

type Kind = "register" | "unlock";
type Limit = { failures: number; lockedUntil: number; lockouts: number };

export type PasskeyResult =
  | { ok: true }
  | { ok: false; code: "PASSKEY_FAILED" }
  | { ok: false; code: "PASSKEY_LOCKED"; retryAfterMs: number };

export class Passkeys {
  readonly #store: Store;
  readonly #now: () => number;
  readonly #challenges = new Map<string, { kind: Kind; terminal: string; exp: number }>();
  readonly #limits = new Map<string, Limit>();
  readonly #maxAttempts = 5;
  readonly #lockoutMs = 5 * 60_000;
  readonly #maxLockoutMs = 60 * 60_000;

  constructor(opts: { store: Store; now?: () => number }) {
    this.#store = opts.store;
    this.#now = opts.now ?? Date.now;
  }

  async registrationOptions(
    terminal: Terminal,
    rp: RelyingParty,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const options = await generateRegistrationOptions({
      rpName: "Paygent",
      rpID: rp.rpID,
      userName: terminal.id,
      userDisplayName: terminal.label,
      userID: new TextEncoder().encode(`paygent:${terminal.id}`),
      attestationType: "none",
      excludeCredentials: this.#store
        .passkeys(terminal.id)
        .map((p) => ({ id: p.id, transports: transports(p) })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
    });
    this.#remember(options.challenge, "register", terminal.id);
    return options;
  }

  /** Verifies and saves a new passkey for the terminal; false on any mismatch. */
  async register(
    terminal: Terminal,
    response: RegistrationResponseJSON,
    rp: RelyingParty,
  ): Promise<boolean> {
    try {
      const v = await verifyRegistrationResponse({
        response,
        expectedChallenge: (c) => this.#take(c, "register", terminal.id),
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
      if (!v.verified) return false;
      const { credential } = v.registrationInfo;
      if (this.#store.getPasskey(credential.id)) return false;
      this.#store.savePasskey({
        id: credential.id,
        terminalId: terminal.id,
        vendorId: terminal.vendorId,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        ...(credential.transports && { transports: credential.transports }),
        createdAt: new Date(this.#now()).toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async authenticationOptions(
    terminal: Terminal,
    rp: RelyingParty,
  ): Promise<PublicKeyCredentialRequestOptionsJSON | undefined> {
    const creds = this.#store.passkeys(terminal.id);
    if (creds.length === 0) return undefined;
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: "required",
      allowCredentials: creds.map((p) => ({ id: p.id, transports: transports(p) })),
    });
    this.#remember(options.challenge, "unlock", terminal.id);
    return options;
  }

  /** Verifies an assertion for this terminal; failures count against every client key. */
  async verify(
    terminal: Terminal,
    response: AuthenticationResponseJSON,
    rp: RelyingParty,
    clients: readonly string[],
  ): Promise<PasskeyResult> {
    const locked = this.retryAfterMs(clients);
    if (locked > 0) return { ok: false, code: "PASSKEY_LOCKED", retryAfterMs: locked };
    const ok = await this.#check(terminal, response, rp);
    if (ok) {
      for (const k of clients) this.#limits.delete(k);
      return { ok: true };
    }
    const retryAfterMs = this.#fail(clients);
    return retryAfterMs > 0
      ? { ok: false, code: "PASSKEY_LOCKED", retryAfterMs }
      : { ok: false, code: "PASSKEY_FAILED" };
  }

  /** Milliseconds until any of these clients may try a passkey again (0 = now). */
  retryAfterMs(clients: readonly string[]): number {
    const now = this.#now();
    return Math.max(0, ...clients.map((k) => (this.#limits.get(k)?.lockedUntil ?? 0) - now));
  }

  async #check(
    terminal: Terminal,
    response: AuthenticationResponseJSON,
    rp: RelyingParty,
  ): Promise<boolean> {
    const cred = typeof response?.id === "string" ? this.#store.getPasskey(response.id) : undefined;
    if (!cred || cred.terminalId !== terminal.id || cred.vendorId !== terminal.vendorId)
      return false;
    try {
      const v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (c) => this.#take(c, "unlock", terminal.id),
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: cred.id,
          publicKey: Buffer.from(cred.publicKey, "base64url"),
          counter: cred.counter,
          transports: transports(cred),
        },
      });
      if (!v.verified) return false;
      this.#store.savePasskey({ ...cred, counter: v.authenticationInfo.newCounter });
      return true;
    } catch {
      return false;
    }
  }

  #fail(clients: readonly string[]): number {
    const now = this.#now();
    let retryAfterMs = 0;
    for (const k of clients) {
      const s = this.#limits.get(k) ?? { failures: 0, lockedUntil: 0, lockouts: 0 };
      if (s.lockedUntil !== 0 && s.lockedUntil <= now) {
        s.lockedUntil = 0;
        s.failures = 0;
      }
      s.failures += 1;
      if (s.failures >= this.#maxAttempts) {
        const ms = Math.min(this.#lockoutMs * 2 ** s.lockouts, this.#maxLockoutMs);
        s.lockouts += 1;
        s.lockedUntil = now + ms;
        retryAfterMs = Math.max(retryAfterMs, ms);
      }
      this.#limits.set(k, s);
    }
    if (this.#limits.size > 10_000)
      for (const [k, s] of this.#limits) if (s.lockedUntil <= now) this.#limits.delete(k);
    return retryAfterMs;
  }

  #remember(challenge: string, kind: Kind, terminal: string): void {
    const now = this.#now();
    if (this.#challenges.size >= MAX_CHALLENGES)
      for (const [c, e] of this.#challenges) if (e.exp <= now) this.#challenges.delete(c);
    // Still full of live challenges: drop the oldest so a flood cannot block the vendor.
    if (this.#challenges.size >= MAX_CHALLENGES) {
      const oldest = this.#challenges.keys().next().value;
      if (oldest !== undefined) this.#challenges.delete(oldest);
    }
    this.#challenges.set(challenge, { kind, terminal, exp: now + CHALLENGE_TTL_MS });
  }

  /** Single use: the challenge is gone after the first check, matching or not. */
  #take(challenge: string, kind: Kind, terminal: string): boolean {
    const e = this.#challenges.get(challenge);
    this.#challenges.delete(challenge);
    return !!e && e.kind === kind && e.terminal === terminal && e.exp > this.#now();
  }
}

function transports(p: PasskeyCredential): AuthenticatorTransport[] | undefined {
  return p.transports as AuthenticatorTransport[] | undefined;
}
