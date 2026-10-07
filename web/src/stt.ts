// web/src/stt.ts: picks how this browser turns speech into text — native Web Speech API
// (Chrome, Safari, Edge), or MediaRecorder + POST /api/voice/transcribe (Firefox), or none.
// Shared by the push-to-talk cart and the voice-first command button.
import { useEffect, useState } from "preact/hooks";

export type SpeechMode = "native" | "record" | "none";

export interface Capabilities {
  native: boolean;
  recorder: boolean;
  mic: boolean;
  server: boolean;
}

/** Native first; recording only when the browser can record and the server can transcribe. */
export function pickMode(c: Capabilities): SpeechMode {
  if (c.native) return "native";
  if (c.recorder && c.mic && c.server) return "record";
  return "none";
}

export function hasNativeSpeech(): boolean {
  const w = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

function canRecord(): { recorder: boolean; mic: boolean } {
  const g = globalThis as { MediaRecorder?: unknown; navigator?: Navigator };
  return {
    recorder: typeof g.MediaRecorder === "function",
    mic: typeof g.navigator?.mediaDevices?.getUserMedia === "function",
  };
}

let serverStt: Promise<boolean> | undefined;
function serverCanTranscribe(): Promise<boolean> {
  serverStt ??= fetch("/api/config")
    .then((r) => r.json() as Promise<{ transcribe?: boolean }>)
    .then((c) => c.transcribe === true)
    .catch(() => false);
  return serverStt;
}

/** "native" right away; otherwise asks the server once whether it can transcribe. */
export function useSpeechMode(): SpeechMode | undefined {
  const native = hasNativeSpeech();
  const [mode, setMode] = useState<SpeechMode | undefined>(native ? "native" : undefined);
  useEffect(() => {
    if (native) return;
    let live = true;
    void serverCanTranscribe().then((server) => {
      if (live) setMode(pickMode({ native, ...canRecord(), server }));
    });
    return () => {
      live = false;
    };
  }, [native]);
  return mode;
}

export interface Recording {
  stop(): Promise<Blob>;
}

/** Opens the mic and records until stop(); throws if the mic is denied or missing. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          for (const t of stream.getTracks()) t.stop();
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        if (rec.state === "inactive") rec.onstop(new Event("stop"));
        else rec.stop();
      }),
  };
}

export class SttError extends Error {}

/** Sends a clip to the server; "" when nothing was heard. Throws SttError("unavailable" | "failed"). */
export async function transcribeClip(clip: Blob, lang: "es" | "en"): Promise<string> {
  const res = await fetch(`/api/voice/transcribe?lang=${lang}`, {
    method: "POST",
    headers: { "Content-Type": clip.type || "audio/webm" },
    body: clip,
  }).catch(() => undefined);
  if (!res) throw new SttError("failed");
  if (res.status === 503) throw new SttError("unavailable");
  if (!res.ok) throw new SttError("failed");
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}
