// server/policy/audit.ts: append-only audit log of every policy event (in memory, optionally
// mirrored to a Store so it survives restarts).
// Entries are deep-frozen copies; any field that looks like a PIN or secret is stripped before
// storing, so even a hostile action carrying `{ pin: "1234" }` never lands in the log.

export type AuditEvent = "decide" | "commit" | "release" | "pin" | "catalog" | "vendor";

export interface AuditEntry {
  seq: number;
  at: string;
  event: AuditEvent;
  actor: string;
  action: unknown;
  decision: { allow: boolean; code: string; reason: string };
}

const SECRET_KEY = /pin|password|secret|token|passcode/i;

export class AuditLog {
  readonly #entries: AuditEntry[] = [];
  readonly #onAppend?: (entry: AuditEntry) => void;

  /** `initial`: entries loaded from storage; `onAppend`: persists each new entry. */
  constructor(
    opts: { initial?: readonly AuditEntry[]; onAppend?: (entry: AuditEntry) => void } = {},
  ) {
    for (const e of opts.initial ?? []) this.#entries.push(deepFreeze(structuredClone(e)));
    this.#onAppend = opts.onAppend;
  }

  append(entry: Omit<AuditEntry, "seq">): AuditEntry {
    const stored = deepFreeze({
      seq: (this.#entries.at(-1)?.seq ?? 0) + 1,
      at: entry.at,
      event: entry.event,
      actor: String(entry.actor),
      action: redact(entry.action),
      decision: {
        allow: entry.decision.allow,
        code: entry.decision.code,
        reason: entry.decision.reason,
      },
    }) as AuditEntry;
    this.#entries.push(stored);
    this.#onAppend?.(stored);
    return stored;
  }

  /** A snapshot; mutating the returned array does not touch the log. */
  entries(): readonly AuditEntry[] {
    return [...this.#entries];
  }

  get size(): number {
    return this.#entries.length;
  }
}

/** JSON round-trip (drops functions, cycles fail closed) with secret-looking keys removed. */
export function redact(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(
      JSON.stringify(value, (key, v) => (key !== "" && SECRET_KEY.test(key) ? undefined : v)),
    );
  } catch {
    return "[unserializable]";
  }
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
