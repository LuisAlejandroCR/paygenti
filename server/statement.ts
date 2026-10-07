// server/statement.ts: bank statement import (CSV or OFX/QFX) reduced to monthly inflow aggregates.
// Only month, currency, total inflow and inflow count leave this module; account numbers, names,
// descriptions and counterparties are never copied out, stored or logged. Bad files throw StatementError.
import { decimalsOf, isPayPalCurrency } from "../shared/currency";
import type { StatementMonth } from "../shared/passport";

export const MAX_STATEMENT_BYTES = 1024 * 1024;
export const MAX_STATEMENT_ROWS = 5000;

export type StatementErrorCode =
  | "STATEMENT_EMPTY"
  | "STATEMENT_TOO_LARGE"
  | "STATEMENT_TOO_MANY_ROWS"
  | "STATEMENT_UNREADABLE"
  | "STATEMENT_NO_DATE_COLUMN"
  | "STATEMENT_NO_AMOUNT_COLUMN"
  | "STATEMENT_BAD_CURRENCY"
  | "STATEMENT_NO_TRANSACTIONS";

export class StatementError extends Error {
  constructor(readonly code: StatementErrorCode) {
    super(code);
  }
}

export interface StatementSummary {
  months: StatementMonth[];
  /** Transactions read (inflows and outflows). */
  transactions: number;
  /** Lines that could not be read (bad date or amount). */
  skipped: number;
}

interface Txn {
  day: string;
  amount: string;
  currency: string;
}

/** Parses statement bytes; `currency` applies when the file does not state one. */
export function parseStatement(bytes: Uint8Array, currency: string): StatementSummary {
  if (bytes.byteLength === 0) throw new StatementError("STATEMENT_EMPTY");
  if (bytes.byteLength > MAX_STATEMENT_BYTES) throw new StatementError("STATEMENT_TOO_LARGE");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("latin1").decode(bytes);
  }
  if (text.includes("\u0000")) throw new StatementError("STATEMENT_UNREADABLE");
  text = text.replace(/^﻿/, "");
  if (!text.trim()) throw new StatementError("STATEMENT_EMPTY");
  const isOfx = /<OFX>|OFXHEADER/i.test(text.slice(0, 4096));
  const { txns, skipped } = isOfx ? readOfx(text, currency) : readCsv(text, currency);
  return aggregate(txns, skipped);
}

function aggregate(txns: Txn[], skipped: number): StatementSummary {
  const months = new Map<string, StatementMonth>();
  let transactions = 0;
  for (const t of txns) {
    if (!isPayPalCurrency(t.currency)) throw new StatementError("STATEMENT_BAD_CURRENCY");
    const minor = toMinor(t.amount, decimalsOf(t.currency));
    if (minor === undefined) {
      skipped++;
      continue;
    }
    transactions++;
    if (minor <= 0) continue;
    const month = t.day.slice(0, 7);
    const key = `${month}|${t.currency}`;
    const m = months.get(key) ?? { month, currency: t.currency, inflow: 0, count: 0 };
    m.inflow += minor;
    m.count++;
    months.set(key, m);
  }
  if (transactions === 0) throw new StatementError("STATEMENT_NO_TRANSACTIONS");
  const sorted = [...months.values()].sort((a, b) =>
    `${a.currency}${a.month}` < `${b.currency}${b.month}` ? -1 : 1,
  );
  return { months: sorted, transactions, skipped };
}

/** Normalised decimal string ("-1234.56") to integer minor units; undefined when not a number. */
function toMinor(amount: string, decimals: number): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) return undefined;
  const value = Math.round(Number(amount) * 10 ** decimals);
  return Number.isSafeInteger(value) && Math.abs(value) < 1e13 ? value : undefined;
}

