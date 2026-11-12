// test/voice-parity.test.ts: the box, the web and the app say the same thing with the same recordings —
// paid amount -> clip keys (shared/spoken.ts) and the web's URLs, every key either one can ask for has a
// WAV in web/public/voice and in the app's table (mobile/assets/voice/index.ts), and each WAV holds
// exactly the samples the box plays from firmware/voice-box/clips.h.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Currency, money } from "../shared/money";
import {
  clipFile,
  PHRASE_KEYS,
  paidClipKeys,
  SPOKEN_WORDS,
  type SpokenLang,
} from "../shared/spoken";
import { clipUrl, paidClipUrls } from "../web/src/announce";

const LANGS: SpokenLang[] = ["es", "en"];
const WEB = "web/public/voice";
const MOBILE = "mobile/assets/voice";

describe("paidClipKeys", () => {
  it("is «paid» and then the amount's words, as the box says it", () => {
    expect(paidClipKeys(money(4000, "MXN"), "es")).toEqual(["paid", "cuarenta", "pesos"]);
    expect(paidClipKeys(money(8550, "MXN"), "en")).toEqual([
      "paid",
      "eighty",
      "five",
      "pesos",
      "and",
      "fifty",
      "cents",
    ]);
    expect(paidClipKeys(money(1600, "USD"), "es")).toEqual(["paid", "dieciséis", "dólares"]);
  });

  it("drops words without a clip, as the box skips them", () => {
    expect(paidClipKeys(money(2_000_000_000, "JPY"), "en")).toEqual(["paid", "yen"]);
  });
});

describe("web clip URLs", () => {
  it("start with the chime and use file names without accents", () => {
    expect(paidClipUrls(money(1600, "USD"), "es")).toEqual([
      "/voice/chime.wav",
      "/voice/es/paid.wav",
      "/voice/es/dieciseis.wav",
      "/voice/es/dolares.wav",
    ]);
    expect(clipUrl("sale_expired", "en")).toBe("/voice/en/sale_expired.wav");
  });
});

/** The app's generated table: key -> require path, per language. */
function mobileTable(): Record<SpokenLang, Map<string, string>> {
  const src = readFileSync(join(MOBILE, "index.ts"), "utf8");
  const out = { es: new Map<string, string>(), en: new Map<string, string>() };
  for (const m of src.matchAll(/^ {4}"([^"]+)": require\("\.\/(es|en)\/([^"]+)"\),$/gm))
    out[m[2] as SpokenLang].set(m[1] as string, m[3] as string);
  return out;
}

describe("clip files", () => {
  const table = mobileTable();

  it("exist for every key the web or the app can ask for", () => {
    const amounts = [
      ...Array.from({ length: 20_000 }, (_, i) => i),
      ...Array.from({ length: 2_000 }, (_, i) => i * 997_001),
    ];
    const asked = { es: new Set<string>(PHRASE_KEYS), en: new Set<string>(PHRASE_KEYS) };
    for (const lang of LANGS)
      for (const minor of amounts)
        for (const currency of ["MXN", "USD", "EUR", "BRL", "GBP", "JPY"] as Currency[])
          for (const k of paidClipKeys(money(minor, currency), lang)) asked[lang].add(k);
    const missing: string[] = [];
    for (const lang of LANGS)
      for (const k of asked[lang]) {
        const file = `${clipFile(k)}.wav`;
        if (!existsSync(join(WEB, lang, file))) missing.push(`web ${lang}/${file}`);
        if (table[lang].get(k) !== file) missing.push(`app ${lang} "${k}"`);
        if (!existsSync(join(MOBILE, lang, file))) missing.push(`app ${lang}/${file}`);
      }
    for (const dir of [WEB, MOBILE])
      if (!existsSync(join(dir, "chime.wav"))) missing.push(`${dir}/chime.wav`);
    expect(missing).toEqual([]);
  }, 30_000); // ~2 s alone, past 5 s when the whole suite runs in parallel

  it("cover the box's whole vocabulary, one file per key", () => {
    for (const lang of LANGS) {
      const keys = [...SPOKEN_WORDS[lang], ...PHRASE_KEYS];
      expect([...table[lang].keys()].sort()).toEqual([...keys].sort());
      expect(new Set(keys.map(clipFile)).size).toBe(keys.length);
    }
  });
});

/** mulawDecode() in voice-box.ino. */
function unmulaw(u: number): number {
  const v = ~u & 0xff;
  const t = (((v & 0x0f) << 3) + 0x84) << ((v & 0x70) >> 4);
  return v & 0x80 ? 0x84 - t : t - 0x84;
}

/** clips.h decoded the way the box plays it: key -> PCM16, per language. */
function boxClips(): Record<SpokenLang, Map<string, Int16Array>> {
  const src = readFileSync("firmware/voice-box/clips.h", "utf8");
  const out = { es: new Map<string, Int16Array>(), en: new Map<string, Int16Array>() };
  // Rows of "\xHH…" literals; the last one ends with ";".
  const re =
    /^\/\/ ("[^"\n]+"): .*\nstatic const uint8_t CLIP_(ES|EN)_\d+\[\] =\n((?: {2}".*"\n)* {2}".*";)$/gm;
  for (const m of src.matchAll(re)) {
    const hex = (m[3] as string).match(/\\x[0-9a-f]{2}/g) ?? [];
    const lang = (m[2] as string).toLowerCase() as SpokenLang;
    out[lang].set(
      JSON.parse(m[1] as string),
      Int16Array.from(hex, (h) => unmulaw(parseInt(h.slice(2), 16))),
    );
  }
  return out;
}

/** The PCM16 bytes of a 16 kHz mono 16-bit WAV (little endian, like an Int16Array here). */
function wavData(buf: Buffer): Buffer {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect([buf.readUInt16LE(22), buf.readUInt32LE(24), buf.readUInt16LE(34)]).toEqual([
    1, 16000, 16,
  ]);
  return buf.subarray(44);
}

describe("one voice", () => {
  it("web and app WAVs are the box's clips, sample for sample", { timeout: 30_000 }, () => {
    const box = boxClips();
    const differ: string[] = [];
    for (const lang of LANGS) {
      expect(box[lang].size).toBe(SPOKEN_WORDS[lang].length + PHRASE_KEYS.length);
      for (const [key, pcm] of box[lang]) {
        const file = `${clipFile(key)}.wav`;
        const web = readFileSync(join(WEB, lang, file));
        if (!readFileSync(join(MOBILE, lang, file)).equals(web)) differ.push(`app ${lang} ${key}`);
        if (!wavData(web).equals(Buffer.from(pcm.buffer))) differ.push(`web ${lang} ${key}`);
      }
    }
    expect(differ).toEqual([]);
  });
});
