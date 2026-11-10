// test/cors.test.ts: CORS_ORIGINS lets only the listed origins (the deployed dashboard) call /api/*
// from a browser; without it the API sends no CORS headers at all.
import { describe, expect, it } from "vitest";
import { createApp, parseCorsOrigins } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";

const DASH = "https://dash.paygent.example";

describe("CORS", () => {
  it("parses exact origins and drops junk", () => {
    expect(parseCorsOrigins(` ${DASH}/, http://localhost:3000, *, javascript:x, `)).toEqual([
      DASH,
      "http://localhost:3000",
    ]);
    expect(parseCorsOrigins(undefined)).toEqual([]);
  });

  it("allows a listed origin, including the preflight with Authorization", async () => {
    const app = createApp({ paypal: new MockPayPal(), corsOrigins: [DASH] });
    const pre = await app.request("/api/stalls", {
      method: "OPTIONS",
      headers: {
        Origin: DASH,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(pre.headers.get("access-control-allow-origin")).toBe(DASH);
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
    const res = await app.request("/api/stalls", { headers: { Origin: DASH } });
    expect(res.headers.get("access-control-allow-origin")).toBe(DASH);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("ignores other origins, and sends nothing when unset", async () => {
    const listed = createApp({ paypal: new MockPayPal(), corsOrigins: [DASH] });
    const evil = await listed.request("/api/stalls", {
      headers: { Origin: "https://evil.example" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const plain = createApp({ paypal: new MockPayPal() });
    const res = await plain.request("/api/stalls", { headers: { Origin: DASH } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
