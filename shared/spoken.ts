// shared/spoken.ts: an amount in words for the voice box's speaker, in Spanish ("ochenta y cinco pesos
// con cincuenta centavos") or English ("eighty five pesos and fifty cents"). The box has one recorded
// clip per word and language (firmware/voice-box/clips.h, built by scripts/voice-clips.ts from
// SPOKEN_WORDS), so every word said here must be in that list. The web and the app play the same
// recordings (web/public/voice, mobile/assets/voice) in the order paidClipKeys() gives.
import { decimalsOf } from "./currency";
import type { Money } from "./money";

export type SpokenLang = "es" | "en";
type Currency = Money["currency"];

// ---------- Spanish ----------

// Apocopated "un"/"veintiún": in an amount a noun or "mil" always follows ("un peso", "veintiún mil").
const ES_UNITS = [
  "cero",
  "un",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiún",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];
const ES_TENS = ["treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const ES_HUNDREDS = [
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];
/** Singular and plural. Only masculine names: a feminine one ("libra") would need "una", "doscientas". */
const ES_CURRENCY: Partial<Record<Currency, readonly [string, string]>> = {
  MXN: ["peso", "pesos"],
  PHP: ["peso", "pesos"],
  USD: ["dólar", "dólares"],
  CAD: ["dólar", "dólares"],
  AUD: ["dólar", "dólares"],
  NZD: ["dólar", "dólares"],
  HKD: ["dólar", "dólares"],
  SGD: ["dólar", "dólares"],
  TWD: ["dólar", "dólares"],
  EUR: ["euro", "euros"],
  BRL: ["real", "reales"],
  JPY: ["yen", "yenes"],
};

function esBelow1000(n: number): string[] {
  if (n === 100) return ["cien"];
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0) out.push(ES_HUNDREDS[h - 1] as string);
  if (r === 0) return out;
  if (r < 30) out.push(ES_UNITS[r] as string);
  else {
    out.push(ES_TENS[Math.floor(r / 10) - 3] as string);
    if (r % 10 > 0) out.push("y", ES_UNITS[r % 10] as string);
  }
  return out;
}

function esInteger(n: number): string[] {
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const out: string[] = [];
  if (millions === 1) out.push("un", "millón");
  else if (millions > 1) out.push(...esBelow1000(millions), "millones");
  if (thousands === 1) out.push("mil");
  else if (thousands > 1) out.push(...esBelow1000(thousands), "mil");
  if (rest > 0) out.push(...esBelow1000(rest));
  return out;
}

// ---------- English ----------

const EN_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** Singular and plural. */
const EN_CURRENCY: Partial<Record<Currency, readonly [string, string]>> = {
  MXN: ["peso", "pesos"],
  PHP: ["peso", "pesos"],
  USD: ["dollar", "dollars"],
  CAD: ["dollar", "dollars"],
  AUD: ["dollar", "dollars"],
  NZD: ["dollar", "dollars"],
  HKD: ["dollar", "dollars"],
  SGD: ["dollar", "dollars"],
  TWD: ["dollar", "dollars"],
  EUR: ["euro", "euros"],
  BRL: ["real", "reais"],
  JPY: ["yen", "yen"],
  GBP: ["pound", "pounds"],
  CHF: ["franc", "francs"],
};

/** US style, no "and" inside the number ("one hundred five"); "eighty five" is two clips. */
function enBelow1000(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0) out.push(EN_ONES[h] as string, "hundred");
  if (r === 0) return out;
  if (r < 20) out.push(EN_ONES[r] as string);
  else {
    out.push(EN_TENS[Math.floor(r / 10) - 2] as string);
    if (r % 10 > 0) out.push(EN_ONES[r % 10] as string);
  }
  return out;
}

function enInteger(n: number): string[] {
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const out: string[] = [];
  if (millions > 0) out.push(...enBelow1000(millions), "million");
  if (thousands > 0) out.push(...enBelow1000(thousands), "thousand");
  if (rest > 0) out.push(...enBelow1000(rest));
  return out;
}

// ---------- both ----------

