// server/voice/transcribe.ts: speech-to-text for browsers without SpeechRecognition (Firefox).
// STT_API_KEY -> any Whisper-compatible endpoint (STT_URL, STT_MODEL; OpenAI by default);
// STT_MOCK_TRANSCRIPT -> a fixed transcript for demos and e2e; neither -> off (route answers 503).

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const DEFAULT_URL = "https://api.openai.com/v1/audio/transcriptions";

export interface Transcriber {
  mode: "http" | "mock";
  transcribe(audio: Uint8Array<ArrayBuffer>, mime: string, lang: string): Promise<string>;
}

export interface TranscribeEnv {
  STT_API_KEY?: string;
  STT_URL?: string;
  STT_MODEL?: string;
  STT_MOCK_TRANSCRIPT?: string;
}

function extension(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

export function createTranscriber(
  env: TranscribeEnv,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Transcriber | undefined {
  const key = env.STT_API_KEY?.trim();
  if (key) {
    const url = env.STT_URL?.trim() || DEFAULT_URL;
    const model = env.STT_MODEL?.trim() || "whisper-1";
    return {
      mode: "http",
      async transcribe(audio, mime, lang) {
        const form = new FormData();
        const type = mime.split(";")[0] ?? "audio/webm";
        form.append("file", new Blob([audio], { type }), `clip.${extension(mime)}`);
        form.append("model", model);
        form.append("language", lang);
        const res = await fetchFn(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`stt HTTP ${res.status}`);
        const data = (await res.json()) as { text?: unknown };
        return typeof data.text === "string" ? data.text.trim() : "";
      },
    };
  }
  const fixed = env.STT_MOCK_TRANSCRIPT?.trim();
  if (fixed) return { mode: "mock", transcribe: async () => fixed };
  return undefined;
}
