// server/app.ts: builds the Hono app from its dependencies so tests can drive it with app.request.
// Mounts the sales API, SSE, the sticker redirect /t/:terminal, the PayPal webhook, the mock-only
// approve route and (when built) the web app with SPA fallback. server/index.ts only wires env.
// Webhooks: sale events go to SalesService, payout events (PAYMENT.PAYOUTS*) to the payout desk.

import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import { z } from "zod";
import { verifyPassport } from "../shared/passport";
import {
  buildRailRegistry,
  isPushRail,
  type RailRegistry,
  railsForSale,
  saleStatusLabel,
} from "../shared/rails";
import type { Sale } from "../shared/types";
import type { ModelClient } from "./backoffice/agent";
import type { PayPalTools } from "./backoffice/paypal-tools";
import { backofficeRoutes, clientIp } from "./backoffice/routes";
import { BackOffice } from "./backoffice/tools";
import type { VisionClient } from "./catalog/extract";
import type { IntegrationStatus } from "./integrations";
import { type Lang, pickLang } from "./lang";
import { mcpRoutes } from "./owner/mcp";
import { ownerRoutes } from "./owner/routes";
import { createStall, DEMO_STALL_PINS, type Stall } from "./owner/stalls";
import { PassportSigner } from "./passport";
import { PayPalError, type PayPalGateway } from "./paypal/gateway";
import { MockPayPal } from "./paypal/mock";
import { PolicyEngine } from "./policy";
import { type Clock, SaleError, SalesService } from "./sales";
import { DEFAULT_STALL, MemoryStore } from "./store";
import { parseVoice, type VoiceEnv } from "./voice";
import { MAX_AUDIO_BYTES, type Transcriber } from "./voice/transcribe";

export { pickLang };

export interface AppDeps {
  paypal: PayPalGateway;
  sales?: SalesService;
  clock?: Clock;
  /** Base URL printed in QR codes and stickers; defaults to the request origin. */
  publicUrl?: string;
  /** Directory with the built web app (dist/web); omitted in tests and when not built. */
  staticRoot?: string;
  /** Env for the voice parser (ANTHROPIC_API_KEY); omitted means rules parser only. */
  voiceEnv?: VoiceEnv;
  /** Speech-to-text for browsers without SpeechRecognition; omitted means /api/voice/transcribe is 503. */
  transcriber?: Transcriber;
  /** Back-office lock; defaults to a PolicyEngine with vendorPin (demo "1234"). */
  policy?: PolicyEngine;
  vendorPin?: string;
  /** Claude client for /api/backoffice/agent; omitted when there is no ANTHROPIC_API_KEY. */
  agentModel?: ModelClient;
  /** PayPal Agent Toolkit tools for the agent; omitted without PayPal keys (mock mode). */
  paypalTools?: PayPalTools;
  /** Claude vision for menu photo -> catalog; omitted when there is no ANTHROPIC_API_KEY. */
  menuVision?: VisionClient;
  /** Third-party modes from Integrations, shown on /api/health. */
  integrations?: Record<string, IntegrationStatus>;
  /** Sales passport signer; defaults to an ephemeral demo key. */
  passportSigner?: PassportSigner;
  /** Configured payment rails (Pix, SPEI, Bre-B, wallets); omitted means none beyond PayPal. */
  rails?: RailRegistry;
  /** PIN per stall (STALL_PINS); Rosa falls back to vendorPin, demo stalls to DEMO_STALL_PINS. */
  stallPins?: Record<string, string>;
  /** APPLE_PAY_DOMAIN_ASSOCIATION: Apple's domain-verification file, served under /.well-known. */
  applePayDomainAssociation?: string;
}

const terminalId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const uuid = z.uuid();
const orderId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const createSaleBody = z.union([
  z.strictObject({
    lines: z
      .array(
        z.strictObject({ sku: z.string().min(1).max(64), qty: z.number().int().min(1).max(99) }),
      )
      .min(1)
      .max(50),
  }),
  z.strictObject({ amount: z.number().int().positive().max(10_000_000) }),
]);
const voiceBody = z.strictObject({
  text: z.string().trim().min(1).max(500),
  vendorId: z.string().regex(/^[a-z0-9-]{1,40}$/),
});
const passportVerifyBody = z.object({
  report: z.record(z.string(), z.unknown()),
  signature: z.string().max(200),
  keyId: z.string().max(64),
});
const railBody = z.strictObject({
  rail: z.enum(["paypal", "applepay", "googlepay", "oxxo", "pix", "spei", "breb"]),
});
const pinBody = z.strictObject({ pin: z.string().max(16) });
const approveBody = z.strictObject({ decline: z.boolean().optional() });
const webhookBody = z.object({
  event_type: z.string().max(100),
  resource: z.record(z.string(), z.unknown()),
});

