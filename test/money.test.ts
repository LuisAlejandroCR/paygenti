// test/money.test.ts: integer-money helpers and PayPal decimal-string conversion.
import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, fromPayPalValue, money, toPayPalValue } from "../shared/money";

describe("money", () => {
  it("formats minor units as PayPal values", () => {
    expect(toPayPalValue(money(9500, "MXN"))).toBe("95.00");
    expect(toPayPalValue(money(5, "USD"))).toBe("0.05");
    expect(toPayPalValue(money(-1234, "USD"))).toBe("-12.34");
  });

  it("parses PayPal values without floats", () => {
    expect(fromPayPalValue("95.00", "MXN").minor).toBe(9500);
    expect(fromPayPalValue("0.1", "USD").minor).toBe(10);
    expect(fromPayPalValue("12", "USD").minor).toBe(1200);
    expect(() => fromPayPalValue("1.234", "USD")).toThrow();
    expect(() => fromPayPalValue("abc", "USD")).toThrow();
  });

  it("rejects non-integer minor units and mixed currencies", () => {
    expect(() => money(1.5, "MXN")).toThrow();
    expect(() => addMoney(money(1, "MXN"), money(1, "USD"))).toThrow();
    expect(addMoney(money(100, "MXN"), money(250, "MXN")).minor).toBe(350);
  });

  it("formats for display", () => {
    expect(formatMoney(money(9500, "MXN"))).toBe("$95.00 MXN");
  });
});
