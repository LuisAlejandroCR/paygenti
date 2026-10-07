// server/backoffice/routes.ts: /api/backoffice/* — PIN login to a vendor session, fixed tool
// endpoints (sales, reconcile, invoice, refund, suppliers and payouts), the financial footprint
// (PIN-gated statement import, savings goal) and the optional Claude agent.
// Without a session the caller is treated as a customer, so the policy denies any money movement.
import { createHash, randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import QRCode from "qrcode";
import { z } from "zod";
import { chargeableCurrencies, findCountry, isPayPalCurrency } from "../../shared/currency";
import { money, retag } from "../../shared/money";
import { encodePayload } from "../../shared/passport";
import { buildCatalog, catalogInput } from "../catalog/catalog";
import { ExtractError, extractMenu, MAX_IMAGE_BYTES, type VisionClient } from "../catalog/extract";
import { pickLang } from "../lang";
import type { ApprovalDesk } from "../owner/approvals";
import {
  addDays,
  buildPassport,
  DEFAULT_RANGE_DAYS,
  daysBetween,
  MAX_RANGE_DAYS,
  type PassportSigner,
} from "../passport";
import { PayPalError } from "../paypal/gateway";
import { localDay, type PolicyConfig } from "../policy";
import { MAX_STATEMENT_BYTES, parseStatement, StatementError } from "../statement";
import type { Store } from "../store";
import { type ModelClient, runAgent } from "./agent";
import { type DeskResult, supplierInput } from "./payouts";
import type { PayPalTools } from "./paypal-tools";
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
const dayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isDay)
  .optional();
const passportBody = z.strictObject({
  from: dayField,
  to: dayField,
  cashMinor: z.number().int().min(0).max(1_000_000_000).optional(),
});
export const vendorBody = z
  .strictObject({
    displayName: z.string().trim().min(1).max(60),
    country: z
      .string()
      .length(2)
      .refine((c) => findCountry(c) !== undefined),
    currency: z.string().refine(isPayPalCurrency),
  })
  .refine((b) => chargeableCurrencies(b.country).includes(b.currency as never), {
    path: ["currency"],
    message: "currency not chargeable from this country",
  });
const supplierBody = supplierInput.extend({ pin: pinField });
const pinBody = z.strictObject({ pin: pinField });
const payoutBody = z.strictObject({
  supplierId: z.string().min(1).max(64),
  amountMinor: z.number().int().positive().max(10_000_000),
  note: z.string().max(200).optional(),
  pin: pinField,
  requestId: z.uuid().optional(),
});
const goalBody = z.strictObject({
  targetMinor: z.number().int().positive().max(10_000_000_000),
  savedMinor: z.number().int().min(0).max(10_000_000_000),
});
const idParam = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
/** HTTP status for a refused desk result: validation 400, conflicts 409, PayPal 502, policy 403. */
const DESK_STATUS: Record<string, 400 | 404 | 409 | 502 | 504> = {
  INVALID_SUPPLIER: 400,
  SUPPLIER_NOT_FOUND: 404,
  SUPPLIER_EXISTS: 409,
  PAYOUTS_NOT_ENABLED: 502,
  PAYOUT_INSUFFICIENT_FUNDS: 502,
  PAYOUT_FAILED: 502,
  PAYOUT_UNCONFIRMED: 504,
};

const agentBody = z.strictObject({
  message: z.string().min(1).max(1000),
  pin: pinField,
  locale: z.enum(["en", "es"]).optional(),
});

export interface BackOfficeRouteDeps {
  office: BackOffice;
  model?: ModelClient;
  /** PayPal Agent Toolkit tools for the agent; omitted in mock mode. */
  paypalTools?: PayPalTools;
  clock?: () => number;
  /** Where the catalog lives and whose catalog the back office edits. */
  store: Store;
  vendorId: string;
  /** Claude vision for menu photos; omitted when there is no ANTHROPIC_API_KEY. */
  vision?: VisionClient;
  /** Signs sales passports; the public half is served at /api/passport/public-key. */
  passport: PassportSigner;
  /** Base URL for verify links; defaults to the request origin. */
  publicUrl?: string;
  /** This stall's session tokens (token -> expiry); shared with the owner routes. */
  sessions?: Map<string, number>;
  /** This stall's inbox of Claude proposals (refunds, payouts) awaiting the PIN. */
  approvals?: ApprovalDesk;
}

const imageJson = z.strictObject({
  image: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64),
});

