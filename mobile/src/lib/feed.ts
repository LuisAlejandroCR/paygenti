// src/lib/feed.ts: pure logic for the terminal's live SSE feed — parses event payloads, drops
// duplicates a reconnect replays (the server re-sends the open sale on every connect) and computes
// the reconnect backoff. No network here; src/lib/terminal-stream.ts wires it to react-native-sse.
import type { Sale, TerminalEvent } from "@shared/types";

const TYPES = new Set<TerminalEvent["type"]>([
  "sale.open",
  "sale.paid",
  "sale.failed",
  "sale.expired",
  "sale.cancelled",
  "sale.refunded",
]);

/** JSON from an SSE `data:` line -> TerminalEvent, or undefined for pings and garbage. */
export function parseEvent(data: string | null | undefined): TerminalEvent | undefined {
  if (!data) return undefined;
  try {
    const e = JSON.parse(data) as Partial<TerminalEvent> & { sale?: Partial<Sale> };
    if (!e || !TYPES.has(e.type as TerminalEvent["type"])) return undefined;
    if (typeof e.sale?.id !== "string") return undefined;
    return e as TerminalEvent;
  } catch {
    return undefined;
  }
}

/** Identity of an event: the same transition of the same sale is the same event. */
export function eventKey(e: TerminalEvent): string {
  const extra = e.type === "sale.refunded" ? `:${e.amount.minor}` : "";
  return `${e.type}:${e.sale.id}${extra}`;
}

/** Remembers the last `max` event keys; accept() is true only the first time a key is seen. */
export class EventDeduper {
  private keys: string[] = [];

  constructor(private readonly max = 200) {}

  accept(e: TerminalEvent): boolean {
    const key = eventKey(e);
    if (this.keys.includes(key)) return false;
    this.keys = [...this.keys, key].slice(-this.max);
    return true;
  }
}

/** 1s, 2s, 4s… capped at 30s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

export type FeedView =
  | { kind: "idle" }
  | { kind: "open" | "paid" | "failed" | "expired" | "cancelled" | "refunded"; sale: Sale };

/** Next soundbox screen for an event. */
export function viewFor(e: TerminalEvent): FeedView {
  const kind = e.type.slice("sale.".length) as Exclude<FeedView["kind"], "idle">;
  return { kind, sale: e.sale };
}
