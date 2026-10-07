// server/db/migrations.ts: versioned, idempotent SQL migrations run at startup.
// Each version runs once inside a transaction holding an advisory lock, so two processes booting
// together cannot apply the same step twice. Money is always integer minor units + ISO currency code.
import type { SqlClient } from "./sql";

export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE vendors (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  currency char(3) NOT NULL,
  country text,
  time_zone text,
  onboarded boolean,
  prices_need_review boolean
);
CREATE TABLE catalog_items (
  vendor_id text NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  position integer NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  names jsonb,
  aliases jsonb NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency char(3) NOT NULL,
  PRIMARY KEY (vendor_id, sku)
);
CREATE TABLE terminals (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES vendors(id),
  label text NOT NULL
);
CREATE TABLE sales (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  vendor_id text NOT NULL,
  terminal_id text NOT NULL,
  status text NOT NULL,
  method text NOT NULL,
  order_id text NOT NULL,
  capture_id text,
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  currency char(3) NOT NULL,
  lines jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX sales_capture_id ON sales (capture_id) WHERE capture_id IS NOT NULL;
CREATE INDEX sales_order_id ON sales (order_id);
CREATE INDEX sales_terminal ON sales (terminal_id, seq);
CREATE TABLE capture_refunds (
  capture_id text PRIMARY KEY,
  refunded_minor bigint NOT NULL CHECK (refunded_minor >= 0)
);
CREATE TABLE policy_usage (
  day text NOT NULL,
  currency char(3) NOT NULL,
  refunded_minor bigint NOT NULL DEFAULT 0,
  paid_out_minor bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, currency)
);
CREATE TABLE audit_log (
  seq integer PRIMARY KEY,
  at timestamptz NOT NULL,
  event text NOT NULL,
  actor text NOT NULL,
  action jsonb,
  decision jsonb NOT NULL
);
CREATE TABLE pin_state (
  id integer PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL
);`,
  },
  {
    // Payouts to suppliers: the allowlist and the payout history (amount + status per batch).
    version: 2,
    sql: `
CREATE TABLE suppliers (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  name text NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('EMAIL', 'PHONE')),
  receiver text NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX suppliers_receiver ON suppliers (recipient_type, receiver);
CREATE TABLE payouts (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  supplier_name text NOT NULL,
  recipient_type text NOT NULL,
  receiver text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  note text,
  batch_id text,
  item_id text,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX payouts_batch_id ON payouts (batch_id);`,
  },
  {
    // Financial footprint: imported statement aggregates (no file, account, name or description is
    // ever stored) and the vendor's optional savings goal.
    version: 3,
    sql: `
CREATE TABLE statement_months (
  vendor_id text NOT NULL,
  month char(7) NOT NULL,
  currency char(3) NOT NULL,
  inflow_minor bigint NOT NULL CHECK (inflow_minor >= 0),
  inflow_count integer NOT NULL CHECK (inflow_count >= 0),
  PRIMARY KEY (vendor_id, month, currency)
);
CREATE TABLE savings_goals (
  vendor_id text PRIMARY KEY,
  currency char(3) NOT NULL,
  target_minor bigint NOT NULL CHECK (target_minor > 0),
  saved_minor bigint NOT NULL CHECK (saved_minor >= 0)
);`,
  },
  {
    // Several stalls per owner: policy state, suppliers and payouts per stall (old rows = "rosa"),
    // owner MCP tokens (SHA-256 only) and Claude's refund/payout proposals awaiting the owner's PIN.
    version: 4,
    sql: `
ALTER TABLE policy_usage ADD COLUMN vendor_id text NOT NULL DEFAULT 'rosa';
ALTER TABLE policy_usage DROP CONSTRAINT policy_usage_pkey;
ALTER TABLE policy_usage ADD PRIMARY KEY (vendor_id, day, currency);
ALTER TABLE audit_log ADD COLUMN vendor_id text NOT NULL DEFAULT 'rosa';
ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey;
ALTER TABLE audit_log ADD PRIMARY KEY (vendor_id, seq);
CREATE TABLE pin_states (
  vendor_id text PRIMARY KEY,
  state jsonb NOT NULL
);
INSERT INTO pin_states (vendor_id, state) SELECT 'rosa', state FROM pin_state;
ALTER TABLE suppliers ADD COLUMN vendor_id text NOT NULL DEFAULT 'rosa';
DROP INDEX suppliers_receiver;
CREATE UNIQUE INDEX suppliers_receiver ON suppliers (vendor_id, recipient_type, receiver);
ALTER TABLE payouts ADD COLUMN vendor_id text NOT NULL DEFAULT 'rosa';
CREATE TABLE mcp_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  stalls jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE approvals (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  vendor_id text NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX approvals_vendor ON approvals (vendor_id, seq);`,
  },
];

const LOCK_KEY = 4_206_901; // arbitrary, constant advisory-lock id for paygent migrations

/** Applies pending migrations; returns the versions applied this run. */
export async function migrate(db: SqlClient): Promise<number[]> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const { rows } = await tx.query<{ version: number }>("SELECT version FROM schema_migrations");
    const done = new Set(rows.map((r) => Number(r.version)));
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await tx.query(m.sql);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
      applied.push(m.version);
    }
    return applied;
  });
}
