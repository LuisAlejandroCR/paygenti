// web/src/announce.ts: the PAID moment in the voice box's own voice — its chime, "¡Pagado!" and the
// amount in words (shared/spoken.ts), played from the box's recordings in web/public/voice with WebAudio
// and the box's 60 ms gap; a two-note chime when audio is blocked. Also the box's phrase clips and the
// "Recibido: 95 pesos" text voice mode shows and speaks. unlockAudio() must run on a tap.
import { decimalsOf } from "../../shared/currency";
import type { Currency, Money } from "../../shared/money";
import { clipFile, type PhraseKey, paidClipKeys, WORD_GAP_MS } from "../../shared/spoken";
import { getLocale, type Key, type Locale, translate } from "./i18n";

let ctx: AudioContext | undefined;

/** Served from web/public/voice, written by scripts/voice-clips.ts with clips.h. */
const CHIME_URL = "/voice/chime.wav";

/** URL of a box clip: /voice/<lang>/<key without accents>.wav. */
export function clipUrl(key: string, lang: Locale): string {
  return `/voice/${lang}/${clipFile(key)}.wav`;
}

/** What a paid announcement plays, in order: the box's chime, then "paid" and the amount's words. */
export function paidClipUrls(total: Money, lang: Locale): string[] {
  return [CHIME_URL, ...paidClipKeys(total, lang).map((k) => clipUrl(k, lang))];
}

/** Browsers only allow audio after a user gesture; call this from the "Cobrar" tap. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    // Every announcement starts with these two: fetch them now so "paid" is not late.
    for (const url of [CHIME_URL, clipUrl("paid", getLocale())])
      void load(ctx, url).catch(() => {});
  } catch {
    ctx = undefined;
  }
  // speak() in a11y.ts (voice mode) still uses speechSynthesis and needs the same gesture.
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}

const decoded = new Map<string, Promise<AudioBuffer>>();
function load(audio: AudioContext, url: string): Promise<AudioBuffer> {
  let p = decoded.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => audio.decodeAudioData(b));
    p.catch(() => decoded.delete(url)); // a failed fetch is retried next time
    decoded.set(url, p);
  }
  return p;
}

let playing: AudioBufferSourceNode[] = [];

/**
 * Plays clips back to back like the box's say(): WORD_GAP_MS of silence after each one, except right
 * after the chime. Fetches only these clips (kept decoded afterwards). Stops whatever was playing, as
 * the box says one thing at a time. False when audio is blocked (no tap yet) or a clip fails.
 */
export async function playClips(urls: string[]): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    const audio = ctx;
    if (audio.state !== "running")
      await Promise.race([audio.resume(), new Promise((ok) => setTimeout(ok, 300))]);
    if (audio.state !== "running") return false;
    const buffers = await Promise.all(urls.map((u) => load(audio, u)));
    for (const s of playing) s.stop();
    let t = audio.currentTime + 0.05;
    playing = buffers.map((buffer, i) => {
      const src = audio.createBufferSource();
      src.buffer = buffer;
      src.connect(audio.destination);
      src.start(t);
      t += buffer.duration + (urls[i] === CHIME_URL ? 0 : WORD_GAP_MS / 1000);
      return src;
    });
    return true;
  } catch {
    return false;
  }
}

/** The box's paid announcement; the two-note chime if the clips cannot play. */
export function announcePaid(total: Money): void {
  void playClips(paidClipUrls(total, getLocale())).then((ok) => {
    if (!ok) chime();
  });
}

/** One of the box's phrases (sale_failed, sale_expired, …) in the current language. */
export function announcePhrase(key: PhraseKey): Promise<boolean> {
  return playClips([clipUrl(key, getLocale())]);
}

/** Currencies with a spoken word in the dictionaries; others are spoken by their ISO code. */
const SPOKEN: Partial<Record<Currency, [Key, Key]>> = {
  MXN: ["money.peso", "money.pesos"],
  USD: ["money.dollar", "money.dollars"],
  CAD: ["money.dollar", "money.dollars"],
  AUD: ["money.dollar", "money.dollars"],
  EUR: ["money.euro", "money.euros"],
  BRL: ["money.real", "money.reais"],
  GBP: ["money.pound", "money.pounds"],
  JPY: ["money.yen", "money.yens"],
};

/** "95 pesos": the amount in voice mode's spoken lines (speak() in a11y.ts) and on screen. */
export function spokenAmount(m: Money, locale: Locale = getLocale()): string {
  const base = 10 ** decimalsOf(m.currency);
  const units = Math.trunc(m.minor / base);
  const cents = m.minor % base;
  const words = SPOKEN[m.currency];
  const unit = words ? translate(locale, words[units === 1 ? 0 : 1]) : m.currency;
  const whole = `${units} ${unit}`;
  return cents ? translate(locale, "money.withCents", { units: whole, cents }) : whole;
}

export function paidAnnouncement(m: Money, locale: Locale = getLocale()): string {
  return translate(locale, "announce.received", { amount: spokenAmount(m, locale) });
}

export function chime(): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + i * 0.18);
      osc.stop(t0 + i * 0.18 + 0.55);
    }
  } catch {
    // No audio at all: the big green screen is the last fallback.
  }
}
