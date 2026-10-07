// src/lib/terminal-stream.ts: live connection to GET /api/terminals/:id/events with react-native-sse
// (React Native has no EventSource). Reconnects with backoff on error, dedupes replayed events via
// EventDeduper and reports online/offline. Returns a function that closes everything.
import type { TerminalEvent } from "@shared/types";
import EventSource from "react-native-sse";
import { backoffMs, EventDeduper, parseEvent } from "./feed";

type EventName = TerminalEvent["type"] | "ping";
const NAMES: TerminalEvent["type"][] = [
  "sale.open",
  "sale.paid",
  "sale.failed",
  "sale.expired",
  "sale.cancelled",
  "sale.refunded",
];

export interface StreamHandlers {
  onEvent: (e: TerminalEvent) => void;
  onStatus?: (online: boolean) => void;
}

export function connectTerminal(
  baseUrl: string,
  terminal: string,
  handlers: StreamHandlers,
  deduper = new EventDeduper(),
): () => void {
  let source: EventSource<EventName> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;

  const open = () => {
    if (closed) return;
    // pollingInterval 0: we own reconnection (with backoff) instead of the library's fixed retry.
    const es = new EventSource<EventName>(
      `${baseUrl}/api/terminals/${encodeURIComponent(terminal)}/events`,
      { pollingInterval: 0, timeoutBeforeConnection: 0 },
    );
    source = es;
    es.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatus?.(true);
    });
    for (const name of NAMES) {
      es.addEventListener(name, (msg) => {
        const event = parseEvent(msg.data);
        if (event && deduper.accept(event)) handlers.onEvent(event);
      });
    }
    es.addEventListener("error", () => {
      handlers.onStatus?.(false);
      es.removeAllEventListeners();
      es.close();
      if (closed) return;
      timer = setTimeout(open, backoffMs(attempt++));
    });
  };

  open();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    source?.removeAllEventListeners();
    source?.close();
  };
}
