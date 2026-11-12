// test/passport.test.ts: signed sales passport — canonical JSON, Ed25519 round trip, tamper
// detection, cash kept out of verified totals, refunds subtracted, and the HTTP routes end to end.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { buildPassport, type PassportSale, PassportSigner } from "../server/passport";
import { MockPayPal } from "../server/paypal/mock";
import {
  canonicalJson,
  decodePayload,
  encodePayload,
  fromBase64Url,
  type SignedPassport,
  verifyPassport,
} from "../shared/passport";

const base = {
  vendor: { id: "rosa", name: "Rosa" },
  currency: "MXN",
  timeZone: "America/Mexico_City",
  from: "2026-09-01",
  to: "2026-09-30",
  issuedAt: "2026-09-30T12:00:00.000Z",
  demoKey: true,
};
const sale = (p: Partial<PassportSale>): PassportSale => ({
  day: "2026-09-10",
  method: "paypal",
  captured: true,
  total: 5000,
  refunded: 0,
  ...p,
});

describe("canonicalJson", () => {
  it("sorts keys at every level and is stable under key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe("buildPassport", () => {
  it("counts only captured PayPal sales and subtracts refunds", () => {
    const r = buildPassport({
      ...base,
      sales: [
        sale({ total: 5000 }),
        sale({ total: 3000, refunded: 1000, day: "2026-09-11" }),
        sale({ captured: false, total: 9999 }),
        sale({ method: "cash", captured: false, total: 7000 }),
        sale({ day: "2026-08-31", total: 4000 }),
      ],
      cashDictated: 50000,
    });
    expect(r.verified).toMatchObject({
      count: 2,
      gross: 8000,
      refunds: 1000,
      net: 7000,
      daysActive: 2,
      averageTicket: 4000,
    });
    expect(r.verified.daily.map((d) => d.day)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(r.selfReported.cash).toBe(57000);
    expect(r.selfReported.label).toMatch(/self-reported/);
  });
});

describe("signature", () => {
  const signer = PassportSigner.ephemeral();
  const signed = signer.sign(buildPassport({ ...base, sales: [sale({})] }));

  it("round-trips through the link payload and verifies", async () => {
    const back = decodePayload(encodePayload(signed));
    expect(back).toEqual(signed);
    expect(await verifyPassport(back as SignedPassport, signer.publicKeyRaw)).toBe(true);
  });

  it("detects any tampered number", async () => {
    const t = structuredClone(signed);
    t.report.verified.net += 1;
    expect(await verifyPassport(t, signer.publicKeyRaw)).toBe(false);
    const c = structuredClone(signed);
    c.report.selfReported.cash = 1;
    expect(await verifyPassport(c, signer.publicKeyRaw)).toBe(false);
  });

  it("fails against another key", async () => {
    expect(await verifyPassport(signed, PassportSigner.ephemeral().publicKeyRaw)).toBe(false);
  });

  it("loads PASSPORT_SIGNING_KEY as PEM or base64 DER", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const der = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const a = PassportSigner.fromEnv(pem);
    const b = PassportSigner.fromEnv(der);
    expect(a.demo).toBe(false);
    expect(a.keyId).toBe(b.keyId);
    expect(PassportSigner.fromEnv("").demo).toBe(true);
  });
});

describe("routes", () => {
  it("issues a passport for a paid sale and verifies it publicly", async () => {
    const paypal = new MockPayPal();
    const app = createApp({ chargeAuth: "off", paypal, vendorPin: "4321" });
    const created = await app.request("/api/terminals/rosa-01/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 4200 }),
    });
    const { sale: s } = (await created.json()) as { sale: { id: string; orderId: string } };
    paypal.approve(s.orderId);
    await app.request(`/api/sales/${s.id}/capture`, { method: "POST" });

    expect((await app.request("/api/backoffice/passport", { method: "POST" })).status).toBe(401);
    const login = await app.request("/api/backoffice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "4321" }),
    });
    const { token } = (await login.json()) as { token: string };
    const res = await app.request("/api/backoffice/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cashMinor: 10000 }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as SignedPassport & { verifyUrl: string; qr: string };
    expect(out.report.verified).toMatchObject({ count: 1, net: 4200 });
    expect(out.report.selfReported.cash).toBe(10000);
    expect(out.report.demoKey).toBe(true);
    expect(JSON.stringify(out.report)).not.toMatch(/orderId|captureId|payer|email/i);
    expect(out.verifyUrl).toMatch(/\/verify#[A-Za-z0-9_-]+$/);
    expect(out.qr).toMatch(/^data:image\/png/);

    const key = (await (await app.request("/api/passport/public-key")).json()) as {
      keyId: string;
      publicKey: string;
    };
    expect(key.keyId).toBe(out.keyId);
    expect(await verifyPassport(out, fromBase64Url(key.publicKey))).toBe(true);

    const verify = async (body: unknown) => {
      const r = await app.request("/api/passport/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await r.json()) as { valid: boolean };
    };
    const { report, signature, keyId } = out;
    expect((await verify({ report, signature, keyId })).valid).toBe(true);
    const bad = structuredClone(report);
    bad.verified.gross = 999999;
    expect((await verify({ report: bad, signature, keyId })).valid).toBe(false);

    const range = await app.request("/api/backoffice/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ from: "2026-09-30", to: "2026-09-01" }),
    });
    expect(range.status).toBe(400);
  });
});

describe("verify link origin", () => {
  const issue = async (origin: string) => {
    const paypal = new MockPayPal();
    const app = createApp({
      chargeAuth: "off",
      paypal,
      vendorPin: "4321",
      publicUrl: "https://api.example",
      passkeyOrigins: ["https://front.example"],
    });
    const login = await app.request("/api/backoffice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "4321" }),
    });
    const { token } = (await login.json()) as { token: string };
    const res = await app.request("/api/backoffice/passport", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: origin,
      },
      body: JSON.stringify({}),
    });
    return ((await res.json()) as { verifyUrl: string }).verifyUrl;
  };

  it("points at the proxying front end when the request comes from an allowed origin", async () => {
    expect(await issue("https://front.example")).toMatch(/^https:\/\/front\.example\/verify#/);
  });

  it("ignores an origin that is not on the list", async () => {
    expect(await issue("https://evil.example")).toMatch(/^https:\/\/api\.example\/verify#/);
  });
});
