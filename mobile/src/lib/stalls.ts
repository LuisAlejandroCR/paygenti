// src/lib/stalls.ts: pure helpers for several paygents (stalls) on one phone — the back-office API
// path per stall (Rosa keeps /api/backoffice), the owner sessions header and whether to show the
// switcher (only with 2+ stalls). No network or React here.

export const DEFAULT_STALL = "rosa";
export const ALL_STALLS = "__all";
const ID = /^[a-z0-9-]{1,40}$/;

export function isStallId(id: string): boolean {
  return ID.test(id);
}

/** Back-office API path on a stall: "/api/backoffice/ledger" or "/api/stalls/beto/backoffice/ledger". */
export function boPath(stall: string, path: string): string {
  if (!isStallId(stall)) throw new Error(`stalls: invalid stall "${stall}"`);
  return stall === DEFAULT_STALL ? `/api/backoffice${path}` : `/api/stalls/${stall}/backoffice${path}`;
}

/** "rosa=<token>,beto=<token>" for the stalls this phone holds a session for. */
export function sessionsHeader(tokens: Readonly<Record<string, string | undefined>>): string {
  return Object.entries(tokens)
    .filter((e): e is [string, string] => isStallId(e[0]) && !!e[1])
    .map(([s, t]) => `${s}=${t}`)
    .join(",");
}

export function showSwitcher(stalls: readonly unknown[]): boolean {
  return stalls.length >= 2;
}
