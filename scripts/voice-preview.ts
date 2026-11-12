// scripts/voice-preview.ts: renders a paid announcement to one WAV exactly as the box, the web and the
// app play it — chime, "paid" and the amount's words from web/public/voice, 60 ms after each clip but
// the chime — to listen to without the box. npm run voice:preview -- <es|en> <amount> <currency> [out.wav]
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Currency, fromPayPalValue } from "../shared/money";
import { clipFile, paidClipKeys, type SpokenLang, WORD_GAP_MS } from "../shared/spoken";

const [lang = "es", amount = "85.50", currency = "MXN", out] = process.argv.slice(2);
if (lang !== "es" && lang !== "en") throw new Error(`lang must be es or en, not ${lang}`);
const RATE = 16000;
const dir = resolve("web/public/voice");
const data = (file: string) => readFileSync(file).subarray(44);
const gap = Buffer.alloc((RATE * WORD_GAP_MS * 2) / 1000);

const keys = paidClipKeys(fromPayPalValue(amount, currency as Currency), lang as SpokenLang);
const pcm = Buffer.concat([
  data(join(dir, "chime.wav")),
  ...keys.flatMap((k) => [data(join(dir, lang, `${clipFile(k)}.wav`)), gap]),
]);
const header = Buffer.alloc(44);
header.write("RIFF", 0, "ascii");
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8, "ascii");
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36, "ascii");
header.writeUInt32LE(pcm.length, 40);
const file = resolve(out ?? join(tmpdir(), `voice-preview-${lang}.wav`));
writeFileSync(file, Buffer.concat([header, pcm]));
console.log(`${file}: chime ${keys.join(" ")} (${(pcm.length / 2 / RATE).toFixed(2)} s)`);
