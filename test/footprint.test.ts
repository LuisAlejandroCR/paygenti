// test/footprint.test.ts: financial footprint — indicator math (no score), statement parsing (CSV
// layouts, OFX/QFX, malformed files), PII never kept, provenance labels in the signed passport,
// PIN-gated import/delete over HTTP, and Postgres persistence of the aggregates via PGlite.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { PostgresStore } from "../server/db/postgres";
import { computeFootprint, type FootprintSale } from "../server/footprint";
import { buildPassport, PassportSigner } from "../server/passport";
import { MockPayPal } from "../server/paypal/mock";
import { SalesService } from "../server/sales";
import {
  MAX_STATEMENT_BYTES,
  MAX_STATEMENT_ROWS,
  normaliseAmount,
  parseStatement,
  StatementError,
} from "../server/statement";
import { MemoryStore, type Store } from "../server/store";
import {
  type SignedPassport,
  STATEMENT_LABEL,
  VERIFIED_LABEL,
  verifyPassport,
} from "../shared/passport";
import { newPglite, pgliteClient } from "./pglite";

const enc = (s: string) => new TextEncoder().encode(s);
const sale = (p: Partial<FootprintSale>): FootprintSale => ({
  day: "2026-09-10",
  currency: "MXN",
  method: "paypal",
  captured: true,
  total: 1000,
  refunded: 0,
  ...p,
});
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StatementError ? e.code : `other:${(e as Error).message}`;
  }
  return "no error";
};