/** "1.234,56", "1,234.56", "(12.00)", "$ -5", "+3,5" → "-1234.56"-style; undefined if not money. */
export function normaliseAmount(raw: string, decimalComma: boolean): string | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,+-]/g, "");
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!s || /[+-]/.test(s)) return undefined;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) decimalSep = lastDot > lastComma ? "." : ",";
  else if (lastComma >= 0) decimalSep = decimalComma || /,\d{1,2}$/.test(s) ? "," : null;
  else if (lastDot >= 0) decimalSep = !decimalComma || /\.\d{1,2}$/.test(s) ? "." : null;
  const thousands = decimalSep === "," ? "." : ",";
  s = s.split(thousands).join("");
  if (decimalSep === ",") s = s.replace(",", ".");
  if (decimalSep === null) s = s.replace(/[.,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  return negative ? `-${s}` : s;
}

// ---------- CSV ----------

const DATE_HEADERS =
  /^(date|fecha|posted|posted date|posting date|transaction date|fecha (de )?operaci[oó]n|fecha valor|booking date|value date)$/;
const AMOUNT_HEADERS = /^(amount|importe|monto|cantidad|valor|transaction amount|amount \(.*\))$/;
const CREDIT_HEADERS =
  /^(credit|credits|abono|abonos|deposit|deposits|dep[oó]sito|dep[oó]sitos|haber|ingreso|ingresos|money in|paid in)$/;
const DEBIT_HEADERS =
  /^(debit|debits|cargo|cargos|withdrawal|withdrawals|retiro|retiros|debe|egreso|egresos|money out|paid out)$/;
const CURRENCY_HEADERS = /^(currency|moneda|divisa)$/;

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const norm = (h: string) => h.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();

function readCsv(text: string, fallbackCurrency: string): { txns: Txn[]; skipped: number } {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (lines.length - 1 > MAX_STATEMENT_ROWS) throw new StatementError("STATEMENT_TOO_MANY_ROWS");
  // Header: the first of the first 20 lines that names a date column (banks prepend titles).
  let headerAt = -1;
  let delimiter = ",";
  let cols: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 20) && headerAt < 0; i++) {
    for (const d of [";", ",", "\t", "|"]) {
      const c = splitCsvLine(lines[i] ?? "", d).map(norm);
      if (c.length > 1 && c.some((h) => DATE_HEADERS.test(h))) {
        headerAt = i;
        delimiter = d;
        cols = c;
        break;
      }
    }
  }
  if (headerAt < 0) {
    const looksTabular = [";", ",", "\t"].some((d) => splitCsvLine(lines[0] ?? "", d).length > 1);
    throw new StatementError(looksTabular ? "STATEMENT_NO_DATE_COLUMN" : "STATEMENT_UNREADABLE");
  }
  const dateCol = cols.findIndex((h) => DATE_HEADERS.test(h));
  const amountCol = cols.findIndex((h) => AMOUNT_HEADERS.test(h));
  const creditCol = cols.findIndex((h) => CREDIT_HEADERS.test(h));
  const debitCol = cols.findIndex((h) => DEBIT_HEADERS.test(h));
  const currencyCol = cols.findIndex((h) => CURRENCY_HEADERS.test(h));
  if (amountCol < 0 && creditCol < 0) throw new StatementError("STATEMENT_NO_AMOUNT_COLUMN");

  const rows = lines.slice(headerAt + 1).map((l) => splitCsvLine(l, delimiter));
  const dayOrder = detectDayOrder(rows.map((r) => r[dateCol] ?? ""));
  const decimalComma = delimiter === ";";
  const txns: Txn[] = [];
  let skipped = 0;
  for (const r of rows) {
    const day = parseDay(r[dateCol] ?? "", dayOrder);
    let amount: string | undefined;
    if (amountCol >= 0) amount = normaliseAmount(r[amountCol] ?? "", decimalComma);
    else {
      const credit = normaliseAmount(r[creditCol] ?? "", decimalComma);
      const debit = debitCol >= 0 ? normaliseAmount(r[debitCol] ?? "", decimalComma) : undefined;
      if (credit !== undefined && Number(credit) !== 0) amount = credit.replace(/^-/, "");
      else if (debit !== undefined) amount = `-${debit.replace(/^-/, "")}`;
      else amount = credit;
    }
    if (!day || amount === undefined) {
      skipped++;
      continue;
    }
    const cur = (currencyCol >= 0 && r[currencyCol]?.toUpperCase()) || fallbackCurrency;
    txns.push({ day, amount, currency: cur });
  }
  return { txns, skipped };
}

type DayOrder = "dmy" | "mdy";

/** dd/mm/yyyy unless some row only makes sense as mm/dd/yyyy (second part above 12). */
function detectDayOrder(values: string[]): DayOrder {
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v.trim());
    if (m && Number(m[2]) > 12 && Number(m[1]) <= 12) return "mdy";
  }
  return "dmy";
}

function parseDay(raw: string, order: DayOrder): string | undefined {
  const v = raw.trim();
  let y: number;
  let mo: number;
  let d: number;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(v);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:$|\s)/.exec(v))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
  } else if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(v))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else return undefined;
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1) return undefined;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return back.getUTCDate() === d ? iso : undefined;
}

// ---------- OFX / QFX (SGML 1.x and XML 2.x) ----------

function ofxValue(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m?.[1]?.trim();
}

function readOfx(text: string, fallbackCurrency: string): { txns: Txn[]; skipped: number } {
  const statements = text.split(/<STMTRS>|<CCSTMTRS>/i).slice(1);
  if (statements.length === 0) throw new StatementError("STATEMENT_UNREADABLE");
  const txns: Txn[] = [];
  let skipped = 0;
  let count = 0;
  for (const st of statements) {
    const currency = ofxValue(st, "CURDEF")?.toUpperCase() || fallbackCurrency;
    for (const block of st.split(/<STMTTRN>/i).slice(1)) {
      if (++count > MAX_STATEMENT_ROWS) throw new StatementError("STATEMENT_TOO_MANY_ROWS");
      const day = parseDay(ofxValue(block, "DTPOSTED") ?? "", "dmy");
      const amount = normaliseAmount(ofxValue(block, "TRNAMT") ?? "", false);
      if (!day || amount === undefined) {
        skipped++;
        continue;
      }
      txns.push({ day, amount, currency });
    }
  }
  return { txns, skipped };
}
