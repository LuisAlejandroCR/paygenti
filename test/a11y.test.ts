// test/a11y.test.ts: voice-first mode logic — spoken es/en phrases map to vendor commands, and every
// sale state has its own tone pattern so a blind vendor can tell them apart without words.
import { describe, expect, it } from "vitest";
import { parseCommand, SOUNDS } from "../web/src/a11y";

describe("parseCommand", () => {
  it("understands Spanish and English commands", () => {
    expect(parseCommand("Cobrar")).toEqual({ type: "charge" });
    expect(parseCommand("charge")).toEqual({ type: "charge" });
    expect(parseCommand("cancelar")).toEqual({ type: "cancel" });
    expect(parseCommand("más tiempo")).toEqual({ type: "extend" });
    expect(parseCommand("more time please")).toEqual({ type: "extend" });
    expect(parseCommand("nueva venta")).toEqual({ type: "newSale" });
    expect(parseCommand("repite")).toEqual({ type: "repeat" });
  });

  it("reads an amount alone or after charge", () => {
    expect(parseCommand("cobra 45")).toEqual({ type: "amount", value: "45" });
    expect(parseCommand("charge 12.50")).toEqual({ type: "amount", value: "12.50" });
    expect(parseCommand("95 pesos")).toEqual({ type: "amount", value: "95" });
  });

  it("returns nothing for noise", () => {
    expect(parseCommand("")).toBeUndefined();
    expect(parseCommand("hola qué tal")).toBeUndefined();
  });
});

describe("SOUNDS", () => {
  it("gives every sale state a different tone pattern", () => {
    const patterns = Object.values(SOUNDS).map((p) => JSON.stringify(p));
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});
