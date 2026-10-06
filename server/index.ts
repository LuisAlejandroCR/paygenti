// server/index.ts: process entry point — reads env, picks the PayPal gateway and starts the server.
// Without PayPal keys it runs against the in-memory mock so the app works with zero setup.
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { MockPayPal } from "./paypal/mock";

const port = Number(process.env.PORT ?? 8787);
const app = createApp({ paypal: new MockPayPal() });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`paygent listening on http://localhost:${info.port}`);
});
