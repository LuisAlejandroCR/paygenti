// server/owner/routes.ts: owner-level API across stalls. /api/stalls lists the paygents (public, like
// the terminals); /api/owner/* needs a live back-office session per stall in X-Paygent-Sessions
// ("rosa=<token>,beto=<token>") and only ever covers those stalls: overview totals per currency
// (never mixed) and MCP tokens for Claude (create shows the secret once; revoke; list hashes away).
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type Money, money } from "../../shared/money";
import type { StallSummary } from "../../shared/types";
import { isLiveSession } from "../backoffice/routes";
import type { Store } from "../store";
import { issueToken } from "./mcp";
import type { Stall } from "./stalls";

export interface OwnerDeps {
  store: Store;
  stalls: ReadonlyMap<string, Stall>;
  clock?: () => number;
}

export interface StallOverview {
  id: string;
  displayName: string;
  currency: string;
  day: string;
  paid: Money;
  cash: Money;
  refunded: Money;
  net: Money;
  count: number;
  pendingApprovals: number;
}

export interface CurrencyTotal {
  currency: string;
  paid: Money;
  cash: Money;
  refunded: Money;
  net: Money;
  count: number;
  stalls: number;
}

const tokenBody = z.strictObject({ label: z.string().max(60).optional() });
const idParam = z.uuid();

/** Stalls for which the request carries a live session, in store order. */
export function authorizedStalls(c: Context, deps: OwnerDeps): Stall[] {
  const now = (deps.clock ?? Date.now)();
  const header = c.req.header("x-paygent-sessions") ?? "";
  const ok = new Set<string>();
  for (const part of header.split(",").slice(0, 50)) {
    const [id, token] = part.split("=").map((s) => s.trim());
    const stall = id ? deps.stalls.get(id) : undefined;
    if (stall && token && isLiveSession(stall.sessions, token, now)) ok.add(stall.id);
  }
  return [...deps.stalls.values()].filter((s) => ok.has(s.id));
}

export function stallSummaries(deps: OwnerDeps): StallSummary[] {
  return [...deps.stalls.values()].flatMap((s) => {
    const v = s.store.getVendor(s.id);
    return v
      ? [
          {
            id: v.id,
            displayName: v.displayName,
            currency: v.currency,
            terminals: s.store.terminalsForVendor(v.id).map((t) => t.id),
          },
        ]
      : [];
  });
}

/** Today's totals per stall and per currency; amounts of different currencies are never summed. */
export function overview(stalls: Stall[]): { stalls: StallOverview[]; totals: CurrencyTotal[] } {
  const rows = stalls.map((s): StallOverview => {
    const l = s.office.ledger();
    const v = s.store.getVendor(s.id);
    return {
      id: s.id,
      displayName: v?.displayName ?? s.id,
      currency: l.totals.net.currency,
      day: l.day,
      paid: l.totals.paid,
      cash: l.totals.cash,
      refunded: l.totals.refunded,
      net: l.totals.net,
      count: l.totals.count,
      pendingApprovals: s.approvals.pending().length,
    };
  });
  const by = new Map<string, CurrencyTotal>();
  for (const r of rows) {
    const c = r.net.currency;
    const t = by.get(c) ?? {
      currency: c,
      paid: money(0, c),
      cash: money(0, c),
      refunded: money(0, c),
      net: money(0, c),
      count: 0,
      stalls: 0,
    };
    for (const k of ["paid", "cash", "refunded", "net"] as const) {
      if (r[k].currency !== c) throw new Error("overview: mixed currencies in one stall");
      t[k] = money(t[k].minor + r[k].minor, c);
    }
    t.count += r.count;
    t.stalls += 1;
    by.set(c, t);
  }
  return { stalls: rows, totals: [...by.values()] };
}

export function ownerRoutes(deps: OwnerDeps): { stalls: Hono; owner: Hono } {
  const clock = deps.clock ?? Date.now;
  const stalls = new Hono();
  stalls.get("/", (c) => c.json({ stalls: stallSummaries(deps) }));

  const owner = new Hono();
  const need = (c: Context): Stall[] | Response => {
    const mine = authorizedStalls(c, deps);
    return mine.length > 0 ? mine : c.json({ error: "SESSION_REQUIRED" }, 401);
  };

  owner.get("/overview", (c) => {
    const mine = need(c);
    return mine instanceof Response ? mine : c.json(overview(mine));
  });

  owner.get("/mcp-tokens", (c) => {
    const mine = need(c);
    if (mine instanceof Response) return mine;
    const ids = new Set(mine.map((s) => s.id));
    return c.json({
      tokens: deps.store
        .mcpTokens()
        .filter((t) => t.stalls.some((s) => ids.has(s)))
        .map(({ tokenHash: _hash, ...t }) => t),
    });
  });

  // The token can reach exactly the stalls the owner is signed in to right now.
  owner.post("/mcp-tokens", async (c) => {
    const mine = need(c);
    if (mine instanceof Response) return mine;
    let raw: unknown = {};
    try {
      raw = await c.req.json();
    } catch {
      // empty body: default label
    }
    const body = tokenBody.safeParse(raw ?? {});
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const { secret, token } = issueToken(
      deps.store,
      body.data.label ?? "Claude",
      mine.map((s) => s.id),
      clock(),
    );
    const { tokenHash: _hash, ...shown } = token;
    return c.json({ token: shown, secret }, 201);
  });

  // Revoking needs a session on every stall the token reaches.
  owner.post("/mcp-tokens/:id/revoke", (c) => {
    const mine = need(c);
    if (mine instanceof Response) return mine;
    const id = idParam.safeParse(c.req.param("id"));
    const token = id.success ? deps.store.mcpTokens().find((t) => t.id === id.data) : undefined;
    const ids = new Set(mine.map((s) => s.id));
    if (!token || !token.stalls.every((s) => ids.has(s)))
      return c.json({ error: "TOKEN_NOT_FOUND" }, 404);
    if (!token.revokedAt)
      deps.store.saveMcpToken({ ...token, revokedAt: new Date(clock()).toISOString() });
    return c.json({ ok: true });
  });

  return { stalls, owner };
}
