// test/i18n.test.ts: web locale detection, en/es dictionary parity, spoken "Received/Recibido"
// and the Accept-Language choice for the server-rendered /t/:terminal pages.
import { describe, expect, it } from "vitest";
import { createApp, pickLang } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { DEFAULT_POLICY_CONFIG, decide } from "../server/policy/rules";
import { SANDBOX_TEST_VISA } from "../shared/funding";
import { money } from "../shared/money";
import { paidAnnouncement } from "../web/src/announce";
import { DICTIONARIES, detectLocale, reasonText, speechLang, translate } from "../web/src/i18n";
import { judgeIntroKey, judgeStepKeys } from "../web/src/judge-steps";

describe("detectLocale", () => {
  it("picks Spanish for es* and English for anything else", () => {
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("ES")).toBe("es");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("pt-BR")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });

  it("lets a stored valid choice win and ignores junk", () => {
    expect(detectLocale("es-MX", "en")).toBe("en");
    expect(detectLocale("en-US", "es")).toBe("es");
    expect(detectLocale("es-AR", "fr")).toBe("es");
  });

  it("maps locales to speech tags", () => {
    expect(speechLang("en")).toBe("en-US");
    expect(speechLang("es")).toBe("es-MX");
  });
});

describe("dictionaries", () => {
  it("en and es have identical keys and no empty strings", () => {
    const en = Object.keys(DICTIONARIES.en).sort();
    expect(Object.keys(DICTIONARIES.es).sort()).toEqual(en);
    for (const d of Object.values(DICTIONARIES))
      for (const v of Object.values(d)) expect(v.trim()).not.toBe("");
  });

  it("uses the same placeholders in both languages", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(DICTIONARIES.en) as (keyof typeof DICTIONARIES.en)[])
      expect(vars(DICTIONARIES.es[key])).toEqual(vars(DICTIONARIES.en[key]));
  });

  it("interpolates variables", () => {
    expect(translate("en", "vendor.chargeAmount", { amount: "$95.00" })).toBe("Charge $95.00");
  });

  it("sandbox checkout note names the test card and carries no login credentials", () => {
    for (const locale of ["en", "es"] as const) {
      const note = translate(locale, "checkout.sandboxNote", { card: SANDBOX_TEST_VISA });
      expect(note).toContain("4012888888881881");
      expect(note).toMatch(/sandbox/i);
      expect(note).not.toMatch(/@|password|contraseña/i);
    }
  });

  it("judge script follows the PayPal mode: simulated button in mock, test card in sandbox", () => {
    expect(judgeStepKeys("mock")).toContain("judge.step3");
    expect(judgeStepKeys(undefined)).toContain("judge.step3");
    expect(judgeIntroKey("mock")).toBe("judge.intro");
    expect(judgeStepKeys("sandbox")).toContain("judge.step3Sandbox");
    expect(judgeStepKeys("sandbox")).not.toContain("judge.step3");
    expect(judgeIntroKey("sandbox")).toBe("judge.introSandbox");
    for (const locale of ["en", "es"] as const) {
      const sandbox = [...judgeStepKeys("sandbox"), judgeIntroKey("sandbox")]
        .map((k) => translate(locale, k, { card: SANDBOX_TEST_VISA }))
        .join(" ");
      expect(sandbox).toContain(SANDBOX_TEST_VISA);
      expect(sandbox).toMatch(/sandbox/i);
      expect(sandbox).not.toMatch(/simulad|simulated|mock|@|password|contraseña/i);
    }
    expect(translate("en", "judge.step3Sandbox", { card: SANDBOX_TEST_VISA })).toContain(
      "Debit or Credit Card",
    );
    expect(translate("en", "judge.step3")).toContain("Pay (simulated)");
    expect(translate("es", "judge.step3")).toContain("Pagar (simulado)");
  });

  it("announces payment in both languages", () => {
    expect(paidAnnouncement(money(9500, "MXN"), "en")).toBe("Received: 95 pesos");
    expect(paidAnnouncement(money(9500, "MXN"), "es")).toBe("Recibido: 95 pesos");
    expect(paidAnnouncement(money(150, "MXN"), "es")).toBe("Recibido: 1 peso con 50 centavos");
  });
});

describe("Accept-Language on /t/:terminal", () => {
  it("ranks languages by q", () => {
    expect(pickLang(undefined)).toBe("en");
    expect(pickLang("es-MX,es;q=0.9")).toBe("es");
    expect(pickLang("en-US,es;q=0.8")).toBe("en");
    expect(pickLang("fr-FR,es;q=0.7,en;q=0.5")).toBe("es");
    expect(pickLang("de-DE")).toBe("en");
  });

  it("renders English by default and Spanish when preferred", async () => {
    const app = createApp({ paypal: new MockPayPal() });
    const en = await app.request("/t/rosa-01");
    const enText = await en.text();
    expect(enText).toContain('lang="en"');
    expect(enText).toContain("There is no open sale");
    const es = await app.request("/t/rosa-01", { headers: { "Accept-Language": "es-MX" } });
    const esText = await es.text();
    expect(esText).toContain('lang="es-MX"');
    expect(esText).toContain("No hay una venta abierta");
  });
});

describe("policy reason codes", () => {
  it("localizes REFUND_OVER_CAP from code + params in both languages", () => {
    const d = decide(
      {
        kind: "refund",
        saleId: "s1",
        captureId: "c1",
        amount: money(50000, "MXN"),
        capturedAt: "2026-10-06T12:00:00Z",
        capturedAmount: money(90000, "MXN"),
        alreadyRefunded: money(0, "MXN"),
      },
      {
        actor: "vendor",
        pinVerified: true,
        now: new Date("2026-10-06T12:05:00Z"),
        refundedToday: money(0, "MXN"),
        paidOutToday: money(0, "MXN"),
        config: DEFAULT_POLICY_CONFIG,
        vendorName: "Rosa",
      },
    );
    expect(d).toMatchObject({ allow: false, code: "REFUND_OVER_CAP" });
    expect(reasonText(d.code, d.params, undefined, "en")).toBe(
      "The maximum per refund is $200.00 MXN; you asked for $500.00 MXN.",
    );
    expect(reasonText(d.code, d.params, undefined, "es")).toContain("$200.00 MXN");
    expect(reasonText("NOT_A_CODE", undefined, "fallback", "en")).toBe("fallback");
  });
});

describe("audit reason codes", () => {
  it("every PIN/commit/release audit code has text in both languages", () => {
    for (const code of [
      "PIN_OK",
      "PIN_WRONG",
      "PIN_LOCKED",
      "COMMITTED",
      "RELEASED",
      "TICKET_INVALID",
    ]) {
      expect(reasonText(code, undefined, undefined, "en")).toBeTruthy();
      expect(reasonText(code, undefined, undefined, "es")).toBeTruthy();
      expect(reasonText(code, undefined, undefined, "en")).not.toBe(
        reasonText(code, undefined, undefined, "es"),
      );
    }
  });
});
