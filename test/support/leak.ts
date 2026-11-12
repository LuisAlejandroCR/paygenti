// test/support/leak.ts: finds a secret (PIN) written into a value tree such as the audit log.
// Walks keys and leaf values instead of searching JSON text, and ignores UUIDs, so a random
// ticket id like "32b43212-…" can never match a 4-digit PIN by chance.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Paths ("$.a[0].b") where `secret` appears as a whole value or a whole word inside a string. */
export function leaksOf(value: unknown, secret: string): string[] {
  const word = new RegExp(`(?<![0-9a-z])${escape(secret)}(?![0-9a-z])`, "i");
  const hits: string[] = [];
  const has = (s: string) => word.test(s.replace(UUID, ""));
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (has(v)) hits.push(path);
    } else if (typeof v === "number" || typeof v === "bigint") {
      if (String(v) === secret) hits.push(path);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (has(k)) hits.push(`${path}.${k} (key)`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(value, "$");
  return hits;
}
