// web/src/announce.ts: says "Recibido: 95 pesos" out loud with speechSynthesis (es-MX) and falls
// back to a WebAudio chime when speech is unavailable or fails. unlockAudio() must run on a tap.
import type { Money } from "../../shared/money";

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

export function spokenAmount(m: Money): string {
  const units = Math.trunc(m.minor / 100);
  const cents = m.minor % 100;
  const unit = m.currency === "MXN" ? (units === 1 ? "peso" : "pesos") : units === 1 ? "dólar" : "dólares";
  return cents ? `${units} ${unit} con ${cents} centavos` : `${units} ${unit}`;
}

export function announcePaid(total: Money): void {
  const text = `Recibido: ${spokenAmount(total)}`;
  if (!("speechSynthesis" in window)) return chime();
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-MX";
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("es"));
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
