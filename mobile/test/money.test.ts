// test/money.test.ts: money on the phone goes through the repo's shared/money.ts — formatting per
// currency exponent, keypad entry, typed amounts and the spoken PAID sentence in both languages.
import { formatMoney as sharedFormat } from "@shared/money";
import { formatMoney, paidAnnouncement, parseAmount, press, toMinor } from "@/lib/money";

describe("money via shared/", () => {
  it("re-exports the shared formatter (no duplicated money logic)", () => {
    expect(formatMoney).toBe(sharedFormat);
    expect(formatMoney({ minor: 9500, currency: "MXN" })).toBe("$95.00 MXN");
    expect(formatMoney({ minor: 950, currency: "JPY" })).toBe("¥950 JPY");
    expect(formatMoney({ minor: 1050, currency: "EUR" })).toBe("€10.50 EUR");
  });

  it("builds amounts from keypad presses honouring decimals", () => {
    let d = "";
    for (const k of ["9", "5", ".", "5", "0", "0"]) d = press(d, k, 2);
    expect(d).toBe("95.50");
    expect(toMinor(d, "MXN")).toEqual({ minor: 9550, currency: "MXN" });
    expect(press("12", ".", 0)).toBe("12");
    expect(press("0", "7")).toBe("7");
    expect(press("12", "⌫")).toBe("1");
    expect(toMinor("", "MXN")).toBeUndefined();
    expect(toMinor("0", "MXN")).toBeUndefined();
    expect(toMinor("950", "JPY")).toEqual({ minor: 950, currency: "JPY" });
  });

  it("parses typed refund amounts with the shared parser", () => {
    expect(parseAmount("95,5", "MXN")).toBe(9550);
    expect(parseAmount("1.234", "MXN")).toBeUndefined();
  });

  it("speaks the paid amount in the locale", () => {
    expect(paidAnnouncement({ minor: 9500, currency: "MXN" }, "es")).toBe("Recibido: 95 pesos");
    expect(paidAnnouncement({ minor: 100, currency: "USD" }, "en")).toBe("Received: 1 dollar");
    expect(paidAnnouncement({ minor: 1050, currency: "USD" }, "es")).toBe(
      "Recibido: 10 dólares con 50 centavos",
    );
  });
});
