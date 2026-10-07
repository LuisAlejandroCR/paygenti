// server/index.ts: process entry point — reads env, picks the PayPal gateway and starts the server.
// Without PayPal keys it runs against the in-memory mock; serves dist/web when it has been built.
// Every third party goes through Integrations.plug(): a missing or broken one never stops the boot.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { buildRailRegistry } from "../shared/rails";
import { createApp } from "./app";
import { AnthropicClient } from "./backoffice/agent";
import { createPayPalTools } from "./backoffice/paypal-tools";
import { AnthropicVisionClient } from "./catalog/extract";
import { PostgresStore } from "./db/postgres";
import { pgClient } from "./db/sql";
import { Integrations } from "./integrations";
import { parseStallPins } from "./owner/stalls";
import { PassportSigner } from "./passport";
import { createGateway } from "./paypal";
import { MockPayPal } from "./paypal/mock";
import { SalesService } from "./sales";
import { MemoryStore, type Store } from "./store";
import { createTranscriber } from "./voice/transcribe";

const port = Number(process.env.PORT ?? 8787);
const webRoot = resolve(import.meta.dirname, "../dist/web");
const integrations = new Integrations();
const paypal = await integrations.plug(
  "paypal",
  () => createGateway(process.env),
  new MockPayPal(),
);
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const vendorPin = process.env.VENDOR_PIN?.trim();
if (!vendorPin) console.warn("VENDOR_PIN not set: using the demo PIN 1234");
const passportSigner = await integrations.plug(
  "passport",
  () =>
    process.env.PASSPORT_SIGNING_KEY?.trim()
      ? PassportSigner.fromEnv(process.env.PASSPORT_SIGNING_KEY)
      : undefined,
  PassportSigner.ephemeral(),
);
if (passportSigner.demo)
  console.warn(
    "PASSPORT_SIGNING_KEY not set or invalid: sales passports use an ephemeral demo key",
  );
const databaseUrl = process.env.DATABASE_URL?.trim();
const store: Store = await integrations.plug(
  "database",
  () => (databaseUrl ? PostgresStore.open(pgClient(databaseUrl)) : undefined),
  new MemoryStore(),
);
if (!(store instanceof PostgresStore))
  console.warn("Postgres not in use: sales, catalog and audit live in memory only");
const agentModel = await integrations.optional("claude", () =>
  anthropicKey ? new AnthropicClient(anthropicKey) : undefined,
);
const menuVision = await integrations.optional("claude-vision", () =>
  anthropicKey ? new AnthropicVisionClient(anthropicKey) : undefined,
);
const transcriber = await integrations.optional("speech-to-text", () =>
  createTranscriber(process.env),
);
const paypalTools = await integrations.optional("paypal-agent-toolkit", () =>
  createPayPalTools(process.env),
);
const stallPins = parseStallPins(process.env.STALL_PINS);
for (const v of store.vendors())
  if (v.id !== "rosa" && !stallPins[v.id])
    console.warn(`STALL_PINS has no PIN for stall "${v.id}": using its demo PIN`);
const app = createApp({
  stallPins,
  sales: new SalesService({ store, paypal }),
  passportSigner,
  vendorPin: vendorPin || undefined,
  agentModel,
  paypalTools,
  menuVision,
  integrations: integrations.status,
  paypal,
  // Pix / SPEI / Bre-B / wallets: each shows up only when its env config is present.
  rails: buildRailRegistry(process.env),
  // Render sets RENDER_EXTERNAL_URL (https); the request origin behind its proxy is http.
  publicUrl: process.env.PUBLIC_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || undefined,
  voiceEnv: process.env,
  transcriber,
  staticRoot: existsSync(webRoot) ? webRoot : undefined,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paygent listening on http://localhost:${info.port} (paypal: ${paypal.mode})`);
});

// Render stops (or sleeps) the service with SIGTERM: let queued Postgres writes land first.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    const done = store instanceof PostgresStore ? store.close() : Promise.resolve();
    done.finally(() => process.exit(0));
  });
