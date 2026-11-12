// test/terminal-voice.test.ts: POST /api/terminals/:id/voice, the voice box endpoint — audio (WAV
// from the ESP32) or text (virtual box) becomes a charge on that terminal: a spoken amount, catalog
// lines, or "unknown" when nothing is chargeable; a charge carries the amount in words for the speaker. Uses the mock transcriber and MockPayPal.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { createTranscriber } from "../server/voice/transcribe";
import type { Sale } from "../shared/types";

type VoiceReply = { intent: string; lang: string; text: string; sale?: Sale; spoken?: string };

const wav = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
const appWith = (transcript?: string) =>
  createApp({
    paypal: new MockPayPal(),
    ...(transcript && { transcriber: createTranscriber({ STT_MOCK_TRANSCRIPT: transcript }) }),
  });
const postText = (app: ReturnType<typeof createApp>, text: string, terminal = "rosa-01") =>
  app.request(`/api/terminals/${terminal}/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
const postWav = (app: ReturnType<typeof createApp>) =>
  app.request("/api/terminals/rosa-01/voice?lang=es", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });

describe("POST /api/terminals/:id/voice", () => {
  it("charges a spoken amount in the stall currency", async () => {
    const res = await postText(appWith(), "cóbrame 40 pesos de unos tacos");
    expect(res.status).toBe(201);
    const data = (await res.json()) as VoiceReply;
    expect(data.intent).toBe("charge");
    expect(data.text).toBe("cóbrame 40 pesos de unos tacos");
    expect(data.sale?.total).toEqual({ minor: 4000, currency: "MXN" });
    expect(data.sale?.terminalId).toBe("rosa-01");
    expect(data.spoken).toBe("cuarenta pesos");
  });

  it("charges catalog lines when no amount is said", async () => {
    const res = await postText(appWith(), "dos de rajas y un atole");
    expect(res.status).toBe(201);
    const data = (await res.json()) as VoiceReply;
    expect(data.intent).toBe("charge");
    expect(data.sale?.lines.map((l) => [l.sku, l.qty])).toEqual([
      ["tamal-rajas", 2],
      ["atole", 1],
    ]);
  });

  it("transcribes a WAV clip and charges it", async () => {
    const res = await postWav(appWith("cóbrame 25 pesos"));
    expect(res.status).toBe(201);
    const data = (await res.json()) as VoiceReply;
    expect(data).toMatchObject({ intent: "charge", lang: "es", text: "cóbrame 25 pesos" });
    expect(data.sale?.total.minor).toBe(2500);
    expect(data.spoken).toBe("veinticinco pesos");
  });

  it("says the amount in English words when the box speaks English", async () => {
    const res = await appWith().request("/api/terminals/rosa-01/voice?lang=en", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "charge 85.50" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as VoiceReply;
    expect(data).toMatchObject({ intent: "charge", lang: "en" });
    expect(data.spoken).toBe("eighty five pesos and fifty cents");
  });

  it("answers unknown without creating a sale when nothing is chargeable", async () => {
    const app = appWith();
    const res = await postText(app, "hola buenos días");
    expect(res.status).toBe(200);
    const data = (await res.json()) as VoiceReply;
    expect(data.intent).toBe("unknown");
    expect(data.sale).toBeUndefined();
    expect(data.spoken).toBeUndefined();
    const term = (await (await app.request("/api/terminals/rosa-01")).json()) as {
      openSale: Sale | null;
    };
    expect(term.openSale).toBeNull();
  });

  it("rejects audio without a transcriber, bad bodies and unknown terminals", async () => {
    expect((await postWav(appWith())).status).toBe(503);
    expect((await postText(appWith(), "")).status).toBe(400);
    expect((await postText(appWith(), "40 pesos", "nadie")).status).toBe(404);
    const plain = await appWith().request("/api/terminals/rosa-01/voice", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "40",
    });
    expect(plain.status).toBe(415);
  });
});
