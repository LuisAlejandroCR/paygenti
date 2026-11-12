// web/src/passkey.ts: Face ID / fingerprint unlock for the vendor screen (WebAuthn platform passkeys).
// Options are fetched ahead of the tap, so the browser sees the WebAuthn call right inside the click
// (Safari drops the user gesture across a slow fetch). The PIN stays the fallback for every failure.

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { ApiError } from "./api";

/** The server keeps a challenge 5 minutes; refetch a bit before that. */
const FRESH_MS = 4 * 60_000;

/** "This phone enrolled a passkey for this terminal": only then the Face ID button shows. */
export const passkeyFlag = {
  key: (terminal: string) => `paygent.passkey.${terminal}`,
  get(terminal: string): boolean {
    try {
      return localStorage.getItem(this.key(terminal)) === "1";
    } catch {
      return false;
    }
  },
  set(terminal: string, on: boolean) {
    try {
      if (on) localStorage.setItem(this.key(terminal), "1");
      else localStorage.removeItem(this.key(terminal));
    } catch {
      /* private mode: the PIN still works */
    }
  },
};

/** True only with a platform authenticator that verifies the user (Face ID, Touch ID, fingerprint). */
export async function platformPasskeys(): Promise<boolean> {
  try {
    return browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
  } catch {
    return false;
  }
}

async function post<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP_${res.status}`);
  return data as T;
}

type Fetched<T> = { at: number; options: T };
const fresh = <T>(f: Fetched<T> | undefined): f is Fetched<T> =>
  !!f && Date.now() - f.at < FRESH_MS;

/** One terminal's passkey flows; `prepare*` fetch options early, the tap methods use them. */
export function passkeyClient(terminal: string) {
  const base = `/api/terminals/${terminal}/passkey`;
  let reg: Fetched<PublicKeyCredentialCreationOptionsJSON> | undefined;
  let auth: Fetched<PublicKeyCredentialRequestOptionsJSON> | undefined;

  return {
    async prepareEnrol(token: string) {
      reg = { at: Date.now(), options: await post(`${base}/register/options`, {}, token) };
    },
    /** Face ID / fingerprint prompt, then the server stores the public key. */
    async enrol(token: string): Promise<void> {
      const options = fresh(reg)
        ? reg.options
        : await post<PublicKeyCredentialCreationOptionsJSON>(`${base}/register/options`, {}, token);
      reg = undefined;
      const response = await startRegistration({ optionsJSON: options });
      await post(`${base}/register`, { response }, token);
      passkeyFlag.set(terminal, true);
    },
    async prepareUnlock() {
      auth = { at: Date.now(), options: await post(`${base}/options`, {}) };
    },
    /** Face ID / fingerprint prompt; resolves to the same device token the PIN gives. */
    async unlock(): Promise<{ token: string; expiresInMs: number }> {
      const options = fresh(auth)
        ? auth.options
        : await post<PublicKeyCredentialRequestOptionsJSON>(`${base}/options`, {});
      auth = undefined;
      const response = await startAuthentication({ optionsJSON: options });
      return post(`${base}/unlock`, { response });
    },
  };
}
