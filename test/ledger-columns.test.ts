// test/ledger-columns.test.ts: responsive ledger columns — phones keep Items/Paid/Refunded/Net.
import { describe, expect, it } from "vitest";
import { hiddenColumns, OPTIONAL_COLUMNS } from "../web/src/ledger-columns";

describe("hiddenColumns", () => {
  it("shows every column on a desktop-width grid", () => {
    expect(hiddenColumns(1200)).toEqual([]);
  });
  it("hides every optional column on a phone-width grid", () => {
    expect(new Set(hiddenColumns(343))).toEqual(new Set(OPTIONAL_COLUMNS));
  });
  it("never hides the money columns", () => {
    for (const w of [200, 343, 600, 800, 1000])
      for (const c of ["paid", "refunded", "net", "items"])
        expect(hiddenColumns(w)).not.toContain(c);
  });
  it("keeps time and status at tablet width", () => {
    expect(hiddenColumns(600)).not.toContain("time");
    expect(hiddenColumns(600)).not.toContain("status");
  });
});
