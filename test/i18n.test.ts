// test/i18n.test.ts: web locale detection, en/es dictionary parity, spoken "Received/Recibido"
// and the Accept-Language choice for the server-rendered /t/:terminal pages.
import { describe, expect, it } from "vitest";
import { createApp, pickLang } from "../server/app";
import { MockPayPal } from "../server/paypal/mock";
import { money } from "../shared/money";
import { paidAnnouncement } from "../web/src/announce";
import { DICTIONARIES, detectLocale, speechLang, translate } from "../web/src/i18n";

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