const limit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: "BODY_TOO_LARGE" }, 413),
});
/** Menu photos: a 4 MB image, base64 in JSON or multipart, plus envelope. */
const imageLimit = bodyLimit({
  maxSize: 6 * 1024 * 1024,
  onError: (c) => c.json({ error: "IMAGE_TOO_LARGE" }, 413),
});
const EXTRACT_PATH = "/api/backoffice/catalog/extract";
/** Bank statements: a 1 MB file (checked again in the route) plus the multipart envelope. */
const statementLimit = bodyLimit({
  maxSize: 1024 * 1024 + 16 * 1024,
  onError: (c) => c.json({ error: "STATEMENT_TOO_LARGE" }, 413),
});
const STATEMENT_PATH = "/api/backoffice/statement";
/** Push-to-talk clips recorded with MediaRecorder (Firefox): raw audio body. */
const audioLimit = bodyLimit({
  maxSize: MAX_AUDIO_BYTES,
  onError: (c) => c.json({ error: "AUDIO_TOO_LARGE" }, 413),
});
const TRANSCRIBE_PATH = "/api/voice/transcribe";

export function createApp(deps: AppDeps): Hono {
  const { paypal } = deps;
  const sales =
    deps.sales ?? new SalesService({ store: new MemoryStore(), paypal, clock: deps.clock });
  const app = new Hono();

  // One stall per vendor, each with its own PIN, caps, sessions and inbox. The lock follows each
  // stall's charge currency (caps per currency; MXN keeps its defaults).
  const stalls = new Map<string, Stall>();
  for (const v of sales.store.vendors()) {
    const pin =
      deps.stallPins?.[v.id] ??
      (v.id === DEFAULT_STALL ? deps.vendorPin : DEMO_STALL_PINS[v.id]) ??
      deps.vendorPin ??
      "1234";
    stalls.set(
      v.id,
      createStall({
        base: sales.store,
        vendorId: v.id,
        paypal,
        pin,
        clock: deps.clock,
        policy: v.id === DEFAULT_STALL ? deps.policy : undefined,
      }),
    );
  }
  const main = stalls.get(DEFAULT_STALL) ?? [...stalls.values()][0];
  if (!main) throw new Error("app: the store has no vendor");
  const office = main.office;

  app.onError((err, c) => {
    if (err instanceof SaleError)
      return c.json({ error: err.code, message: err.message }, err.status);
    if (err instanceof PayPalError) {
      console.error(`paypal error: ${err.issue ?? "UNKNOWN"} debug_id=${err.debugId ?? "-"}`);
      return c.json({ error: "PAYPAL_ERROR", issue: err.issue }, 502);
    }
    console.error(`unhandled error: ${err.message}`);
    return c.json({ error: "INTERNAL" }, 500);
  });

  app.use("/api/*", (c, next) =>
    (c.req.path === EXTRACT_PATH
      ? imageLimit
      : c.req.path === STATEMENT_PATH
        ? statementLimit
        : c.req.path === TRANSCRIBE_PATH
          ? audioLimit
          : limit)(c, next),
  );
  app.use("/webhooks/*", limit);

  // Public route: modes only, never the failure reason (it stays in the server log).
  app.get("/api/health", (c) => {
    const integrations =
      deps.integrations &&
      Object.fromEntries(Object.entries(deps.integrations).map(([k, v]) => [k, v.mode]));
    return c.json({ ok: true, paypal: paypal.mode, ...(integrations && { integrations }) });
  });

  app.get("/api/config", (c) =>
    c.json({
      paypal: paypal.mode,
      clientId: paypal.clientId ?? null,
      publicUrl: base(c, deps),
      transcribe: !!deps.transcriber,
    }),
  );

  app.get("/api/terminals/:id", (c) => {
    const id = terminalId.safeParse(c.req.param("id"));
    const terminal = id.success ? sales.store.getTerminal(id.data) : undefined;
    const vendor = terminal && sales.store.getVendor(terminal.vendorId);
    if (!terminal || !vendor) return c.json({ error: "TERMINAL_NOT_FOUND" }, 404);
    return c.json({
      terminal,
      vendor,
      openSale: sales.openSale(terminal.id) ?? null,
      payUrl: `${base(c, deps)}/t/${terminal.id}`,
    });
  });

  app.get("/api/terminals/:id/qr.svg", async (c) => {
    const id = terminalId.safeParse(c.req.param("id"));
    if (!id.success || !sales.store.getTerminal(id.data)) return c.text("not found", 404);
    const svg = await QRCode.toString(`${base(c, deps)}/t/${id.data}`, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
  });

  app.post("/api/terminals/:id/sales", async (c) => {
    const id = terminalId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "TERMINAL_NOT_FOUND" }, 404);
    const body = createSaleBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const sale = await sales.createSale(id.data, body.data);
    return c.json({ sale }, 201);
  });

  app.get("/api/sales/:id", (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const sale = id.success ? sales.getSale(id.data) : undefined;
    if (!sale) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    return c.json({ sale, stall: sales.vendorOf(sale)?.displayName ?? "" });
  });

  app.post("/api/sales/:id/capture", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    const sale = await sales.capture(id.data);
    return c.json({ sale });
  });

  app.post("/api/sales/:id/cancel", (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    return c.json({ sale: sales.cancel(id.data) });
  });

  // Payment rails: only configured ones are listed or accepted (registry hides the rest).
  const rails = deps.rails ?? buildRailRegistry({});
  const paymentFor = (sale: Sale) =>
    isPushRail(sale.method) && sale.status === "pending_bank"
      ? rails.paymentData(sale.method, sale.total, sale.id)
      : undefined;

  app.get("/api/sales/:id/rails", (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const sale = id.success ? sales.getSale(id.data) : undefined;
    if (!sale) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    return c.json({
      rails: railsForSale(rails, sale.total),
      payment: paymentFor(sale) ?? null,
      label: saleStatusLabel(sale.status),
    });
  });

  app.post("/api/sales/:id/rail", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const body = railBody.safeParse(await readJson(c));
    if (!id.success) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const current = sales.getSale(id.data);
    if (!current) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    const choice = body.data.rail;
    let target: "paypal" | "pix" | "spei" | "breb" = "paypal";
    if (choice !== "paypal") {
      const offered = railsForSale(rails, current.total).find((r) => r.id === choice);
      if (!offered) return c.json({ error: "RAIL_NOT_AVAILABLE" }, 400);
      // PayPal-confirmed rails (Apple Pay, Google Pay, OXXO) use the same PayPal order.
      if (isPushRail(offered.id)) target = offered.id;
    }
    const sale = sales.selectRail(id.data, target);
    return c.json({ sale, payment: paymentFor(sale) ?? null, label: saleStatusLabel(sale.status) });
  });

  app.get("/api/sales/:id/rail-qr.svg", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const sale = id.success ? sales.getSale(id.data) : undefined;
    const payment = sale && paymentFor(sale);
    if (!payment) return c.text("not found", 404);
    const svg = await QRCode.toString(payment.qr, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
  });

  // The vendor checked her bank app: PIN-gated, and the sale stays "not verified".
  app.post("/api/sales/:id/vendor-confirm", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const body = pinBody.safeParse(await readJson(c));
    if (!id.success) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const sale = sales.getSale(id.data);
    if (!sale) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    if (sale.status !== "pending_bank" && sale.status !== "vendor_confirmed")
      return c.json({ error: "NOT_PENDING_BANK" }, 409);
    // The PIN of the stall that owns the sale: one stall's PIN never confirms another's sale.
    const stall = stalls.get(sale.vendorId);
    if (!stall) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    const result = stall.policy.verifyPin("vendor", body.data.pin, [clientIp(c)]);
    if (!result.ok) return c.json({ error: result.code }, result.code === "PIN_LOCKED" ? 429 : 401);
    const updated = sales.vendorConfirm(id.data);
    return c.json({ sale: updated, label: saleStatusLabel(updated.status) });
  });

  app.post("/api/sales/:id/extend", (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "SALE_NOT_FOUND" }, 404);
    return c.json({ sale: sales.extend(id.data) });
  });

  app.get("/api/terminals/:id/events", (c) => {
    const id = terminalId.safeParse(c.req.param("id"));
    if (!id.success || !sales.store.getTerminal(id.data)) {
      return c.json({ error: "TERMINAL_NOT_FOUND" }, 404);
    }
    c.header("Cache-Control", "no-store");
    return streamSSE(c, async (stream) => {
      const queue: Promise<void>[] = [];
      const unsubscribe = sales.subscribe(id.data, (event) => {
        queue.push(stream.writeSSE({ event: event.type, data: JSON.stringify(event) }));
      });
      stream.onAbort(unsubscribe);
      const open = sales.openSale(id.data);
      if (open)
        await stream.writeSSE({
          event: "sale.open",
          data: JSON.stringify({ type: "sale.open", sale: open }),
        });
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(15_000);
        await stream.writeSSE({ event: "ping", data: "{}" });
      }
      unsubscribe();
    });
  });

  app.post("/api/voice/parse", async (c) => {
    const body = voiceBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const vendor = sales.store.getVendor(body.data.vendorId);
    if (!vendor) return c.json({ error: "VENDOR_NOT_FOUND" }, 404);
    const result = await parseVoice(body.data.text, vendor.catalog, deps.voiceEnv ?? {});
    return c.json(result);
  });

  // Firefox has no SpeechRecognition: the page records a clip and the server transcribes it.
  app.post(TRANSCRIBE_PATH, async (c) => {
    const stt = deps.transcriber;
    if (!stt) return c.json({ error: "TRANSCRIBE_UNAVAILABLE" }, 503);
    const mime = c.req.header("Content-Type") ?? "";
    if (!mime.startsWith("audio/")) return c.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
    const audio = new Uint8Array(await c.req.arrayBuffer());
    if (audio.byteLength === 0) return c.json({ error: "INVALID_BODY" }, 400);
    const lang = c.req.query("lang") === "en" ? "en" : "es";
    try {
      const text = await stt.transcribe(audio, mime, lang);
      return c.json({ text, source: stt.mode });
    } catch (err) {
      console.error(`stt failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`);
      return c.json({ error: "TRANSCRIBE_FAILED" }, 502);
    }
  });

  app.post("/api/mock/orders/:orderId/approve", async (c) => {
    if (!(paypal instanceof MockPayPal)) return c.json({ error: "NOT_FOUND" }, 404);
    const id = orderId.safeParse(c.req.param("orderId"));
    const body = approveBody.safeParse((await readJson(c)) ?? {});
    if (!id.success || !body.success) return c.json({ error: "INVALID_BODY" }, 400);
    const order = paypal.approve(id.data, { declineOnCapture: body.data.decline ?? false });
    return c.json({ order });
  });

  app.post("/webhooks/paypal", async (c) => {
    const raw = await c.req.text();
    const h = {
      authAlgo: c.req.header("paypal-auth-algo"),
      certUrl: c.req.header("paypal-cert-url"),
      transmissionId: c.req.header("paypal-transmission-id"),
      transmissionSig: c.req.header("paypal-transmission-sig"),
      transmissionTime: c.req.header("paypal-transmission-time"),
    };
    if (
      !h.authAlgo ||
      !h.certUrl ||
      !h.transmissionId ||
      !h.transmissionSig ||
      !h.transmissionTime
    ) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400);
    }
    const headers = { ...h } as Record<keyof typeof h, string>;
    let valid = false;
    try {
      valid = await paypal.verifyWebhook(headers, raw);
    } catch (err) {
      if (err instanceof PayPalError) return c.json({ error: "VERIFY_UNAVAILABLE" }, 503);
      throw err;
    }
    if (!valid) return c.json({ error: "INVALID_SIGNATURE" }, 400);
    const event = webhookBody.safeParse(JSON.parse(raw));
    if (!event.success) return c.json({ error: "INVALID_BODY" }, 400);
    try {
      // Payout batch/item events update payouts to suppliers; everything else is about sales.
      if (event.data.event_type.startsWith("PAYMENT.PAYOUTS")) {
        for (const s of stalls.values()) if (s.office.payouts.handleWebhook(event.data)) break;
      } else await sales.handleWebhook(event.data);
    } catch (err) {
      console.error(`webhook ${event.data.event_type} failed: ${(err as Error).message}`);
    }
    return c.json({ ok: true });
  });

  app.get("/t/:terminal", (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const lang = pickLang(c.req.header("accept-language"));
    const msg = PAGE_TEXT[lang];
    const id = terminalId.safeParse(c.req.param("terminal"));
    const terminal = id.success ? sales.store.getTerminal(id.data) : undefined;
    if (!terminal) return c.html(page(lang, msg.notFoundTitle, msg.notFound), 404);
    const open = sales.openSale(terminal.id);
    if (open) return c.redirect(`/pay/${open.id}`, 302);
    const vendor = sales.store.getVendor(terminal.vendorId);
    const title = vendor?.displayName ?? terminal.label;
    const last = sales.store.salesForTerminal(terminal.id)[0];
    if (last?.status === "paid" || last?.status === "refunded")
      return c.html(page(lang, title, msg.paid));
    if (last?.status === "expired" || last?.status === "failed")
      return c.html(page(lang, title, msg.gone));
    return c.html(page(lang, title, msg.none));
  });

  const signer = deps.passportSigner ?? PassportSigner.ephemeral();
  app.get("/api/passport/public-key", (c) =>
    c.json({
      keyId: signer.keyId,
      algorithm: "Ed25519",
      publicKey: Buffer.from(signer.publicKeyRaw).toString("base64url"),
      pem: signer.publicKeyPem,
      demo: signer.demo,
    }),
  );
  // Fallback for browsers without WebCrypto Ed25519; stateless, nothing is logged or stored.
  app.post("/api/passport/verify", async (c) => {
    const body = passportVerifyBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "INVALID_BODY" }, 400);
    if (body.data.keyId !== signer.keyId) return c.json({ valid: false, reason: "UNKNOWN_KEY" });
    const valid = await verifyPassport(
      { report: body.data.report as never, signature: body.data.signature },
      signer.publicKeyRaw,
    ).catch(() => false);
    return c.json({ valid });
  });

  // Every stall's back office at /api/stalls/:id/backoffice; /api/backoffice stays the main stall.
  for (const s of stalls.values()) {
    const routes = backofficeRoutes({
      office: s.office,
      model: deps.agentModel,
      paypalTools: deps.paypalTools,
      clock: deps.clock,
      store: s.store,
      vendorId: s.id,
      vision: deps.menuVision,
      passport: signer,
      publicUrl: deps.publicUrl,
      sessions: s.sessions,
      approvals: s.approvals,
    });
    app.route(`/api/stalls/${s.id}/backoffice`, routes);
    if (s === main) app.route("/api/backoffice", routes);
  }
  const owner = ownerRoutes({ store: sales.store, stalls, clock: deps.clock });
  app.route("/api/stalls", owner.stalls);
  app.route("/api/owner", owner.owner);
  app.use("/mcp", limit);
  app.route(
    "/mcp",
    mcpRoutes({ store: sales.store, stalls, sales, publicUrl: deps.publicUrl, clock: deps.clock }),
  );

  app.all("/api/*", (c) => c.json({ error: "NOT_FOUND" }, 404));

  // Apple Pay domain registration (PayPal dashboard) fetches this file; absent -> 404.
  app.get("/.well-known/apple-developer-merchantid-domain-association", (c) => {
    const body = deps.applePayDomainAssociation;
    if (!body) return c.text("not found", 404);
    return c.text(body, 200, { "Cache-Control": "public, max-age=3600" });
  });

  if (deps.staticRoot) {
    const root = deps.staticRoot;
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}

