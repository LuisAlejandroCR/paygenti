// server/index.ts: process entry point — reads env, picks the PayPal gateway and starts the server.
// Without PayPal keys it runs against the in-memory mock; serves dist/web when it has been built.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createGateway } from "./paypal";

const port = Number(process.env.PORT ?? 8787);
const webRoot = resolve(import.meta.dirname, "../dist/web");
const paypal = createGateway(process.env);
const app = createApp({
  paypal,
  publicUrl: process.env.PUBLIC_URL?.trim() || undefined,
  staticRoot: existsSync(webRoot) ? webRoot : undefined,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paygent listening on http://localhost:${info.port} (paypal: ${paypal.mode})`);
});
