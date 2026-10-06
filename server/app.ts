// server/app.ts: builds the Hono app from its dependencies so tests can drive it with app.request.
// Routes are mounted here; server/index.ts only wires env and starts listening.
import { Hono } from "hono";
import type { PayPalGateway } from "./paypal/gateway";

export interface AppDeps {
  paypal: PayPalGateway;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true, paypal: deps.paypal.mode }));
  return app;
}
