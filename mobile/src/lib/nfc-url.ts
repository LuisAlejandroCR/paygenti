// src/lib/nfc-url.ts: builds and checks the URL written to NFC stickers and served by the HCE tag —
// PUBLIC_URL/t/:terminal, the same link the server prints in its QR — and sizes the NDEF message so
// the app can refuse a link that does not fit an NTAG215 (504 bytes of user memory), the sticker on the box.

export const TERMINAL_ID = /^[a-z0-9-]{1,40}$/;
export const NTAG215_BYTES = 504;

/** Normalises a server base URL ("https://x.com/" -> "https://x.com"); undefined if not http(s). */
export function normalizeBaseUrl(input: string): string | undefined {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(trimmed)) return undefined;
  return trimmed;
}

/** PUBLIC_URL/t/:terminal; throws on a malformed base URL or terminal id. */
export function terminalPayUrl(publicUrl: string, terminal: string): string {
  const base = normalizeBaseUrl(publicUrl);
  if (!base) throw new Error(`nfc: invalid public URL "${publicUrl}"`);
  if (!TERMINAL_ID.test(terminal)) throw new Error(`nfc: invalid terminal "${terminal}"`);
  return `${base}/t/${terminal}`;
}

/** NDEF URI identifier codes (NFC Forum RTD-URI) for the prefixes we produce. */
const URI_PREFIXES: readonly [string, number][] = [
  ["https://www.", 0x02],
  ["http://www.", 0x01],
  ["https://", 0x04],
  ["http://", 0x03],
];

/** URI record payload: one prefix-code byte + the rest of the URL in UTF-8. */
export function uriPayload(url: string): number[] {
  const [prefix, code] = URI_PREFIXES.find(([p]) => url.startsWith(p)) ?? ["", 0x00];
  return [code, ...Array.from(new TextEncoder().encode(url.slice(prefix.length)))];
}

/** Bytes on the tag for a single short URI record wrapped in an NDEF TLV plus terminator. */
export function ndefTagBytes(url: string): number {
  const payload = uriPayload(url).length;
  const shortRecord = payload <= 255;
  const record = 1 + 1 + (shortRecord ? 1 : 4) + 1 + payload; // header, type len, payload len, "U"
  const tlvLength = record < 255 ? 1 : 3;
  return 1 + tlvLength + record + 1; // 0x03, length, record, 0xFE
}

export function fitsNtag215(url: string): boolean {
  return ndefTagBytes(url) <= NTAG215_BYTES;
}
