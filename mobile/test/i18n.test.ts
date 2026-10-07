// test/i18n.test.ts: English and Spanish dictionaries have the same keys, no empty strings and the
// same {placeholders}; locale detection and interpolation behave.
import { DICTIONARIES, detectLocale, type Key, speechLang, translate } from "@/lib/i18n";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n parity", () => {
  const en = DICTIONARIES.en;
  const es = DICTIONARIES.es;

  it("has the same keys in both languages", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty strings and matching placeholders", () => {
    for (const key of Object.keys(en) as Key[]) {
      expect(en[key].trim()).not.toBe("");
      expect(es[key].trim()).not.toBe("");
      expect(placeholders(es[key])).toEqual(placeholders(en[key]));
    }
  });
});

describe("locale helpers", () => {
  it("detects Spanish tags only", () => {
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("es_419")).toBe("es");
    expect(detectLocale("es")).toBe("es");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("est")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });

  it("interpolates and picks speech tags", () => {
    expect(translate("es", "sale.chargeAmount", { amount: "$95.00 MXN" })).toBe(
      "Cobrar $95.00 MXN",
    );
    expect(speechLang("es")).toBe("es-MX");
    expect(speechLang("en")).toBe("en-US");
  });
});
