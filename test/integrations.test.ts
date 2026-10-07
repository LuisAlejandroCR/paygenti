// test/integrations.test.ts: a broken or missing third party never stops the app from booting.
// Covers plug() modes and the health route reporting them.
import { expect, it } from "vitest";
import { createApp } from "../server/app";
import { Integrations } from "../server/integrations";
import { PassportSigner } from "../server/passport";
import { MockPayPal } from "../server/paypal/mock";

it("uses the built value when configured", async () => {
  const i = new Integrations();
  expect(await i.plug("db", () => "pg", "memory")).toBe("pg");
  expect(i.status.db).toEqual({ mode: "on" });
});

it("falls back when not configured", async () => {
  const i = new Integrations();
  expect(await i.plug("db", () => undefined, "memory")).toBe("memory");
  expect(i.status.db?.mode).toBe("off");
});

it("falls back instead of crashing when the third party throws or rejects", async () => {
  const i = new Integrations();
  const db = await i.plug("db", async () => Promise.reject(new Error("ECONNREFUSED")), "memory");
  const signer = await i.plug(
    "passport",
    () => PassportSigner.fromEnv("not-a-key"),
    PassportSigner.ephemeral(),
  );
  expect(db).toBe("memory");
  expect(signer.demo).toBe(true);
  expect(i.status.db).toEqual({ mode: "fallback", reason: "ECONNREFUSED" });
  expect(i.status.passport?.mode).toBe("fallback");
});

it("optional features are simply disabled on failure", async () => {
  const i = new Integrations();
  const agent = await i.optional("claude", () => {
    throw new Error("bad key");
  });
  expect(agent).toBeUndefined();
  expect(i.status.claude?.mode).toBe("fallback");
});

it("GET /api/health reports each integration's mode, never the reason", async () => {
  const integrations = { db: { mode: "fallback" as const, reason: "ECONNREFUSED" } };
  const res = await createApp({ paypal: new MockPayPal(), integrations }).request("/api/health");
  expect(await res.json()).toEqual({
    ok: true,
    paypal: "mock",
    integrations: { db: "fallback" },
  });
});
