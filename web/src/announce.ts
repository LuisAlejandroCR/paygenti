// web/src/announce.ts: says "Received: 95 pesos" / "Recibido: 10 dólares" (word per currency) with speechSynthesis in the
// current locale (en-US / es-MX) and falls back to a WebAudio chime when speech is unavailable or fails. unlockAudio() must run on a tap.
import { decimalsOf } from "../../shared/currency";
import type { Currency, Money } from "../../shared/money";
import { getLocale, type Key, type Locale, speechLang, translate } from "./i18n";

let ctx: AudioContext | undefined;

/** Browsers only allow audio after a user gesture; call this from the "Cobrar" tap. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = undefined;
  }
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
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

export function announcePaid(total: Money): void {
  const locale = getLocale();
  const text = paidAnnouncement(total, locale);
  if (!("speechSynthesis" in window)) return chime();
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(locale);
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang.toLowerCase().startsWith(locale));
    if (!voice && window.speechSynthesis.getVoices().length > 0) return chime();
    if (voice) u.voice = voice;
    u.onerror = () => chime();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    chime();
  }
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
