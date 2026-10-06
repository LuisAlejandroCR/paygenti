// web/src/soundbox-logic.ts: pure state for the soundbox — maps terminal SSE events to a screen,
// decides when to announce (each paid sale id at most once, remembered in sessionStorage so a
// reconnect or reload never re-announces) and the reconnect backoff. No DOM; tested in Node.
import type { Money } from "../../shared/money";
import type { Sale, TerminalEvent } from "../../shared/types";

export type SoundboxView =
  | { kind: "idle" }
  | { kind: "open" | "paid" | "failed" | "expired" | "cancelled" | "refunded"; sale: Sale };

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "paygent.soundbox.announced";

/** Sale ids already announced; storage failures degrade to memory only. */
export class AnnouncedSales {
  private ids: string[];

  constructor(
    private readonly storage?: KeyValue,
    private readonly max = 100,
  ) {
    this.ids = [];
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this.ids = parsed.filter((x) => typeof x === "string");
    } catch {
      this.ids = [];
    }
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  /** True the first time an id is claimed; false for every repeat. */
  claim(id: string): boolean {
    if (this.has(id)) return false;
    this.ids = [...this.ids, id].slice(-this.max);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.ids));
    } catch {
      // Storage full or blocked: still deduped for this page's lifetime.
    }
    return true;
  }
}

/** sessionStorage when the browser allows it, otherwise undefined. */
export function sessionStore(): KeyValue | undefined {
  try {
    return (globalThis as { sessionStorage?: KeyValue }).sessionStorage;
  } catch {
    return undefined;
  }
}

/** Next screen for an event plus the amount to announce, if any (only server-confirmed paid). */
export function applyEvent(
  view: SoundboxView,
  event: TerminalEvent,
  announced: AnnouncedSales,
): { view: SoundboxView; announce?: Money } {
  switch (event.type) {
    case "sale.open":
      return { view: { kind: "open", sale: event.sale } };
    case "sale.paid":
      return {
        view: { kind: "paid", sale: event.sale },
        announce: announced.claim(event.sale.id) ? event.sale.total : undefined,
      };
    case "sale.failed":
      return { view: { kind: "failed", sale: event.sale } };
    case "sale.expired":
      return { view: { kind: "expired", sale: event.sale } };
    case "sale.cancelled":
      return { view: { kind: "cancelled", sale: event.sale } };
    case "sale.refunded":
      return { view: { kind: "refunded", sale: event.sale } };
    default:
      return { view };
  }
}

/** 1s, 2s, 4s… capped at 30s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}
