// web/src/stall.ts: which paygent (stall) the back office is acting on, and its session token.
// The stall comes from ?stall= (then sessionStorage, then "rosa"); Rosa keeps the legacy API path
// (/api/backoffice) and token key, other stalls use /api/stalls/:id/backoffice and their own token.
import type { StallSummary } from "../../shared/types";

export const DEFAULT_STALL = "rosa";
const STALL_KEY = "paygent.stall";
const ID = /^[a-z0-9-]{1,40}$/;

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

export function currentStall(): string {
  const fromUrl =
    typeof location === "undefined" ? null : new URLSearchParams(location.search).get("stall");
  if (fromUrl && ID.test(fromUrl)) {
    try {
      storage()?.setItem(STALL_KEY, fromUrl);
    } catch {
      // Storage blocked: the URL still carries the stall.
    }
    return fromUrl;
  }
  let saved: string | null | undefined;
  try {
    saved = storage()?.getItem(STALL_KEY);
  } catch {
    saved = null;
  }
  return saved && ID.test(saved) ? saved : DEFAULT_STALL;
}

/** Back-office API URL for `path` ("/ledger", "/session"...) on the current stall. */
export function boUrl(path: string, stall = currentStall()): string {
  return stall === DEFAULT_STALL
    ? `/api/backoffice${path}`
    : `/api/stalls/${stall}/backoffice${path}`;
}

/** sessionStorage key of a stall's back-office session token. */
export function tokenKey(stall = currentStall()): string {
  return stall === DEFAULT_STALL ? "paygent.bo.token" : `paygent.bo.token.${stall}`;
}

export function readToken(stall = currentStall()): string | null {
  try {
    return storage()?.getItem(tokenKey(stall)) ?? null;
  } catch {
    return null;
  }
}

/** "rosa=<token>,beto=<token>" for every stall this browser is signed in to (owner endpoints). */
export function sessionsHeader(stalls: readonly string[]): string {
  return stalls
    .map((s) => [s, readToken(s)] as const)
    .filter(([, t]) => !!t)
    .map(([s, t]) => `${s}=${t}`)
    .join(",");
}

export async function fetchStalls(): Promise<StallSummary[]> {
  try {
    const r = await fetch("/api/stalls");
    if (!r.ok) return [];
    return ((await r.json()) as { stalls: StallSummary[] }).stalls;
  } catch {
    return [];
  }
}