describe("computeFootprint", () => {
  it("describes activity without combining it into a score", () => {
    const f = computeFootprint({
      to: "2026-09-30",
      sales: [
        sale({ day: "2026-07-01", total: 2000 }),
        sale({ day: "2026-07-02", total: 1000, refunded: 500 }),
        sale({ day: "2026-08-15", total: 4000 }),
        sale({ day: "2026-09-29", total: 1000 }),
        sale({ day: "2026-09-29", total: 700, currency: "USD" }),
        sale({ day: "2026-09-20", method: "cash", captured: false, total: 99999 }),
        sale({ day: "2026-09-21", captured: false, total: 88888 }),
        sale({ day: "2026-10-05", total: 77777 }),
      ],
      statement: [],
    });
    expect(f.verified.label).toBe(VERIFIED_LABEL);
    expect(f.verified.daysActive).toBe(4);
    expect(f.verified.firstSaleDay).toBe("2026-07-01");
    expect(f.verified.lastSaleDay).toBe("2026-09-29");
    expect(f.verified.monthsSelling).toBe(3);
    // 2026-07-01..2026-09-30 is 92 days -> 14 weeks; sales in weeks 0, 6 and 12.
    expect(f.verified.totalWeeks).toBe(14);
    expect(f.verified.activeWeeks).toBe(3);
    // Currencies never mixed: MXN and USD are separate series.
    expect(f.verified.monthly).toEqual([
      { month: "2026-07", currency: "MXN", count: 2, net: 2500 },
      { month: "2026-08", currency: "MXN", count: 1, net: 4000 },
      { month: "2026-09", currency: "MXN", count: 1, net: 1000 },
      { month: "2026-09", currency: "USD", count: 1, net: 700 },
    ]);
    expect(f.verified.trend).toEqual([
      { currency: "MXN", direction: "down" },
      { currency: "USD", direction: "n/a" },
    ]);
    expect(f.disclaimer).toMatch(/not a credit score/i);
    expect(JSON.stringify(f)).not.toMatch(/score"|rating|grade/i);
    expect(f.savingsGoal).toBeNull();
  });

  it("is empty, not zero-judged, with no sales, and reports goal progress", () => {
    const f = computeFootprint({
      to: "2026-09-30",
      sales: [],
      statement: [],
      goal: { currency: "MXN", target: 100000, saved: 25050 },
    });
    expect(f.verified).toMatchObject({ daysActive: 0, monthsSelling: 0, totalWeeks: 0 });
    expect(f.savingsGoal).toMatchObject({ progressPercent: 25, label: "set by the vendor" });
    const over = computeFootprint({
      to: "2026-09-30",
      sales: [],
      statement: [],
      goal: { currency: "MXN", target: 100, saved: 500 },
    });
    expect(over.savingsGoal?.progressPercent).toBe(100);
  });
});

describe("parseStatement CSV", () => {
  it("reads date/amount with commas and ISO dates, keeping only monthly inflows", () => {
    const csv = [
      "Date,Description,Amount,Balance,Account",
      '2026-08-03,"Transfer from JUAN PEREZ, ref 123",1500.50,9000.00,0123456789',
      "2026-08-10,Rent,-4000.00,5000.00,0123456789",
      '2026-08-20,Deposit,"1,000.00",6000.00,0123456789',
      "2026-09-01,Deposit,250,6250,0123456789",
    ].join("\n");
    const r = parseStatement(enc(csv), "MXN");
    expect(r.months).toEqual([
      { month: "2026-08", currency: "MXN", inflow: 250050, count: 2 },
      { month: "2026-09", currency: "MXN", inflow: 25000, count: 1 },
    ]);
    expect(r.transactions).toBe(4);
    // PII: nothing from descriptions, names or account numbers survives.
    const out = JSON.stringify(r);
    for (const leak of ["JUAN", "PEREZ", "0123456789", "Rent", "Transfer", "ref 123"])
      expect(out).not.toContain(leak);
    expect(Object.keys(r.months[0] ?? {}).sort()).toEqual(["count", "currency", "inflow", "month"]);
  });

  it("reads semicolons, dd/mm/yyyy, decimal commas and debit/credit columns", () => {
    const csv = [
      "Banco Ejemplo - Estado de cuenta",
      "Titular: MARIA LOPEZ;Cuenta: 9876543210",
      "Fecha;Concepto;Cargo;Abono;Saldo",
      "05/09/2026;Pago proveedor;1.200,00;;3.000,00",
      "07/09/2026;SPEI recibido ANA;;2.345,67;5.345,67",
      "28/09/2026;Venta;;100,00;5.445,67",
      "13/10/2026;Venta;;50;5.495,67",
    ].join("\r\n");
    const r = parseStatement(enc(csv), "MXN");
    expect(r.months).toEqual([
      { month: "2026-09", currency: "MXN", inflow: 244567, count: 2 },
      { month: "2026-10", currency: "MXN", inflow: 5000, count: 1 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/MARIA|9876543210|ANA|proveedor/);
  });

  it("detects mm/dd when a day above 12 only fits that order, and per-row currency", () => {
    const csv = "Posted Date,Amount,Currency\n09/25/2026,10.00,usd\n10/01/2026,5.00,USD\n";
    expect(parseStatement(enc(csv), "MXN").months).toEqual([
      { month: "2026-09", currency: "USD", inflow: 1000, count: 1 },
      { month: "2026-10", currency: "USD", inflow: 500, count: 1 },
    ]);
  });

  it("skips unreadable rows and fails clearly on bad files", () => {
    const r = parseStatement(
      enc("date,amount\n2026-09-01,10\nnot a date,5\n2026-13-01,1\n2026-09-02,abc\n"),
      "MXN",
    );
    expect(r.skipped).toBe(3);
    expect(r.months).toEqual([{ month: "2026-09", currency: "MXN", inflow: 1000, count: 1 }]);

    expect(codeOf(() => parseStatement(new Uint8Array(), "MXN"))).toBe("STATEMENT_EMPTY");
    expect(codeOf(() => parseStatement(enc("   \n\n"), "MXN"))).toBe("STATEMENT_EMPTY");
    expect(codeOf(() => parseStatement(new Uint8Array(MAX_STATEMENT_BYTES + 1), "MXN"))).toBe(
      "STATEMENT_TOO_LARGE",
    );
    expect(codeOf(() => parseStatement(new Uint8Array([0x50, 0x4b, 0, 3, 4]), "MXN"))).toBe(
      "STATEMENT_UNREADABLE",
    );
    expect(codeOf(() => parseStatement(enc("hello world"), "MXN"))).toBe("STATEMENT_UNREADABLE");
    expect(codeOf(() => parseStatement(enc("name,amount\nx,1"), "MXN"))).toBe(
      "STATEMENT_NO_DATE_COLUMN",
    );
    expect(codeOf(() => parseStatement(enc("date,memo\n2026-09-01,x"), "MXN"))).toBe(
      "STATEMENT_NO_AMOUNT_COLUMN",
    );
    expect(codeOf(() => parseStatement(enc("date,amount\nbad,bad"), "MXN"))).toBe(
      "STATEMENT_NO_TRANSACTIONS",
    );
    expect(codeOf(() => parseStatement(enc("date,amount,currency\n2026-09-01,1,XYZ"), "MXN"))).toBe(
      "STATEMENT_BAD_CURRENCY",
    );
    const many = `date,amount\n${"2026-09-01,1\n".repeat(MAX_STATEMENT_ROWS + 1)}`;
    expect(codeOf(() => parseStatement(enc(many), "MXN"))).toBe("STATEMENT_TOO_MANY_ROWS");
    expect(codeOf(() => parseStatement(enc('date,amount\n"2026-09-01,"1'), "MXN"))).not.toMatch(
      /^other/,
    );
  });

  it("normalises amount formats", () => {
    expect(normaliseAmount("1.234,56", true)).toBe("1234.56");
    expect(normaliseAmount("1,234.56", false)).toBe("1234.56");
    expect(normaliseAmount("(12.00)", false)).toBe("-12.00");
    expect(normaliseAmount("$ -5", false)).toBe("-5");
    expect(normaliseAmount("12-", false)).toBe("-12");
    expect(normaliseAmount("", false)).toBeUndefined();
    expect(normaliseAmount("1-2", false)).toBeUndefined();
  });
});

describe("parseStatement OFX/QFX", () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>121000248<ACCTID>555566667777<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260905120000[-5:EST]<TRNAMT>125.40<FITID>1<NAME>ACME PAYROLL<MEMO>secret memo
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260906<TRNAMT>-40.00<FITID>2<NAME>GROCERY
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261001<TRNAMT>10,5<FITID>3<NAME>JOHN DOE
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>garbage<TRNAMT>1<FITID>4
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("reads SGML OFX with its currency and drops everything else", () => {
    const r = parseStatement(enc(sgml), "MXN");
    expect(r.months).toEqual([
      { month: "2026-09", currency: "USD", inflow: 12540, count: 1 },
      { month: "2026-10", currency: "USD", inflow: 1050, count: 1 },
    ]);
    expect(r.skipped).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/ACME|JOHN|555566667777|121000248|memo|GROCERY/);
  });

  it("reads XML OFX 2.x and rejects OFX without statements", () => {
    const xml = `<?xml version="1.0"?><?OFX OFXHEADER="200"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>MXN</CURDEF><BANKTRANLIST><STMTTRN><DTPOSTED>20260902</DTPOSTED><TRNAMT>300.00</TRNAMT><NAME>X</NAME></STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    expect(parseStatement(enc(xml), "USD").months).toEqual([
      { month: "2026-09", currency: "MXN", inflow: 30000, count: 1 },
    ]);
    expect(codeOf(() => parseStatement(enc("<OFX></OFX>"), "MXN"))).toBe("STATEMENT_UNREADABLE");
  });
});

describe("passport provenance", () => {
  it("signs verified and self-reported footprint blocks separately labelled", async () => {
    const signer = PassportSigner.ephemeral();
    const report = buildPassport({
      vendor: { id: "rosa", name: "Rosa" },
      currency: "MXN",
      timeZone: "America/Mexico_City",
      from: "2026-09-01",
      to: "2026-09-30",
      issuedAt: "2026-09-30T12:00:00.000Z",
      demoKey: true,
      sales: [{ day: "2026-09-10", method: "paypal", captured: true, total: 5000, refunded: 0 }],
      statement: [{ month: "2026-09", currency: "MXN", inflow: 900000, count: 12 }],
      goal: { currency: "MXN", target: 10000, saved: 5000 },
    });
    expect(report.version).toBe(2);
    const fp = report.footprint;
    expect(fp?.verified.label).toBe("verified");
    expect(fp?.selfReported.label).toBe(STATEMENT_LABEL);
    expect(STATEMENT_LABEL).toBe("self-reported, not verified");
    // Imported inflows never leak into verified totals.
    expect(report.verified.net).toBe(5000);
    expect(fp?.verified.monthly).toEqual([
      { month: "2026-09", currency: "MXN", count: 1, net: 5000 },
    ]);
    const signed = signer.sign(report);
    expect(await verifyPassport(signed, signer.publicKeyRaw)).toBe(true);
    const relabel = structuredClone(signed);
    (relabel.report.footprint as { selfReported: { label: string } }).selfReported.label =
      "verified";
    expect(await verifyPassport(relabel, signer.publicKeyRaw)).toBe(false);
    const inflate = structuredClone(signed);
    const m = inflate.report.footprint?.selfReported.monthly[0];
    if (m) m.inflow += 1;
    expect(await verifyPassport(inflate, signer.publicKeyRaw)).toBe(false);
  });
});

async function harness(store: Store = new MemoryStore()) {
  const paypal = new MockPayPal();
  const app = createApp({ paypal, vendorPin: "4321", sales: new SalesService({ store, paypal }) });
  const login = await app.request("/api/backoffice/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "4321" }),
  });
  const { token } = (await login.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };
  const upload = (
    content: BlobPart,
    pin?: string,
    name = "statement.csv",
    headers: Record<string, string> = auth,
  ) => {
    const form = new FormData();
    form.set("file", new File([content], name));
    if (pin !== undefined) form.set("pin", pin);
    return app.request("/api/backoffice/statement", { method: "POST", headers, body: form });
  };
  return { app, auth, upload, paypal };
}

const SAMPLE =
  "Fecha;Concepto;Abono;Cargo\n01/09/2026;SPEI de LUIS GOMEZ cta 0011223344;1.500,00;\n";

describe("statement routes", () => {
  it("needs a session and the PIN; wrong PIN is refused", async () => {
    const { upload, app } = await harness();
    expect((await upload(SAMPLE, "4321", "s.csv", {})).status).toBe(401);
    const noPin = await upload(SAMPLE);
    expect(noPin.status).toBe(403);
    expect(await noPin.json()).toEqual({ error: "PIN_REQUIRED" });
    const wrong = await upload(SAMPLE, "0000");
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "PIN_WRONG" });
    expect((await app.request("/api/backoffice/footprint")).status).toBe(401);
  });

  it("imports, shows provenance in the passport, and deletes with the PIN", async () => {
    const { upload, app, auth } = await harness();
    const logs: unknown[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a: unknown[]) => void logs.push(a);
    let res: Response;
    try {
      res = await upload(SAMPLE, "4321");
    } finally {
      Object.assign(console, orig);
    }
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/LUIS|GOMEZ|0011223344|SPEI/);
    expect(JSON.stringify(logs)).not.toMatch(/LUIS|GOMEZ|0011223344/);
    expect(JSON.parse(body).statement).toEqual([
      { month: "2026-09", currency: "MXN", inflow: 150000, count: 1 },
    ]);

    const goal = await app.request("/api/backoffice/savings-goal", {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ targetMinor: 200000, savedMinor: 50000 }),
    });
    expect(goal.status).toBe(200);

    const pass = await app.request("/api/backoffice/passport", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{}",
    });
    const p = (await pass.json()) as SignedPassport;
    expect(p.report.footprint?.selfReported).toMatchObject({
      label: "self-reported, not verified",
      monthly: [{ month: "2026-09", inflow: 150000 }],
    });
    expect(p.report.footprint?.savingsGoal?.progressPercent).toBe(25);
    expect(p.report.verified.net).toBe(0);

    const bad = await upload("\u0000\u0001binary", "4321", "x.ofx");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "STATEMENT_UNREADABLE" });
    const big = await upload(new Uint8Array(MAX_STATEMENT_BYTES + 10), "4321");
    expect(big.status).toBe(413);

    const noPinDelete = await app.request("/api/backoffice/statement/remove", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(noPinDelete.status).toBe(403);
    const del = await app.request("/api/backoffice/statement/remove", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "4321" }),
    });
    expect(await del.json()).toEqual({ removed: 1 });
    const fp = await (await app.request("/api/backoffice/footprint", { headers: auth })).json();
    expect(fp).toMatchObject({ statement: [], goal: { target: 200000, saved: 50000 } });
  });
});

describe("Postgres persistence", () => {
  it("keeps statement aggregates and the goal across a restart, and deletes them", async () => {
    const db = newPglite();
    const a = await PostgresStore.open(pgliteClient(db));
    a.saveStatementMonths("rosa", [
      { month: "2026-08", currency: "MXN", inflow: 100, count: 1 },
      { month: "2026-09", currency: "USD", inflow: 200, count: 2 },
    ]);
    a.saveStatementMonths("rosa", [{ month: "2026-08", currency: "MXN", inflow: 300, count: 3 }]);
    a.saveSavingsGoal("rosa", { currency: "MXN", target: 1000, saved: 10 });
    await a.flush();
    expect(a.writeErrors).toBe(0);

    const b = await PostgresStore.open(pgliteClient(db));
    expect(b.statementMonths("rosa")).toEqual([
      { month: "2026-08", currency: "MXN", inflow: 300, count: 3 },
      { month: "2026-09", currency: "USD", inflow: 200, count: 2 },
    ]);
    expect(b.savingsGoal("rosa")).toEqual({ currency: "MXN", target: 1000, saved: 10 });
    const cols = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'statement_months'",
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual([
      "currency",
      "inflow_count",
      "inflow_minor",
      "month",
      "vendor_id",
    ]);

    expect(b.deleteStatementMonths("rosa")).toBe(2);
    b.saveSavingsGoal("rosa", undefined);
    await b.flush();
    const c = await PostgresStore.open(pgliteClient(db));
    expect(c.statementMonths("rosa")).toEqual([]);
    expect(c.savingsGoal("rosa")).toBeUndefined();
  }, 30_000);
});
