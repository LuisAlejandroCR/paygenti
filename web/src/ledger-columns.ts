// web/src/ledger-columns.ts: which ledger columns fit at a given grid width.
// Phones keep Items, Paid, Refunded and Net; wider grids add time, status, then the rest.
// Pure (no AG Grid import) so it is unit-tested in Node.

/** Columns hidden below each breakpoint (px of grid width), lowest priority first. */
const DROPS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [900, ["captureId", "terminalId"]],
  [720, ["reconciliation", "method"]],
  [520, ["status"]],
  [400, ["time"]],
];

export const OPTIONAL_COLUMNS: readonly string[] = DROPS.flatMap(([, cols]) => cols);

/** Ids of the optional columns that should be hidden at this grid width. */
export function hiddenColumns(width: number): string[] {
  return DROPS.filter(([min]) => width < min).flatMap(([, cols]) => cols);
}
