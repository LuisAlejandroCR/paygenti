// server/db/sql.ts: the tiny SQL surface PostgresStore needs (query + transaction + end) and its
// node-postgres implementation: small pool, timeouts, SSL from the URL's sslmode. Tests plug PGlite
// into the same interface (test/pglite.ts), so the store code is identical in both.
import pg from "pg";

export type Row = Record<string, unknown>;

export interface SqlQuery {
  /** Parameterized only: values go in `params`, never into `text`. */
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface SqlClient extends SqlQuery {
  /** Runs `fn` inside BEGIN/COMMIT on one connection; ROLLBACK if it throws. */
  transaction<T>(fn: (tx: SqlQuery) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/** sslmode from the URL: disable/absent = plain, no-verify = TLS without CA check, else verified TLS. */
export function sslFromUrl(url: string): { connectionString: string; ssl: pg.PoolConfig["ssl"] } {
  const u = new URL(url);
  const mode =
    u.searchParams.get("sslmode") ?? (u.searchParams.get("ssl") === "true" ? "require" : null);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("ssl");
  const ssl =
    mode === null || mode === "disable"
      ? false
      : mode === "no-verify"
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true };
  return { connectionString: u.toString(), ssl };
}

export function pgClient(url: string): SqlClient {
  const { connectionString, ssl } = sslFromUrl(url);
  const pool = new pg.Pool({
    connectionString,
    ssl,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
    application_name: "paygent",
  });
  // An idle client dropped by the server (e.g. a free DB suspending) must not crash the process.
  pool.on("error", (err) => console.error(`postgres pool error: ${err.message}`));
  const query = async <R extends Row>(text: string, params?: unknown[]) => {
    const r = await pool.query(text, params);
    return { rows: r.rows as R[] };
  };
  return {
    query,
    async transaction(fn) {
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const out = await fn({
          query: async <R extends Row>(text: string, params?: unknown[]) => ({
            rows: (await conn.query(text, params)).rows as R[],
          }),
        });
        await conn.query("COMMIT");
        return out;
      } catch (err) {
        await conn.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        conn.release();
      }
    },
    end: () => pool.end(),
  };
}
