// server/index.ts: process entry point — reads env, picks the PayPal gateway and starts the server.
// Without PayPal keys it runs against the in-memory mock; serves dist/web when it has been built.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { AnthropicClient } from "./backoffice/agent";
import { createPayPalTools } from "./backoffice/paypal-tools";
import { AnthropicVisionClient } from "./catalog/extract";
import { PassportSigner } from "./passport";
import { createGateway } from "./paypal";

const port = Number(process.env.PORT ?? 8787);
const webRoot = resolve(import.meta.dirname, "../dist/web");
const paypal = createGateway(process.env);
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const vendorPin = process.env.VENDOR_PIN?.trim();
if (!vendorPin) console.warn("VENDOR_PIN not set: using the demo PIN 1234");
const passportSigner = PassportSigner.fromEnv(process.env.PASSPORT_SIGNING_KEY);
if (passportSigner.demo)
  console.warn("PASSPORT_SIGNING_KEY not set: sales passports use an ephemeral demo key");
const app = createApp({
  passportSigner,
  vendorPin: vendorPin || undefined,
  agentModel: anthropicKey ? new AnthropicClient(anthropicKey) : undefined,
  paypalTools: createPayPalTools(process.env),
  menuVision: anthropicKey ? new AnthropicVisionClient(anthropicKey) : undefined,
  paypal,
  // Render sets RENDER_EXTERNAL_URL (https); the request origin behind its proxy is http.
  publicUrl: process.env.PUBLIC_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || undefined,
  voiceEnv: process.env,
  staticRoot: existsSync(webRoot) ? webRoot : undefined,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paygent listening on http://localhost:${info.port} (paypal: ${paypal.mode})`);
});
