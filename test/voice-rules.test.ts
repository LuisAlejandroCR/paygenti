// test/voice-rules.test.ts: battery of dictated Spanish orders against the rules parser.
// Plan requires >= 9/10 exact carts; every line must come from the catalog.
import { describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "../server/voice/demo-catalog";
import { parseOrder } from "../server/voice/rules";

type Cart = Record<string, number>;

const BATTERY: Array<[string, Cart]> = [
  ["dos de rajas y un atole", { "tamal-rajas": 2, atole: 1 }],
  ["media docena de mole", { "tamal-mole": 6 }],
  ["tres tamales dulces, dos champurrados", { "tamal-dulce": 3, champurrado: 2 }],
  ["uno de rajas, uno de mole y un atole", { "tamal-rajas": 1, "tamal-mole": 1, atole: 1 }],
  ["4 rajas", { "tamal-rajas": 4 }],
  ["un atole y otro atole", { atole: 2 }],
  ["Dáme UNA docena de tamales de mole, por favor", { "tamal-mole": 12 }],
  ["un par de atoles más un champurrado", { atole: 2, champurrado: 1 }],
  ["dos de dulce tres verdes", { "tamal-dulce": 2, "tamal-rajas": 3 }],
  ["cinco tamales de rajas con queso y dos atolitos", { "tamal-rajas": 5, atole: 2 }],
  ["un tamal de mole, otro de rajas y otro de mole", { "tamal-mole": 2, "tamal-rajas": 1 }],
  ["diez de dulce", { "tamal-dulce": 10 }],
];

function toCart(text: string): Cart {
  return Object.fromEntries(parseOrder(text, DEMO_CATALOG).lines.map((l) => [l.sku, l.qty]));
}

describe("voice rules parser", () => {
  it("scores >= 9/10 exact carts on the battery", () => {
    const misses = BATTERY.filter(([text, want]) => {
      const got = toCart(text);
      const ok =
        JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort());
      if (!ok) console.log(`MISS "${text}":`, got, "want", want);
      return !ok;
    });
    const score = BATTERY.length - misses.length;
    console.log(`voice battery: ${score}/${BATTERY.length}`);
    expect(score / BATTERY.length).toBeGreaterThanOrEqual(0.9);
  });

  it("takes names and prices only from the catalog", () => {
    const { lines } = parseOrder("dos de rajas y un atole", DEMO_CATALOG);
    for (const line of lines) {
      const item = DEMO_CATALOG.find((c) => c.sku === line.sku);
      expect(item).toBeDefined();
      expect(line.unitPrice).toEqual(item?.price);
      expect(line.name).toBe(item?.name);
    }
    expect(lines.find((l) => l.sku === "tamal-rajas")?.unitPrice.minor).toBe(2500);
  });

  it("sends unknown fragments to unmatched and invents nothing", () => {
    const res = parseOrder("dos coca colas y una torta", DEMO_CATALOG);
    expect(res.lines).toEqual([]);
    expect(res.unmatched).toEqual(["dos coca colas", "una torta"]);
  });

  it("keeps matched lines alongside garbage", () => {
    const res = parseOrder("un atole, tres hamburguesas", DEMO_CATALOG);
    expect(res.lines.map((l) => [l.sku, l.qty])).toEqual([["atole", 1]]);
    expect(res.unmatched).toEqual(["tres hamburguesas"]);
  });

  it("treats a bare 'tamales' as ambiguous", () => {
    const res = parseOrder("dos tamales", DEMO_CATALOG);
    expect(res.lines).toEqual([]);
    expect(res.unmatched).toEqual(["dos tamales"]);
  });

  it("caps quantities at 99 and ignores filler", () => {
    expect(toCart("500 atoles")).toEqual({ atole: 99 });
    expect(parseOrder("por favor", DEMO_CATALOG)).toEqual({ lines: [], unmatched: [] });
  });
});
