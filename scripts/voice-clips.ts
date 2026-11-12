// scripts/voice-clips.ts: records the voice box's speech (npm run voice:clips; Windows only) — every
// amount word from shared/spoken.ts plus the paid/error phrases below, in Spanish (VOICE_ES, default
// "Microsoft Sabina", es-MX) and English (VOICE_EN, default "Microsoft Zira Desktop", en-US); trimmed,
// compressed (louder on a small speaker), peak-normalized and stored as 16 kHz µ-law in
// firmware/voice-box/clips.h, one table per language.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SPOKEN_WORDS, type SpokenLang } from "../shared/spoken";

const RATE = 16000;
const OUT = resolve("firmware/voice-box/clips.h");

/** Per language: Windows voice, fallback culture, fixed phrases by key, and words read differently. */
const LANGS: Record<
  SpokenLang,
  { voice: string; culture: string; phrases: Record<string, string>; sayAs: Record<string, string> }
> = {
  es: {
    voice: process.env.VOICE_ES ?? "Microsoft Sabina",
    culture: "es-*",
    // voice-box.ino maps server errors and sale states to these keys.
    phrases: {
      paid: "¡Pagado!",
      err_wifi: "Sin internet. Revisa el wifi.",
      err_server: "No hay conexión con el servidor.",
      err_internal: "Error en el servidor. Intenta de nuevo.",
      err_stt_off: "La voz a texto está apagada en el servidor.",
      err_stt_failed: "No pude procesar el audio. Intenta de nuevo.",
      err_unknown: "No entendí el monto. Repítelo, por favor.",
      err_paypal: "PayPal rechazó el cobro. Intenta de nuevo.",
      err_terminal: "Esta caja no está registrada.",
      err_amount: "El monto no es válido.",
      sale_cancelled: "Cobro cancelado.",
      sale_expired: "El cobro venció sin pago.",
      sale_failed: "El pago falló.",
    },
    // A lone "y" is read as the letter name ("i griega"); "i" sounds like the conjunction.
    sayAs: { y: "i" },
  },
  en: {
    voice: process.env.VOICE_EN ?? "Microsoft Zira Desktop",
    culture: "en-*",
    phrases: {
      paid: "Paid!",
      err_wifi: "No internet. Check the Wi-Fi.",
      err_server: "Can't reach the server.",
      err_internal: "Server error. Please try again.",
      err_stt_off: "Speech to text is off on the server.",
      err_stt_failed: "I couldn't process the audio. Please try again.",
      err_unknown: "I didn't catch the amount. Please say it again.",
      err_paypal: "PayPal declined the charge. Please try again.",
      err_terminal: "This box is not registered.",
      err_amount: "That amount is not valid.",
      sale_cancelled: "Charge cancelled.",
      sale_expired: "The charge expired without payment.",
      sale_failed: "The payment failed.",
    },
    sayAs: {},
  },
};

const SYNTH_PS1 = `
param([string]$List, [string]$Out, [string]$Voice, [string]$Culture)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$pick = $voices | Where-Object { $_.Name -eq $Voice } | Select-Object -First 1
if (-not $pick) { $pick = $voices | Where-Object { $_.Culture.Name -like $Culture } | Select-Object -First 1 }
if (-not $pick) { throw "no $Culture voice installed" }
$s.SelectVoice($pick.Name)
Write-Output ('voice: ' + $pick.Name)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$i = 0
foreach ($text in (Get-Content -Raw -Encoding utf8 $List | ConvertFrom-Json)) {
  $s.SetOutputToWaveFile((Join-Path $Out "$i.wav"), $fmt)
  $s.Speak([string]$text)
  $i++
}
$s.SetOutputToNull()
$s.Dispose()
`;

/** PCM16 mono samples of a 16 kHz WAV file. */
function readWav(buf: Buffer): Int16Array {
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      const channels = buf.readUInt16LE(off + 10);
      const rate = buf.readUInt32LE(off + 12);
      const bits = buf.readUInt16LE(off + 22);
      if (channels !== 1 || rate !== RATE || bits !== 16)
        throw new Error(`unexpected WAV format ${channels}ch ${rate} Hz ${bits} bit`);
    }
    if (id === "data") {
      const end = size > 0 ? Math.min(buf.length, off + 8 + size) : buf.length;
      const out = new Int16Array(Math.floor((end - off - 8) / 2));
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(off + 8 + 2 * i);
      return out;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error("WAV without a data chunk");
}

/**
 * Compressor above `threshold` of the clip's peak: loud syllables come down, so normalizing lifts the
 * rest. The level is the max over ±`window` s (it sees a peak before reaching it, so none slips past)
 * and the gain is averaged over the same span, so it moves slower than a pitch period (no buzz).
 */
const COMP = { threshold: 0.15, ratio: 3, window: 0.005 };

function compress(pcm: Int16Array, peak: number): Float64Array {
  const w = Math.round(RATE * COMP.window);
  const t = peak * COMP.threshold;
  const n = pcm.length;
  const gain = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let env = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++)
      env = Math.max(env, Math.abs(pcm[j] ?? 0));
    gain[i] = env > t ? (t / env) ** (1 - 1 / COMP.ratio) : 1;
  }
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = (sum[i] ?? 0) + (gain[i] ?? 1);
  return Float64Array.from(pcm, (s, i) => {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n, i + w + 1);
    return (s * ((sum[hi] ?? 0) - (sum[lo] ?? 0))) / (hi - lo);
  });
}

const rms = (pcm: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += (pcm[i] ?? 0) ** 2;
  return Math.sqrt(sum / pcm.length);
};

