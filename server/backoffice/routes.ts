// server/backoffice/routes.ts: /api/backoffice/* — PIN login to a vendor session, fixed tool
// endpoints (sales, reconcile, invoice, refund) and the optional Claude agent. Without a session
// the caller is treated as a customer, so the policy denies any money movement.
import { createHash, randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { money } from "../../shared/money";
import { pickLang } from "../lang";
import { PayPalError } from "../paypal/gateway";
import { type ModelClient, runAgent } from "./agent";
import { type Authority, type BackOffice, BackOfficeError } from "./tools";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const pinField = z.string().max(16).optional();
const loginBody = z.strictObject({ pin: z.string().max(16) });
const reconcileBody = z.strictObject({ cashMinor: z.number().int().min(0).max(100_000_000) });
const invoiceBody = z.strictObject({
  amountMinor: z.number().int().positive().max(10_000_000),
  description: z.string().max(200),
});
const refundBody = z.strictObject({
  saleId: z.string().min(1).max(64),
  amountMinor: z.number().int().positive().max(10_000_000),
  pin: pinField,
});
const agentBody = z.strictObject({
  message: z.string().min(1).max(1000),
  pin: pinField,
  locale: z.enum(["en", "es"]).optional(),
});

export interface BackOfficeRouteDeps {
  office: BackOffice;
  model?: ModelClient;
  clock?: () => number;
}

export function backofficeRoutes(deps: BackOfficeRouteDeps): Hono {
  const { office, model } = deps;
  const clock = deps.clock ?? Date.now;
  const sessions = new Map<string, number>();
  const app = new Hono();

  /** Vendor only with a live session token; everybody else is a customer to the policy. */
  const authority = (c: Context, pin?: string): Authority => {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(c.req.header("authorization") ?? "")?.[1];
    const exp = token ? sessions.get(token) : undefined;
    const vendor = exp !== undefined && exp > clock();
    const client = [clientIp(c)];
    if (token)
      client.push(`session:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`);
    return { actor: vendor ? "vendor" : "customer", pin, client };
  };
  const requireVendor = (c: Context) =>
    authority(c).actor === "vendor" ? undefined : c.json({ error: "SESSION_REQUIRED" }, 401);

  app.get("/config", (c) => c.json({ agent: model !== undefined, limits: office.policy.config }));

  app.post("/session", async (c) => {
    const body = loginBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const result = office.policy.verifyPin("vendor", body.data.pin, [clientIp(c)]);
    if (!result.ok) return c.json({ error: result.code }, result.code === "PIN_LOCKED" ? 429 : 401);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, clock() + SESSION_TTL_MS);
    return c.json({ token, expiresInMs: SESSION_TTL_MS });
  });

  app.get("/sales-today", (c) => requireVendor(c) ?? c.json(office.salesToday()));

  app.get("/ledger", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const date = c.req.query("date");
    if (date !== undefined && !isDay(date)) return c.json({ error: "INVALID_DATE" }, 400);
    return c.json(office.ledger(date));
  });

  app.post("/reconcile", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const body = reconcileBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    return c.json(office.cashReconcile(body.data.cashMinor));
  });

  app.post("/invoices", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const body = invoiceBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const amount = money(body.data.amountMinor, office.policy.config.currency);
    try {
      return c.json(await office.createInvoice(amount, body.data.description, authority(c)), 201);
    } catch (err) {
      if (err instanceof BackOfficeError)
        return c.json({ error: err.code, reason: err.message, params: err.params }, 403);
      if (err instanceof PayPalError)
        return c.json({ error: "PAYPAL_ERROR", issue: err.issue }, 502);
      throw err;
    }
  });

  // No requireVendor here on purpose: the policy itself must refuse a customer, and it audits it.
  app.post("/refunds", async (c) => {
    const body = refundBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const amount = money(body.data.amountMinor, office.policy.config.currency);
    const r = await office.refund(
      { saleId: body.data.saleId, amount },
      authority(c, body.data.pin),
    );
    return r.ok ? c.json(r) : c.json({ error: r.code, reason: r.reason, params: r.params }, 403);
  });

  app.post("/agent", async (c) => {
    if (!model) return c.json({ error: "AGENT_DISABLED" }, 503);
    const body = agentBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    try {
      const lang = body.data.locale ?? pickLang(c.req.header("accept-language"));
      return c.json(
        await runAgent(model, office, body.data.message, authority(c, body.data.pin), lang),
      );
    } catch (err) {
      console.error(`agent failed: ${(err as Error).message}`);
      return c.json({ error: "AGENT_FAILED" }, 502);
    }
  });

  app.get("/audit", (c) => requireVendor(c) ?? c.json({ entries: office.policy.audit.entries() }));

  return app;
}

/**
 * The caller's IP: first hop of X-Forwarded-For (Render's proxy sets it), else the socket address.
 * X-Forwarded-For can be forged when there is no proxy in front; the PIN guard's global backstop
 * still caps guesses from rotating addresses.
 */
export function clientIp(c: Context): string {
  const first = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return `ip:${first.slice(0, 64)}`;
  try {
    return `ip:${getConnInfo(c).remote.address ?? "unknown"}`;
  } catch {
    return "ip:unknown";
  }
}

function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
