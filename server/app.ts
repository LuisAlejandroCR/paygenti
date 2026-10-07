// server/app.ts: builds the Hono app from its dependencies so tests can drive it with app.request.
// Mounts the sales API, SSE, the sticker redirect /t/:terminal, the PayPal webhook, the mock-only
// approve route and (when built) the web app with SPA fallback. server/index.ts only wires env.
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import { z } from "zod";
import { verifyPassport } from "../shared/passport";
import type { ModelClient } from "./backoffice/agent";
import type { PayPalTools } from "./backoffice/paypal-tools";
import { backofficeRoutes } from "./backoffice/routes";
import { BackOffice } from "./backoffice/tools";
import type { VisionClient } from "./catalog/extract";
import { type Lang, pickLang } from "./lang";
import { PassportSigner } from "./passport";
import { PayPalError, type PayPalGateway } from "./paypal/gateway";
import { MockPayPal } from "./paypal/mock";
import { PolicyEngine } from "./policy";
import { type Clock, SaleError, SalesService } from "./sales";
import { MemoryStore } from "./store";
import { parseVoice, type VoiceEnv } from "./voice";

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
  /** Back-office lock; defaults to a PolicyEngine with vendorPin (demo "1234"). */
  policy?: PolicyEngine;
  vendorPin?: string;
  /** Claude client for /api/backoffice/agent; omitted when there is no ANTHROPIC_API_KEY. */
  agentModel?: ModelClient;
  /** PayPal Agent Toolkit tools for the agent; omitted without PayPal keys (mock mode). */
  paypalTools?: PayPalTools;
  /** Claude vision for menu photo -> catalog; omitted when there is no ANTHROPIC_API_KEY. */
  menuVision?: VisionClient;
  /** Sales passport signer; defaults to an ephemeral demo key. */
  passportSigner?: PassportSigner;
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

export function createApp(deps: AppDeps): Hono {
  const { paypal } = deps;
  const sales =
    deps.sales ?? new SalesService({ store: new MemoryStore(), paypal, clock: deps.clock });
  const app = new Hono();

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

  app.use("/api/*", (c, next) => (c.req.path === EXTRACT_PATH ? imageLimit : limit)(c, next));
  app.use("/webhooks/*", limit);

  app.get("/api/health", (c) => c.json({ ok: true, paypal: paypal.mode }));

  app.get("/api/config", (c) =>
    c.json({ paypal: paypal.mode, clientId: paypal.clientId ?? null, publicUrl: base(c, deps) }),
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
      await sales.handleWebhook(event.data);
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

  const policy =
    deps.policy ??
    new PolicyEngine({
      vendorName: sales.store.getVendor("rosa")?.displayName.split(" ")[0] ?? "la vendedora",
      pin: deps.vendorPin ?? "1234",
      now: deps.clock ? () => new Date(deps.clock?.() ?? Date.now()) : undefined,
      store: sales.store,
    });
  // The lock follows the vendor's charge currency (caps per currency; MXN keeps its defaults).
  const seeded = sales.store.getVendor("rosa");
  if (seeded && !deps.policy) policy.setCurrency(seeded.currency, seeded.timeZone);
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

  const office = new BackOffice({ sales, paypal, policy, clock: deps.clock });
  app.route(
    "/api/backoffice",
    backofficeRoutes({
      office,
      model: deps.agentModel,
      paypalTools: deps.paypalTools,
      clock: deps.clock,
      store: sales.store,
      vendorId: "rosa",
      vision: deps.menuVision,
      passport: signer,
      publicUrl: deps.publicUrl,
    }),
  );

  app.all("/api/*", (c) => c.json({ error: "NOT_FOUND" }, 404));

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
