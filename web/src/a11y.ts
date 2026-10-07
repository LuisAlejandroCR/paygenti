// web/src/a11y.ts: accessibility settings and the voice-first mode for blind vendors — persisted
// high-contrast and voice-mode flags (mirrored on <html data-*>), speak() in es/en, a distinct tone
// per sale state, parseCommand() mapping spoken words to vendor actions, and listenOnce() (native
// recognizer, or a recorded clip transcribed by the server in Firefox). DOM access is guarded.

import { useEffect, useState } from "preact/hooks";
import { getLocale, type Locale, speechLang } from "./i18n";
import { hasNativeSpeech, type SpeechMode, startRecording, transcribeClip } from "./stt";

export type Pref = "contrast" | "voice";
const KEYS: Record<Pref, string> = { contrast: "paygent.contrast", voice: "paygent.voice" };
const ON: Record<Pref, string> = { contrast: "high", voice: "on" };
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function getPref(p: Pref): boolean {
  try {
    return storage()?.getItem(KEYS[p]) === ON[p];
  } catch {
    return false;
  }
}

/** Mirrors the flags on <html> so CSS can switch the theme: data-contrast="high", data-voice="on". */
export function applyPrefs(): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (getPref("contrast")) root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  if (getPref("voice")) root.dataset.voice = "on";
  else delete root.dataset.voice;
}

export function setPref(p: Pref, on: boolean): void {
  try {
    if (on) storage()?.setItem(KEYS[p], ON[p]);
    else storage()?.removeItem(KEYS[p]);
  } catch {
    // Private mode: the setting lasts for this page only.
  }
  applyPrefs();
  for (const l of listeners) l();
}

export function usePref(p: Pref): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getPref(p));
  useEffect(() => {
    const l = () => setOn(getPref(p));
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [p]);
  return [on, (v) => setPref(p, v)];
}

/** Speaks text in the current locale; queue=false interrupts whatever is being said. */
export function speak(text: string, queue = false, locale: Locale = getLocale()): void {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(locale);
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(locale));
    if (voice) u.voice = voice;
    if (!queue) synth.cancel();
    synth.speak(u);
  } catch {
    // No speech: the on-screen live regions still carry the state.
  }
}

export type SaleSound = "entry" | "waiting" | "paid" | "failed" | "expired" | "extended";

/** Tone patterns (Hz, ms) — each sale state is recognisable without words. */
export const SOUNDS: Record<SaleSound, Array<[number, number]>> = {
  entry: [[660, 120]],
  waiting: [
    [520, 120],
    [520, 120],
  ],
  paid: [
    [660, 120],
    [880, 120],
    [1320, 260],
  ],
  failed: [
    [440, 200],
    [330, 320],
  ],
  expired: [
    [600, 160],
    [450, 160],
    [300, 320],
  ],
  extended: [
    [520, 100],
    [780, 140],
  ],
};

let ctx: AudioContext | undefined;
export function playSound(kind: SaleSound): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    let t = ctx.currentTime;
    for (const [freq, ms] of SOUNDS[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "failed" || kind === "expired" ? "square" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
      t += ms / 1000 + 0.04;
    }
  } catch {
    // No audio device.
  }
}

export type Command =
  | { type: "charge" }
  | { type: "cancel" }
  | { type: "extend" }
  | { type: "newSale" }
  | { type: "repeat" }
  | { type: "amount"; value: string };

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Maps a spoken phrase (es/en) to a vendor command; a bare number sets the keypad amount. */
export function parseCommand(transcript: string): Command | undefined {
  const s = strip(transcript);
  if (!s) return undefined;
  if (/\b(mas tiempo|more time|cinco minutos|five minutes|extend|extender)\b/.test(s))
    return { type: "extend" };
  if (/\b(nueva venta|new sale|otra venta)\b/.test(s)) return { type: "newSale" };
  if (/\b(cancela|cancelar|cancel)\b/.test(s)) return { type: "cancel" };
  if (/\b(repite|repetir|repeat|estado|status|again)\b/.test(s)) return { type: "repeat" };
  const num = /(\d+(?:[.,]\d{1,2})?)/.exec(s);
  if (/\b(cobra|cobrar|charge)\b/.test(s))
    return num?.[1] ? { type: "amount", value: num[1].replace(",", ".") } : { type: "charge" };
  if (num?.[1] && /^[\d\s.,$a-z]*$/.test(s))
    return { type: "amount", value: num[1].replace(",", ".") };
  return undefined;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
}
type RecognitionCtor = new () => Recognition;

export function canListen(): boolean {
  return hasNativeSpeech();
}

/** Firefox path: records a short clip, transcribes it on the server, hands back the text. */
const COMMAND_CLIP_MS = 3500;
function recordOnce(onText: (text: string) => void, onFail: () => void): void {
  startRecording()
    .then(async (r) => {
      await new Promise((ok) => setTimeout(ok, COMMAND_CLIP_MS));
      const clip = await r.stop();
      onText(await transcribeClip(clip, getLocale() === "en" ? "en" : "es"));
    })
    .catch(onFail);
}

/**
 * Listens once and hands back the transcript ("" when nothing was heard). With mode "record"
 * (no SpeechRecognition) it records a clip instead; onFail runs if the mic or server fails.
 */
export function listenOnce(
  onText: (text: string) => void,
  mode: SpeechMode = "native",
  onFail: () => void = () => onText(""),
): boolean {
  if (mode === "record" && !hasNativeSpeech()) {
    recordOnce(onText, onFail);
    return true;
  }
  const w = globalThis as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return false;
  let heard = "";
  const r = new Ctor();
  r.lang = speechLang(getLocale());
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    heard = e.results[0]?.[0]?.transcript ?? "";
  };
  r.onerror = () => {};
  r.onend = () => onText(heard);
  try {
    r.start();
    return true;
  } catch {
    return false;
  }
}