const LANGS = {
  es: {
    zero: "cero",
    integer: esInteger,
    currency: ES_CURRENCY,
    cents: ["centavo", "centavos"],
    and: "con",
    /** "un millón de pesos", but "un millón quinientos mil pesos". */
    ofBeforeUnit: (whole: number) => whole >= 1_000_000 && whole % 1_000_000 === 0,
  },
  en: {
    zero: "zero",
    integer: enInteger,
    currency: EN_CURRENCY,
    cents: ["cent", "cents"],
    and: "and",
    ofBeforeUnit: () => false,
  },
} as const;

/** Every word spokenAmount can say, per language: the clip list the firmware needs. */
export const SPOKEN_WORDS: Readonly<Record<SpokenLang, readonly string[]>> = Object.freeze({
  es: Object.freeze([
    ...new Set([
      ...ES_UNITS,
      ...ES_TENS,
      ...ES_HUNDREDS,
      "cien",
      "y",
      "mil",
      "millón",
      "millones",
      "de",
      "con",
      "centavo",
      "centavos",
      ...Object.values(ES_CURRENCY).flat(),
    ]),
  ]),
  en: Object.freeze([
    ...new Set([
      ...EN_ONES,
      ...EN_TENS,
      "hundred",
      "thousand",
      "million",
      "and",
      "cent",
      "cents",
      ...Object.values(EN_CURRENCY).flat(),
    ]),
  ]),
});

/**
 * 8550 MXN -> "ochenta y cinco pesos con cincuenta centavos" / "eighty five pesos and fifty cents";
 * 50 USD -> "cincuenta centavos" / "fifty cents". The sign is dropped (the box only announces
 * payments); cents only for two-decimal currencies; a currency without a recorded name says only
 * the number; from a billion up, the digits (no clip, so the box skips them).
 */
export function spokenAmount(m: Money, lang: SpokenLang): string {
  const L = LANGS[lang];
  const d = decimalsOf(m.currency);
  const base = 10 ** d;
  const abs = Math.abs(m.minor);
  const whole = Math.trunc(abs / base);
  const cents = d === 2 ? abs % base : 0;
  const integer = (n: number) =>
    n === 0 ? [L.zero] : n >= 1_000_000_000 ? [String(n)] : L.integer(n);
  const unit = L.currency[m.currency];
  const words: string[] = [];
  if (whole > 0 || cents === 0) {
    words.push(...integer(whole));
    if (unit) {
      if (L.ofBeforeUnit(whole)) words.push("de");
      words.push(whole === 1 ? unit[0] : unit[1]);
    }
  }
  if (cents > 0) {
    if (words.length > 0) words.push(L.and);
    words.push(...integer(cents), cents === 1 ? L.cents[0] : L.cents[1]);
  }
  return words.join(" ");
}

// ---------- clip keys (box, web and app say the same recordings) ----------

/**
 * Fixed phrases recorded next to the words (texts in scripts/voice-clips.ts): what the box says for
 * each outcome. The web and the app play the same files for the states they share.
 */
export const PHRASE_KEYS = [
  "paid",
  "err_wifi",
  "err_server",
  "err_internal",
  "err_stt_off",
  "err_stt_failed",
  "err_unknown",
  "err_paypal",
  "err_terminal",
  "err_amount",
  "sale_cancelled",
  "sale_expired",
  "sale_failed",
] as const;
export type PhraseKey = (typeof PHRASE_KEYS)[number];

/** Silence after each clip, as in the box's say() (WORD_GAP_MS in voice-box.ino). */
export const WORD_GAP_MS = 60;

/**
 * The paid announcement as clip keys: "paid" and then the amount's words ("paid cuarenta pesos").
 * A word without a clip (the digits of a billion or more) is dropped, as the box skips it. The
 * chime that comes first is not a key: players add it (voice/chime.wav).
 */
export function paidClipKeys(m: Money, lang: SpokenLang): string[] {
  const vocab = new Set(SPOKEN_WORDS[lang]);
  return [
    "paid",
    ...spokenAmount(m, lang)
      .split(" ")
      .filter((w) => vocab.has(w)),
  ];
}

/**
 * File name of a clip, without extension: the key without accents ("dieciséis" -> "dieciseis"). A
 * Windows device name gets a "_" ("con" -> "con_"): Windows and Git cannot hold a file "con.wav".
 */
export function clipFile(key: string): string {
  const name = key.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `${name}_` : name;
}
