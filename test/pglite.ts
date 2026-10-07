// test/pglite.ts: SqlClient over PGlite (Postgres compiled to WASM, in process) so PostgresStore
// runs its real SQL in tests without Docker. Parameterless multi-statement text goes through exec().
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Row, SqlClient, SqlQuery } from "../server/db/sql";

function wrap(q: PGlite | Transaction): SqlQuery {
  return {
    async query<R extends Row>(text: string, params?: unknown[]) {
      if (!params || params.length === 0) {
        const results = await q.exec(text);
        return { rows: (results.at(-1)?.rows ?? []) as R[] };
      }
      return { rows: (await q.query<R>(text, params)).rows };
    },
  };
}

/** A shared PGlite instance; `end` is a no-op so a "restarted" store can reopen the same DB. */
export function pgliteClient(db: PGlite): SqlClient {
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    end: async () => undefined,
  };
}

export function newPglite(): PGlite {
  return new PGlite();
}