/**
 * Cuts leading/trailing silence (keeps a few ms of edge), compresses, and scales the peak to 95 % of
 * full scale. `liftDb` is how much louder (RMS) that is than normalizing without the compressor.
 */
function trimAndNormalize(pcm: Int16Array): { pcm: Int16Array; liftDb: number } {
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) throw new Error("silent clip");
  const threshold = peak * 0.03;
  let start = pcm.findIndex((s) => Math.abs(s) > threshold);
  let end = pcm.length - 1;
  while (end > start && Math.abs(pcm[end] ?? 0) <= threshold) end--;
  start = Math.max(0, start - RATE * 0.01);
  end = Math.min(pcm.length - 1, end + RATE * 0.03);
  const trimmed = pcm.subarray(start, end + 1);
  const squeezed = compress(trimmed, peak);
  let top = 0;
  for (const s of squeezed) top = Math.max(top, Math.abs(s));
  const out = Int16Array.from(squeezed, (s) => Math.round((s * 32767 * 0.95) / top));
  const plain = (rms(trimmed) * 32767 * 0.95) / peak;
  return { pcm: out, liftDb: 20 * Math.log10(rms(out) / plain) };
}

/** G.711 µ-law; the firmware's decoder is the standard inverse. */
function mulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  const s = Math.min(Math.abs(sample), CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Same formula as mulawDecode() in voice-box.ino, used to self-check the encoder. */
function unmulaw(u: number): number {
  const v = ~u & 0xff;
  const t = (((v & 0x0f) << 3) + 0x84) << ((v & 0x70) >> 4);
  return v & 0x80 ? 0x84 - t : t - 0x84;
}

for (const s of [-32000, -1000, -10, 0, 10, 1000, 32000]) {
  const back = unmulaw(mulaw(s));
  if (Math.abs(back - s) > Math.max(16, Math.abs(s) * 0.07))
    throw new Error(`µ-law round trip off: ${s} -> ${back}`);
}

/** Bytes as an escaped string literal: the compiler lexes it far faster than a list of integers. */
function literal(data: number[]): string {
  const rows: string[] = [];
  for (let r = 0; r < data.length; r += 48)
    rows.push(
      `  "${data
        .slice(r, r + 48)
        .map((b) => `\\x${b.toString(16).padStart(2, "0")}`)
        .join("")}"`,
    );
  return rows.join("\n");
}

/** Synthesizes one language and returns its C arrays and table; `bytes` is the µ-law size. */
function buildLang(lang: SpokenLang, dir: string): { code: string; clips: number; bytes: number } {
  const cfg = LANGS[lang];
  const entries = [
    ...SPOKEN_WORDS[lang].map((w) => ({ key: w, text: cfg.sayAs[w] ?? w })),
    ...Object.entries(cfg.phrases).map(([key, text]) => ({ key, text })),
  ];
  const out = join(dir, lang);
  const list = join(dir, `${lang}.json`);
  writeFileSync(list, JSON.stringify(entries.map((e) => e.text)));
  mkdirSync(out);
  const run = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      join(dir, "synth.ps1"),
      "-List",
      list,
      "-Out",
      out,
      "-Voice",
      cfg.voice,
      "-Culture",
      cfg.culture,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`${lang} synthesis failed: ${run.stderr || run.stdout}`);
  console.log(`${lang} ${run.stdout.trim()}`);

  const id = lang.toUpperCase();
  const parts: string[] = [];
  const table: string[] = [];
  let bytes = 0;
  let lift = 0;
  entries.forEach((e, i) => {
    const clip = trimAndNormalize(readWav(readFileSync(join(out, `${i}.wav`))));
    const data = Array.from(clip.pcm, mulaw);
    bytes += data.length;
    lift += clip.liftDb / entries.length;
    const name = `CLIP_${id}_${i}`;
    parts.push(
      `// ${JSON.stringify(e.key)}: ${e.text}\nstatic const uint8_t ${name}[] =\n${literal(data)};`,
    );
    table.push(`  {${JSON.stringify(e.key)}, ${name}, sizeof(${name}) - 1},`);
  });
  const code = `${parts.join("\n")}

static const Clip CLIPS_${id}[] = {
${table.join("\n")}
};
constexpr size_t CLIP_COUNT_${id} = sizeof(CLIPS_${id}) / sizeof(CLIPS_${id}[0]);`;
  return { code, clips: entries.length, bytes, lift };
}

const dir = mkdtempSync(join(tmpdir(), "voice-clips-"));
try {
  writeFileSync(join(dir, "synth.ps1"), SYNTH_PS1);
  const built = (["es", "en"] as const).map((lang) => ({ lang, ...buildLang(lang, dir) }));
  const summary = built
    .map(
      (b) =>
        `${b.lang}: ${b.clips} clips, ${(b.bytes / RATE).toFixed(1)} s, ${Math.round(b.bytes / 1024)} KB, compressor +${b.lift.toFixed(1)} dB`,
    )
    .join("; ");
  const header = `// clips.h: the voice box's recorded speech — generated by scripts/voice-clips.ts, do not edit.
// ${summary}. 16 kHz µ-law; Spanish by ${LANGS.es.voice}, English by ${LANGS.en.voice}.
// Keys are the words of shared/spoken.ts plus fixed phrases (paid, err_*, sale_*), per language.
#pragma once
#include <stddef.h>
#include <stdint.h>

constexpr uint32_t CLIP_RATE = ${RATE};
struct Clip {
  const char *key;
  const uint8_t *data;  // µ-law, mono
  uint32_t len;
};

${built.map((b) => b.code).join("\n\n")}
`;
  writeFileSync(OUT, header);
  console.log(`wrote ${OUT} — ${summary}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