export function backofficeRoutes(deps: BackOfficeRouteDeps): Hono {
  const { office, model } = deps;
  const clock = deps.clock ?? Date.now;
  const sessions = deps.sessions ?? new Map<string, number>();
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

  app.get("/config", (c) =>
    c.json({
      agent: model !== undefined,
      paypalTools: model ? (deps.paypalTools?.tools().map((t) => t.name) ?? []) : [],
      limits: publicLimits(office.policy.config),
    }),
  );

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
        await runAgent(
          model,
          office,
          body.data.message,
          authority(c, body.data.pin),
          lang,
          deps.paypalTools,
        ),
      );
    } catch (err) {
      console.error(`agent failed: ${(err as Error).message}`);
      return c.json({ error: "AGENT_FAILED" }, 502);
    }
  });

  app.get("/vendor", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const vendor = deps.store.getVendor(deps.vendorId);
    return vendor ? c.json({ vendor }) : c.json({ error: "VENDOR_NOT_FOUND" }, 404);
  });

  // Onboarding / settings: stall name, country, charge currency. Prices are never converted (no FX
  // source): on a currency change they keep their face value and the vendor is asked to re-check.
  app.put("/vendor", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const vendor = deps.store.getVendor(deps.vendorId);
    if (!vendor) return c.json({ error: "VENDOR_NOT_FOUND" }, 404);
    const body = vendorBody.safeParse(await readJson(c));
    if (!body.success)
      return c.json(
        { error: "INVALID_VENDOR", issues: body.error.issues.map((i) => i.path.join(".")) },
        400,
      );
    const country = findCountry(body.data.country);
    const currency = body.data.currency;
    if (!country || !isPayPalCurrency(currency)) return c.json({ error: "INVALID_VENDOR" }, 400);
    const changed = currency !== vendor.currency;
    const updated = deps.store.updateVendor(vendor.id, {
      displayName: body.data.displayName,
      country: country.code,
      timeZone: country.timeZone,
      currency,
      onboarded: true,
      ...(changed && {
        catalog: vendor.catalog.map((i) => ({ ...i, price: retag(i.price, currency) })),
        pricesNeedReview: vendor.catalog.length > 0,
      }),
    });
    office.policy.setCurrency(currency, country.timeZone);
    office.policy.audit.append({
      at: new Date(clock()).toISOString(),
      event: "vendor",
      actor: "vendor",
      action: {
        type: "vendor.update",
        vendorId: vendor.id,
        country: country.code,
        from: vendor.currency,
        currency,
      },
      decision: {
        allow: true,
        code: "VENDOR_SAVED",
        reason: changed ? `Moneda: ${vendor.currency} -> ${currency}` : "Perfil guardado",
      },
    });
    return c.json({ vendor: updated, limits: publicLimits(office.policy.config) });
  });

  app.get("/catalog", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const vendor = deps.store.getVendor(deps.vendorId);
    return c.json({
      currency: vendor?.currency,
      items: vendor?.catalog ?? [],
      vision: !!deps.vision,
    });
  });

  app.put("/catalog", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const vendor = deps.store.getVendor(deps.vendorId);
    if (!vendor) return c.json({ error: "VENDOR_NOT_FOUND" }, 404);
    const body = catalogInput.safeParse(await readJson(c));
    if (!body.success)
      return c.json(
        { error: "INVALID_CATALOG", issues: body.error.issues.map((i) => i.path.join(".")) },
        400,
      );
    const catalog = buildCatalog(body.data.items, vendor.currency);
    deps.store.setCatalog(vendor.id, catalog);
    office.policy.audit.append({
      at: new Date(clock()).toISOString(),
      event: "catalog",
      actor: "vendor",
      action: { type: "catalog.save", vendorId: vendor.id, skus: catalog.map((i) => i.sku) },
      decision: { allow: true, code: "CATALOG_SAVED", reason: `${catalog.length} items saved` },
    });
    return c.json({ items: catalog });
  });

  // Proposes items only; nothing is saved until the vendor reviews them and calls PUT /catalog.
  app.post("/catalog/extract", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    if (!deps.vision) return c.json({ error: "VISION_DISABLED" }, 503);
    const bytes = await readImage(c);
    if (!bytes) return c.json({ error: "INVALID_BODY" }, 400);
    try {
      const currency =
        deps.store.getVendor(deps.vendorId)?.currency ?? office.policy.config.currency;
      return c.json({ items: await extractMenu(bytes, currency, deps.vision) });
    } catch (err) {
      if (!(err instanceof ExtractError)) throw err;
      if (err.code === "EXTRACT_FAILED") {
        console.error(`menu extract failed: ${err.message}`);
        return c.json({ error: err.code }, 502);
      }
      return c.json({ error: err.code }, err.code === "IMAGE_TOO_LARGE" ? 413 : 415);
    }
  });

  app.post("/passport", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const body = passportBody.safeParse((await readJson(c)) ?? {});
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const { timeZone, currency } = office.policy.config;
    const today = localDay(new Date(clock()), timeZone);
    const to = body.data.to ?? today;
    const from = body.data.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_RANGE_DAYS) return c.json({ error: "INVALID_RANGE" }, 400);
    const vendor = deps.store.getVendor(deps.vendorId);
    const report = buildPassport({
      vendor: { id: deps.vendorId, name: vendor?.displayName ?? deps.vendorId },
      currency,
      timeZone,
      from,
      to,
      issuedAt: new Date(clock()).toISOString(),
      demoKey: deps.passport.demo,
      sales: office.passportSales(),
      cashDictated: body.data.cashMinor,
      statement: deps.store.statementMonths(deps.vendorId),
      goal: deps.store.savingsGoal(deps.vendorId),
    });
    const signed = deps.passport.sign(report);
    const origin = (deps.publicUrl ?? new URL(c.req.url).origin).replace(/\/+$/, "");
    const verifyUrl = `${origin}/verify#${encodePayload(signed)}`;
    let qr: string | null = null;
    try {
      qr = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "L", margin: 1 });
    } catch {
      // Too long for a QR code (very busy period): the link still works.
    }
    return c.json({ ...signed, verifyUrl, qr });
  });

  // Financial footprint inputs. Statement import and deletion need the PIN, like money movements.
  const pinDenied = (c: Context, pin: unknown) => {
    if (typeof pin !== "string" || pin === "") return c.json({ error: "PIN_REQUIRED" }, 403);
    const r = office.policy.verifyPin("vendor", pin, authority(c).client);
    if (r.ok) return undefined;
    return c.json({ error: r.code }, r.code === "PIN_LOCKED" ? 429 : 403);
  };

  app.get("/footprint", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    return c.json({
      statement: deps.store.statementMonths(deps.vendorId),
      goal: deps.store.savingsGoal(deps.vendorId) ?? null,
    });
  });

  // Multipart: file (CSV/OFX/QFX), pin, optional currency. The file lives only in this request:
  // it is reduced to monthly aggregates and dropped; nothing from it is logged.
  app.post("/statement", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    if (!(c.req.header("content-type") ?? "").startsWith("multipart/form-data"))
      return c.json({ error: "INVALID_BODY" }, 400);
    let form: Record<string, string | File>;
    try {
      form = (await c.req.parseBody()) as Record<string, string | File>;
    } catch {
      return c.json({ error: "INVALID_BODY" }, 400);
    }
    const pinRefused = pinDenied(c, form.pin);
    if (pinRefused) return pinRefused;
    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: "STATEMENT_EMPTY" }, 400);
    if (file.size > MAX_STATEMENT_BYTES) return c.json({ error: "STATEMENT_TOO_LARGE" }, 413);
    const fallback =
      typeof form.currency === "string" && isPayPalCurrency(form.currency.toUpperCase())
        ? form.currency.toUpperCase()
        : office.policy.config.currency;
    try {
      const summary = parseStatement(new Uint8Array(await file.arrayBuffer()), fallback);
      deps.store.saveStatementMonths(deps.vendorId, summary.months);
      return c.json({
        imported: summary.months,
        transactions: summary.transactions,
        skipped: summary.skipped,
        ownAccountMoves: summary.ownAccountMoves,
        statement: deps.store.statementMonths(deps.vendorId),
      });
    } catch (err) {
      if (!(err instanceof StatementError)) {
        console.error("statement import failed");
        return c.json({ error: "STATEMENT_UNREADABLE" }, 400);
      }
      return c.json({ error: err.code }, err.code === "STATEMENT_TOO_LARGE" ? 413 : 400);
    }
  });

  app.post("/statement/remove", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const body = pinBody.safeParse((await readJson(c)) ?? {});
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const pinRefused = pinDenied(c, body.data.pin);
    if (pinRefused) return pinRefused;
    return c.json({ removed: deps.store.deleteStatementMonths(deps.vendorId) });
  });

  app.put("/savings-goal", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const body = goalBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_GOAL" }, 400);
    const goal = {
      currency: office.policy.config.currency as string,
      target: body.data.targetMinor,
      saved: body.data.savedMinor,
    };
    deps.store.saveSavingsGoal(deps.vendorId, goal);
    return c.json({ goal });
  });

  app.delete("/savings-goal", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    deps.store.saveSavingsGoal(deps.vendorId, undefined);
    return c.json({ goal: null });
  });

  app.get("/audit", (c) => requireVendor(c) ?? c.json({ entries: office.policy.audit.entries() }));

  const desk = office.payouts;
  const deskReply = <T>(c: Context, r: DeskResult<T>, okStatus: 200 | 201 = 200) =>
    r.ok
      ? c.json(r, okStatus)
      : c.json({ error: r.code, reason: r.reason, params: r.params }, DESK_STATUS[r.code] ?? 403);

  app.get("/suppliers", (c) => requireVendor(c) ?? c.json({ suppliers: desk.suppliers() }));

  // Allowlist changes: vendor session to reach them, then the policy wants the PIN (and audits).
  app.post("/suppliers", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const body = supplierBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_SUPPLIER" }, 400);
    const { pin, ...input } = body.data;
    return deskReply(c, desk.addSupplier(input, authority(c, pin)), 201);
  });

  app.post("/suppliers/:id/remove", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const id = idParam.safeParse(c.req.param("id"));
    const body = pinBody.safeParse((await readJson(c)) ?? {});
    if (!id.success || !body.success) return c.json({ error: "INVALID_BODY" }, 400);
    return deskReply(c, desk.removeSupplier(id.data, authority(c, body.data.pin)));
  });

  app.get(
    "/payouts",
    (c) =>
      requireVendor(c) ??
      c.json({ payouts: desk.history(), limits: desk.limits(), paypal: office.paypalMode }),
  );

  // Like /refunds: no requireVendor on purpose; the policy refuses a customer and audits it.
  app.post("/payouts", async (c) => {
    const body = payoutBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const { pin, ...req } = body.data;
    return deskReply(c, await desk.pay(req, authority(c, pin)), 201);
  });

  app.post("/payouts/:id/refresh", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "PAYOUT_NOT_FOUND" }, 404);
    try {
      const payout = await desk.refresh(id.data);
      return payout ? c.json({ payout }) : c.json({ error: "PAYOUT_NOT_FOUND" }, 404);
    } catch (err) {
      if (err instanceof PayPalError)
        return c.json(
          { error: err.issue === "PAYOUTS_NOT_ENABLED" ? err.issue : "PAYPAL_ERROR" },
          502,
        );
      throw err;
    }
  });

  // Claude's proposals: listed with a session; approving runs the real refund/payout and needs
  // this stall's PIN in the human's request (Claude never sees it); rejecting needs the session.
  const inbox = deps.approvals;
  app.get("/approvals", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    return c.json({ approvals: inbox?.list() ?? [] });
  });

  app.post("/approvals/:id/approve", async (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    if (!inbox) return c.json({ error: "APPROVAL_NOT_FOUND" }, 404);
    const id = idParam.safeParse(c.req.param("id"));
    const body = z.strictObject({ pin: z.string().max(16) }).safeParse(await readJson(c));
    if (!id.success || !body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const r = await inbox.approve(id.data, authority(c, body.data.pin));
    if (r.ok) return c.json(r);
    const status = r.code === "APPROVAL_NOT_FOUND" ? 404 : r.code === "APPROVAL_DONE" ? 409 : 403;
    return c.json({ error: r.code, reason: r.reason, approval: r.approval }, status);
  });

  app.post("/approvals/:id/reject", (c) => {
    const denied = requireVendor(c);
    if (denied) return denied;
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success || !inbox) return c.json({ error: "APPROVAL_NOT_FOUND" }, 404);
    const r = inbox.reject(id.data);
    if (r.ok) return c.json(r);
    return c.json({ error: r.code, reason: r.reason }, r.code === "APPROVAL_DONE" ? 409 : 404);
  });

  return app;
}

/** True when `token` is a live session of this stall's sessions map. */
export function isLiveSession(sessions: Map<string, number>, token: string, now: number): boolean {
  const exp = /^[a-f0-9]{64}$/.test(token) ? sessions.get(token) : undefined;
  return exp !== undefined && exp > now;
}

/** Caps for the web; the payout allowlist (suppliers' emails and phones) is never public. */
function publicLimits(config: PolicyConfig): Omit<PolicyConfig, "payoutAllowlist"> {
  const { payoutAllowlist: _private, ...limits } = config;
  return limits;
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

/** Image bytes from multipart (field "image") or JSON `{ image: base64 | data URL }`. */
async function readImage(c: Context): Promise<Uint8Array | undefined> {
  const type = c.req.header("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      const file = (await c.req.parseBody()).image;
      return file instanceof File ? new Uint8Array(await file.arrayBuffer()) : undefined;
    }
    const body = imageJson.safeParse(await c.req.json());
    if (!body.success) return undefined;
    const b64 = body.data.image.replace(/^data:[^;,]*;base64,/, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return undefined;
    return new Uint8Array(Buffer.from(b64, "base64"));
  } catch {
    return undefined;
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
