// test/spoken.test.ts: amounts in words for the voice box's speaker (shared/spoken.ts) — Spanish
// number rules (un/veintiún, cien/ciento, mil, millón de), English ones, cents, currency words, and
// that every word either language can say has a recorded clip in its vocabulary.
import { describe, expect, it } from "vitest";
import { type Currency, money } from "../shared/money";
import { SPOKEN_WORDS, type SpokenLang, spokenAmount } from "../shared/spoken";

const es = (minor: number, currency: Currency) => spokenAmount(money(minor, currency), "es");
const en = (minor: number, currency: Currency) => spokenAmount(money(minor, currency), "en");

describe("spokenAmount in Spanish", () => {
  it("says whole amounts with the currency word", () => {
    expect(es(4000, "MXN")).toBe("cuarenta pesos");
    expect(es(100, "MXN")).toBe("un peso");
    expect(es(2100, "MXN")).toBe("veintiún pesos");
    expect(es(3100, "MXN")).toBe("treinta y un pesos");
    expect(es(1600, "USD")).toBe("dieciséis dólares");
    expect(es(0, "MXN")).toBe("cero pesos");
  });

  it("uses cien, ciento and mil the Spanish way", () => {
    expect(es(10000, "MXN")).toBe("cien pesos");
    expect(es(10100, "MXN")).toBe("ciento un pesos");
    expect(es(125000, "MXN")).toBe("mil doscientos cincuenta pesos");
    expect(es(100000, "JPY")).toBe("cien mil yenes");
    expect(es(21000, "JPY")).toBe("veintiún mil yenes");
    expect(es(999999, "JPY")).toBe(
      "novecientos noventa y nueve mil novecientos noventa y nueve yenes",
    );
  });

  it("says millions, with «de» only for exact millions", () => {
    expect(es(1_000_000, "JPY")).toBe("un millón de yenes");
    expect(es(2_000_000, "JPY")).toBe("dos millones de yenes");
    expect(es(1_500_000, "JPY")).toBe("un millón quinientos mil yenes");
  });

  it("adds cents with «con», or says cents alone", () => {
    expect(es(8550, "MXN")).toBe("ochenta y cinco pesos con cincuenta centavos");
    expect(es(101, "MXN")).toBe("un peso con un centavo");
    expect(es(50, "USD")).toBe("cincuenta centavos");
    expect(es(1, "USD")).toBe("un centavo");
  });

  it("says only the number for a currency without a recorded word", () => {
    expect(es(500, "GBP")).toBe("cinco");
  });
});

describe("spokenAmount in English", () => {
  it("says whole amounts, singular and plural", () => {
    expect(en(4000, "MXN")).toBe("forty pesos");
    expect(en(100, "USD")).toBe("one dollar");
    expect(en(1500, "USD")).toBe("fifteen dollars");
    expect(en(0, "USD")).toBe("zero dollars");
    expect(en(700, "GBP")).toBe("seven pounds");
    expect(en(2000, "JPY")).toBe("two thousand yen");
  });

  it("says hundreds, thousands and millions without «and» inside the number", () => {
    expect(en(10500, "MXN")).toBe("one hundred five pesos");
    expect(en(125000, "MXN")).toBe("one thousand two hundred fifty pesos");
    expect(en(1_500_000, "JPY")).toBe("one million five hundred thousand yen");
  });

  it("adds cents with «and», or says cents alone", () => {
    expect(en(8550, "MXN")).toBe("eighty five pesos and fifty cents");
    expect(en(101, "USD")).toBe("one dollar and one cent");
    expect(en(50, "USD")).toBe("fifty cents");
  });

  it("says only the number for a currency without a recorded word", () => {
    expect(en(500, "SEK")).toBe("five");
  });
});

describe("SPOKEN_WORDS", () => {
  it("has a clip for every word either language can say", () => {
    const amounts = [
      ...Array.from({ length: 20_000 }, (_, i) => i),
      ...Array.from({ length: 2_000 }, (_, i) => i * 997_001),
    ];
    const missing = new Set<string>();
    for (const lang of ["es", "en"] as SpokenLang[]) {
      const vocab = new Set(SPOKEN_WORDS[lang]);
      for (const minor of amounts)
        for (const currency of ["MXN", "USD", "EUR", "BRL", "GBP"] as const)
          for (const w of spokenAmount(money(minor, currency), lang).split(" "))
            if (!vocab.has(w)) missing.add(`${lang} ${minor} ${currency}: "${w}"`);
    }
    expect([...missing]).toEqual([]);
  });
});
