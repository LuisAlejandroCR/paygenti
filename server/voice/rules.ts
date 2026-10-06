// server/voice/rules.ts: deterministic Spanish order parser ("dos de rajas y un atole" -> cart lines).
// Always available, no network. Every line comes from the catalog; unknown fragments go to `unmatched`.
import type { CartLine, CatalogItem } from "../../shared/types";

export interface ParseResult {
  lines: CartLine[];
  unmatched: string[];
}

export const MAX_QTY = 99;

const NUMBERS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  otro: 1,
  otra: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
};

const SEPARATORS = new Set([",", ";", "+", "y", "e", "tambien", "ademas"]);

const STOPWORDS = new Set([
  "de",
  "con",
  "mas",
  "del",
  "la",
  "el",
  "los",
  "las",
  "unos",
  "unas",
  "por",
  "favor",
  "porfa",
  "quiero",
  "queremos",
  "quisiera",
  "dame",
  "deme",
  "me",
  "da",
  "das",
  "nos",
  "pon",
  "ponme",
  "para",
  "llevar",
  "aqui",
  "orden",
  "ordenes",
  "pieza",
  "piezas",
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([,;+])/g, " $1 ")
    .replace(/[^a-z0-9ñ,;+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude Spanish singular stem: "tamales"/"tamal" -> "tamal", "atoles"/"atole" -> "atol". */
export function stem(word: string): string {
  return word.replace(/s$/, "").replace(/e$/, "");
}

function isQuantityStart(token: string): boolean {
  return /^\d+$/.test(token) || token in NUMBERS || token === "media" || token === "medio";
}

function isMultiplier(token: string): boolean {
  return /^(docenas?|par|pares)$/.test(token);
}

function splitSegments(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];
  let hasContent = false;
  const flush = () => {
    if (current.length > 0) segments.push(current);
    current = [];
    hasContent = false;
  };
  for (const token of tokens) {
    if (SEPARATORS.has(token)) {
      flush();
      continue;
    }
    if (isQuantityStart(token) && hasContent) flush();
    current.push(token);
    if (!isQuantityStart(token) && !isMultiplier(token) && !STOPWORDS.has(token)) hasContent = true;
  }
  flush();
  return segments;
}

/** Reads a leading quantity ("dos", "4", "media docena", "un par de") and returns it plus the rest. */
function readQuantity(tokens: string[]): { qty: number | null; rest: string[] } {
  let i = 0;
  while (i < tokens.length && STOPWORDS.has(tokens[i] ?? "")) i += 1;
  let qty: number | null = null;
  const first = tokens[i];
  if (first === undefined) return { qty, rest: tokens };
  if (/^\d+$/.test(first)) {
    qty = Number(first);
    i += 1;
  } else if (first in NUMBERS) {
    qty = NUMBERS[first] ?? null;
    i += 1;
  } else if (first === "media" || first === "medio") {
    qty = 0.5;
    i += 1;
  }
  const next = tokens[i];
  if (next !== undefined && isMultiplier(next)) {
    qty = (qty ?? 1) * (next.startsWith("docena") ? 12 : 2);
    i += 1;
  }
  if (qty !== null && !Number.isInteger(qty)) qty = null;
  return { qty, rest: tokens.slice(i) };
}

interface Matcher {
  item: CatalogItem;
  phrases: string[][];
}

function contentStems(words: string[]): string[] {
  return words.filter((w) => !STOPWORDS.has(w)).map(stem);
}

function buildMatchers(catalog: CatalogItem[]): Matcher[] {
  return catalog.map((item) => ({
    item,
    phrases: [item.name, ...item.aliases]
      .map((p) => contentStems(normalize(p).split(" ")))
      .filter((p) => p.length > 0),
  }));
}

/** Picks the catalog item whose longest name/alias is fully contained in the words; ties are ambiguous. */
function matchItem(words: string[], matchers: Matcher[]): CatalogItem | null {
  const have = new Set(contentStems(words));
  let best: CatalogItem | null = null;
  let bestScore = 0;
  let tie = false;
  for (const { item, phrases } of matchers) {
    let score = 0;
    for (const phrase of phrases) {
      if (phrase.every((w) => have.has(w))) score = Math.max(score, phrase.length);
    }
    if (score === 0) continue;
    if (score > bestScore) {
      best = item;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && best?.sku !== item.sku) {
      tie = true;
    }
  }
  return tie ? null : best;
}

export function parseOrder(text: string, catalog: CatalogItem[]): ParseResult {
  const matchers = buildMatchers(catalog);
  const tokens = normalize(text).split(" ").filter(Boolean);
  const bySku = new Map<string, CartLine>();
  const unmatched: string[] = [];

  for (const segment of splitSegments(tokens)) {
    const { qty, rest } = readQuantity(segment);
    if (contentStems(rest).length === 0) continue;
    const item = matchItem(rest, matchers);
    if (!item || (qty !== null && qty < 1)) {
      unmatched.push(segment.join(" "));
      continue;
    }
    const add = qty ?? 1;
    const line = bySku.get(item.sku);
    if (line) line.qty = Math.min(MAX_QTY, line.qty + add);
    else
      bySku.set(item.sku, {
        sku: item.sku,
        name: item.name,
        qty: Math.min(MAX_QTY, add),
        unitPrice: item.price,
      });
  }

  return { lines: [...bySku.values()], unmatched };
}
