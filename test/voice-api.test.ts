// test/voice-api.test.ts: POST /api/voice/parse over HTTP with the rules parser (no API key) —
// returns catalog-validated cart lines and rejects bad bodies and unknown vendors.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import type { CartLine } from "../shared/types";

const app = createApp({ paypal: new MockPayPal() });
const post = (body: unknown) =>
  app.request("/api/voice/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/voice/parse", () => {
  it("turns a spoken order into cart lines from the vendor catalog", async () => {
    const res = await post({ text: "dos de rajas y un atole", vendorId: "rosa" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { lines: CartLine[]; source: string };
    expect(data.source).toBe("rules");
    expect(data.lines.map((l) => [l.sku, l.qty])).toEqual([
      ["tamal-rajas", 2],
      ["atole", 1],
    ]);
  });

  it("rejects an empty body and an unknown vendor", async () => {
    expect((await post({ text: "", vendorId: "rosa" })).status).toBe(400);
    expect((await post({ text: "un atole", vendorId: "nadie" })).status).toBe(404);
  });
});
