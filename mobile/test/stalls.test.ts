// test/stalls.test.ts: several paygents on the phone — per-stall back-office paths (Rosa keeps the
// legacy path, ids are validated), the owner sessions header and the 2+ stall switcher rule.
import { boPath, sessionsHeader, showSwitcher } from "@/lib/stalls";

describe("stalls", () => {
  it("routes the back office to the chosen stall", () => {
    expect(boPath("rosa", "/ledger")).toBe("/api/backoffice/ledger");
    expect(boPath("beto", "/ledger")).toBe("/api/stalls/beto/backoffice/ledger");
    expect(() => boPath("../x", "/ledger")).toThrow();
  });

  it("builds the owner sessions header from held tokens only", () => {
    expect(sessionsHeader({ rosa: "a", beto: undefined, luz: "c" })).toBe("rosa=a,luz=c");
    expect(sessionsHeader({ "bad id": "x" })).toBe("");
  });

  it("shows the switcher only with two or more stalls", () => {
    expect(showSwitcher([{}])).toBe(false);
    expect(showSwitcher([{}, {}])).toBe(true);
  });
});
