// test/leak.test.ts: the PIN-leak check used on audit logs. A random UUID that happens to contain
// the PIN must pass; the PIN as a value, a number, a word in a message or a key must fail.
import { describe, expect, it } from "vitest";
import { leaksOf } from "./support/leak";

const PIN = "4321";

describe("leaksOf", () => {
  it("ignores ids that merely contain the PIN digits", () => {
    const audit = [
      { ticket: "32b43212-9f1c-4a7e-8d2b-0c5e6f7a8b9c", seq: 14321, at: "2026-10-06T18:43:21Z" },
      { ticket: "aaaaaaaa-bbbb-4321-8ccc-dddddddddddd", ref: "SALE-43210" },
    ];
    expect(JSON.stringify(audit)).toContain(PIN); // the old check would have failed here
    expect(leaksOf(audit, PIN)).toEqual([]);
  });

  it("catches the PIN wherever it is written as a value", () => {
    expect(leaksOf([{ action: { pin: "4321" } }], PIN)).toEqual(["$[0].action.pin"]);
    expect(leaksOf({ n: 4321 }, PIN)).toEqual(["$.n"]);
    expect(leaksOf({ reason: "wrong PIN 4321 entered" }, PIN)).toEqual(["$.reason"]);
    expect(leaksOf({ reason: "pin=4321;" }, PIN)).toEqual(["$.reason"]);
    expect(leaksOf({ "4321": true }, PIN)).toEqual(["$.4321 (key)"]);
  });
});
