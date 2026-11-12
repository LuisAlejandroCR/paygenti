// test/passkey.test.ts: Face ID / fingerprint unlock (WebAuthn passkeys) against a software authenticator.
// Enrolling needs the PIN's device token; a valid assertion earns the same token shape as the PIN path,
// while a wrong origin or RP ID, an unknown credential, a replayed challenge or a locked client never do.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { PostgresStore } from "../server/db/postgres";
import { DeviceTokens } from "../server/device-token";
import { relyingParty } from "../server/passkey";
import { MockPayPal } from "../server/paypal/mock";
import { newPglite, pgliteClient } from "./pglite";

const ORIGIN = "https://paygent.test";
const json = { "Content-Type": "application/json" };
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

/** A platform authenticator in software: one P-256 key, user verified, attestation "none". */
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credId = randomBytes(16);
  let count = 0;
  const flags = (attested: boolean) => 0x01 | 0x04 | (attested ? 0x40 : 0);
  const authData = (rpId: string, attested: boolean) => {
    const head = Buffer.concat([
      sha256(rpId),
      Buffer.from([flags(attested)]),
      Buffer.from([0, 0, 0, ++count]),
    ]);
    if (!attested) return head;
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x as string, "base64url")],
        [-3, Buffer.from(jwk.y as string, "base64url")],
      ]),
    );
    const len = Buffer.alloc(2);
    len.writeUInt16BE(credId.length);
    return Buffer.concat([head, Buffer.alloc(16), len, credId, cose]);
  };
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id: b64u(credId),
    create(challenge: string, o: { origin?: string; rpId?: string } = {}) {
      const attestationObject = isoCBOR.encode(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData(o.rpId ?? "paygent.test", true)],
        ]) as never,
      );
      return {
        id: b64u(credId),
        rawId: b64u(credId),
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: b64u(clientData("webauthn.create", challenge, o.origin ?? ORIGIN)),
          attestationObject: b64u(attestationObject),
          transports: ["internal"],
        },
      };
    },
    get(challenge: string, o: { origin?: string; rpId?: string; id?: string } = {}) {
      const ad = authData(o.rpId ?? "paygent.test", false);
      const cd = clientData("webauthn.get", challenge, o.origin ?? ORIGIN);
      const signature = sign("sha256", Buffer.concat([ad, sha256(cd)]), privateKey);
      const id = o.id ?? b64u(credId);
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: b64u(cd),
          authenticatorData: b64u(ad),
          signature: b64u(signature),
        },
      };
    },
  };
}