function base(c: Context, deps: AppDeps): string {
  return (deps.publicUrl ?? new URL(c.req.url).origin).replace(/\/+$/, "");
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

const PAGE_TEXT: Record<
  Lang,
  Record<"notFoundTitle" | "notFound" | "paid" | "gone" | "none", string>
> = {
  en: {
    notFoundTitle: "Stall not found",
    notFound: "This code does not belong to any stall.",
    paid: "Your last payment was recorded. Thanks for your purchase!",
    gone: "The last charge is no longer available. Ask the vendor for a new charge and scan again.",
    none: "There is no open sale right now. Ask the vendor to ring it up and scan again.",
  },
  es: {
    notFoundTitle: "Puesto no encontrado",
    notFound: "Este código no corresponde a ningún puesto.",
    paid: "Tu último pago ya quedó registrado. ¡Gracias por tu compra!",
    gone: "El último cobro ya no está disponible. Pide a la vendedora que marque un cobro nuevo y vuelve a escanear.",
    none: "No hay una venta abierta en este momento. Pide a la vendedora que marque el cobro y vuelve a escanear.",
  },
};

function page(lang: Lang, title: string, message: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html lang="${lang === "es" ? "es-MX" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#fffaf2;color:#1f1a14;display:flex;min-height:100vh;box-sizing:border-box;align-items:center;justify-content:center;text-align:center}main{max-width:28rem}h1{font-size:1.6rem}p{font-size:1.2rem;line-height:1.5}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}
