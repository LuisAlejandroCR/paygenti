// test/voice-transcribe.test.ts: speech-to-text fallback for browsers without SpeechRecognition
// (Firefox) — transcriber selection from env, the Whisper-compatible client, and the HTTP route.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { createTranscriber, MAX_AUDIO_BYTES } from "../server/voice/transcribe";

const audio = new Uint8Array([1, 2, 3, 4]);

describe("createTranscriber", () => {
  it("is off without config, mock with STT_MOCK_TRANSCRIPT, http with STT_API_KEY", () => {
    expect(createTranscriber({})).toBeUndefined();
    expect(createTranscriber({ STT_MOCK_TRANSCRIPT: "  " })).toBeUndefined();
    expect(createTranscriber({ STT_MOCK_TRANSCRIPT: "un atole" })?.mode).toBe("mock");
    expect(createTranscriber({ STT_API_KEY: "k", STT_MOCK_TRANSCRIPT: "x" })?.mode).toBe("http");
  });

  it("mock returns the same transcript every time", async () => {
    const t = createTranscriber({ STT_MOCK_TRANSCRIPT: "dos de mole" });
    expect(await t?.transcribe(audio, "audio/webm", "es")).toBe("dos de mole");
    expect(await t?.transcribe(audio, "audio/ogg", "en")).toBe("dos de mole");
  });

  it("http posts multipart audio to the Whisper-compatible endpoint", async () => {
    let seen: { url: string; auth: string | null; form: FormData } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        auth: new Headers(init.headers).get("Authorization"),
        form: init.body as FormData,
      };
      return new Response(JSON.stringify({ text: " dos de mole " }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = createTranscriber(
      { STT_API_KEY: "sk-test", STT_URL: "https://stt.test/v1" },
      fetchFn,
    );
    expect(await t?.transcribe(audio, "audio/ogg;codecs=opus", "es")).toBe("dos de mole");
    expect(seen?.url).toBe("https://stt.test/v1");
    expect(seen?.auth).toBe("Bearer sk-test");
    expect(seen?.form.get("model")).toBe("whisper-1");
    expect(seen?.form.get("language")).toBe("es");
    expect((seen?.form.get("file") as File).name).toBe("clip.ogg");
  });

  it("http throws on a non-2xx answer", async () => {
    const fetchFn = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const t = createTranscriber({ STT_API_KEY: "k" }, fetchFn);
    await expect(t?.transcribe(audio, "audio/webm", "en")).rejects.toThrow();
  });
});

const post = (app: ReturnType<typeof createApp>, body: BodyInit, type = "audio/webm") =>
  app.request("/api/voice/transcribe?lang=es", {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });

describe("POST /api/voice/transcribe", () => {
  it("says TRANSCRIBE_UNAVAILABLE (503) when no transcriber is configured", async () => {
    const app = createApp({ paypal: new MockPayPal() });
    const res = await post(app, audio);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "TRANSCRIBE_UNAVAILABLE" });
    const cfg = (await (await app.request("/api/config")).json()) as { transcribe: boolean };
    expect(cfg.transcribe).toBe(false);
  });

  it("returns the mock transcript and advertises it in /api/config", async () => {
    const app = createApp({
      paypal: new MockPayPal(),
      transcriber: createTranscriber({ STT_MOCK_TRANSCRIPT: "dos de mole y uno de rajas" }),
    });
    const res = await post(app, audio);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "dos de mole y uno de rajas", source: "mock" });
    const cfg = (await (await app.request("/api/config")).json()) as { transcribe: boolean };
    expect(cfg.transcribe).toBe(true);
  });

  it("rejects non-audio, empty and oversized bodies", async () => {
    const app = createApp({
      paypal: new MockPayPal(),
      transcriber: createTranscriber({ STT_MOCK_TRANSCRIPT: "x" }),
    });
    expect((await post(app, audio, "application/json")).status).toBe(415);
    expect((await post(app, new Uint8Array())).status).toBe(400);
    expect((await post(app, new Uint8Array(MAX_AUDIO_BYTES + 1))).status).toBe(413);
  });

  it("answers 502 TRANSCRIBE_FAILED when the provider fails", async () => {
    const app = createApp({
      paypal: new MockPayPal(),
      transcriber: { mode: "http", transcribe: () => Promise.reject(new Error("down")) },
    });
    const res = await post(app, audio);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "TRANSCRIBE_FAILED" });
  });
});