function setup() {
  const deviceTokens = new DeviceTokens({ secret: "x".repeat(32) });
  const app = createApp({
    paypal: new MockPayPal(),
    vendorPin: "4321",
    deviceTokens,
    publicUrl: ORIGIN,
  });
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { ...json, ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  const pinToken = async () =>
    (await post("/api/terminals/rosa-01/unlock", { pin: "4321" })).data.token as string;
  /** PIN unlock, then enrol a fresh authenticator on rosa-01. */
  const enrol = async () => {
    const key = authenticator();
    const token = await pinToken();
    const opts = await post("/api/terminals/rosa-01/passkey/register/options", {}, token);
    const reg = await post(
      "/api/terminals/rosa-01/passkey/register",
      { response: key.create(opts.data.challenge as string) },
      token,
    );
    return { key, token, opts, reg };
  };
  const challenge = async (terminal = "rosa-01") =>
    (await post(`/api/terminals/${terminal}/passkey/options`, {})).data.challenge as string;
  return { app, post, pinToken, enrol, challenge };
}

describe("passkey unlock", () => {
  it("asks the PIN's device token to enrol", async () => {
    const { post } = setup();
    const res = await post("/api/terminals/rosa-01/passkey/register/options", {});
    expect(res.status).toBe(401);
    expect(res.data.error).toBe("CHARGE_AUTH_REQUIRED");
  });

  it("registers a platform passkey bound to the deployed host", async () => {
    const { enrol } = setup();
    const { opts, reg } = await enrol();
    expect(opts.status).toBe(200);
    expect(opts.data.rp).toEqual({ name: "Paygent", id: "paygent.test" });
    expect(opts.data.authenticatorSelection).toMatchObject({
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    });
    expect(reg).toEqual({ status: 200, data: { ok: true } });
  });

  it("an assertion earns the same token shape as the PIN, and that token charges", async () => {
    const { enrol, post, challenge, pinToken } = setup();
    const { key } = await enrol();
    const res = await post("/api/terminals/rosa-01/passkey/unlock", {
      response: key.get(await challenge()),
    });
    expect(res.status).toBe(200);
    const pin = await post("/api/terminals/rosa-01/unlock", { pin: "4321" });
    expect(Object.keys(res.data).sort()).toEqual(Object.keys(pin.data).sort());
    expect(res.data.token).toMatch(/^pgd\.rosa\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(res.data.expiresInMs).toBe(pin.data.expiresInMs);
    const sale = await post(
      "/api/terminals/rosa-01/sales",
      { amount: 9500 },
      res.data.token as string,
    );
    expect(sale.status).toBe(201);
    expect(typeof (await pinToken())).toBe("string");
  });

  it("refuses a wrong origin or RP ID at registration", async () => {
    const { post, pinToken } = setup();
    const token = await pinToken();
    for (const o of [{ origin: "https://evil.test" }, { rpId: "evil.test" }]) {
      const opts = await post("/api/terminals/rosa-01/passkey/register/options", {}, token);
      const reg = await post(
        "/api/terminals/rosa-01/passkey/register",
        { response: authenticator().create(opts.data.challenge as string, o) },
        token,
      );
      expect(reg).toEqual({ status: 401, data: { error: "PASSKEY_FAILED" } });
    }
  });

  it("refuses a wrong origin, a wrong RP ID, an unknown credential and a replay", async () => {
    const { enrol, post, challenge } = setup();
    const { key } = await enrol();
    const unlock = (response: unknown) =>
      post("/api/terminals/rosa-01/passkey/unlock", { response });
    expect((await unlock(key.get(await challenge(), { origin: "https://evil.test" }))).status).toBe(
      401,
    );
    expect((await unlock(key.get(await challenge(), { rpId: "evil.test" }))).status).toBe(401);
    expect((await unlock(authenticator().get(await challenge()))).data).toEqual({
      error: "PASSKEY_FAILED",
    });
    const c = await challenge();
    expect((await unlock(key.get(c))).status).toBe(200);
    expect((await unlock(key.get(c))).status).toBe(401);
  });

  it("a rosa passkey never unlocks another stall's terminal", async () => {
    const { enrol, post, challenge } = setup();
    const { key } = await enrol();
    expect((await post("/api/terminals/beto-01/passkey/options", {})).status).toBe(404);
    const res = await post("/api/terminals/beto-01/passkey/unlock", {
      response: key.get(await challenge()),
    });
    expect(res.status).toBe(401);
    expect(res.data.token).toBeUndefined();
  });

  it("locks a client after 5 failures, even with a valid passkey", async () => {
    const { enrol, post } = setup();
    const { key } = await enrol();
    const stranger = authenticator();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (await post("/api/terminals/rosa-01/passkey/unlock", { response: stranger.get("x") }))
          .status,
      );
    expect(codes).toEqual([401, 401, 401, 401, 429]);
    expect((await post("/api/terminals/rosa-01/passkey/options", {})).status).toBe(429);
    const res = await post("/api/terminals/rosa-01/passkey/unlock", { response: key.get("y") });
    expect(res).toEqual({ status: 429, data: { error: "PASSKEY_LOCKED" } });
  });

  it("a client locked by the PIN is locked for passkeys too", async () => {
    const { enrol, post, challenge } = setup();
    const { key } = await enrol();
    const c = await challenge();
    for (let i = 0; i < 5; i++) await post("/api/terminals/rosa-01/unlock", { pin: "0000" });
    const res = await post("/api/terminals/rosa-01/passkey/unlock", { response: key.get(c) });
    expect(res.status).toBe(429);
  });

  it("without passkeys the options say PASSKEY_NONE", async () => {
    const { post } = setup();
    expect(await post("/api/terminals/rosa-01/passkey/options", {})).toEqual({
      status: 404,
      data: { error: "PASSKEY_NONE" },
    });
  });
});

describe("relyingParty", () => {
  it("binds to the public host; localhost accepts any local port", () => {
    expect(relyingParty("https://paygent-rirl.onrender.com", "https://evil.test")).toEqual({
      rpID: "paygent-rirl.onrender.com",
      origins: ["https://paygent-rirl.onrender.com"],
    });
    expect(relyingParty("http://localhost:8787", "http://localhost:5173")).toEqual({
      rpID: "localhost",
      origins: ["http://localhost:8787", "http://localhost:5173"],
    });
  });

  it("binds to an allowed front-end origin (PASSKEY_ORIGINS), only when the request comes from it", () => {
    const allowed = ["https://paygenti.vercel.app"];
    expect(
      relyingParty("https://paygent-rirl.onrender.com", "https://paygenti.vercel.app", allowed),
    ).toEqual({ rpID: "paygenti.vercel.app", origins: ["https://paygenti.vercel.app"] });
    expect(relyingParty("https://paygent-rirl.onrender.com", "https://evil.test", allowed)).toEqual(
      {
        rpID: "paygent-rirl.onrender.com",
        origins: ["https://paygent-rirl.onrender.com"],
      },
    );
  });
});

describe("passkey persistence", () => {
  it("keeps the public key and the counter across a restart (Postgres)", async () => {
    const db = newPglite();
    const a = await PostgresStore.open(pgliteClient(db));
    const p = {
      id: "cred-1",
      terminalId: "rosa-01",
      vendorId: "rosa",
      publicKey: "pk",
      counter: 1,
      transports: ["internal"],
      createdAt: "2026-11-12T00:00:00.000Z",
    };
    a.savePasskey(p);
    a.savePasskey({ ...p, counter: 7 });
    await a.flush();
    expect(a.writeErrors).toBe(0);
    const b = await PostgresStore.open(pgliteClient(db));
    expect(b.passkeys("rosa-01")).toEqual([{ ...p, counter: 7 }]);
    expect(b.passkeys("beto-01")).toEqual([]);
  }, 30_000); // PGlite boots and migrates twice; slow when the whole suite runs in parallel
});
