// server/db/postgres.ts: PostgresStore — the Store backed by Postgres (selected by DATABASE_URL).
// open() migrates and loads every row into the in-memory MemoryStore it extends, so the synchronous
// Store API is unchanged; each write is then applied to memory at once and to Postgres through one
// ordered queue, every job in its own transaction. Counters (daily cap usage, refunds per capture)
// are atomic SQL increments, so even two processes on one DB never lose an update; a unique index
// keeps one capture id per sale. close() flushes the queue (SIGTERM on Render) before exiting.
// Suppliers, payouts, MCP tokens (hash only) and Claude's approvals are loaded and written the same
// way; policy state, suppliers and payouts carry the stall's vendor_id (migration 3).
import type { Currency } from "../../shared/money";
import type { SavingsGoal, StatementMonth } from "../../shared/passport";
import type {
  Approval,
  CatalogItem,
  McpToken,
  Payout,
  Sale,
  Supplier,
  Terminal,
  Vendor,
} from "../../shared/types";
import type { AuditEntry } from "../policy/audit";
import type { PinGuardState } from "../policy/pin";
import { DEFAULT_STALL, DEMO_STALLS, MemoryStore } from "../store";
import { migrate } from "./migrations";
import type { Row, SqlClient, SqlQuery } from "./sql";

type Job = (tx: SqlQuery) => Promise<void>;

export class PostgresStore extends MemoryStore {
  readonly #db: SqlClient;
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;
  /** Writes that failed (logged); memory still holds them until the next restart. */
  writeErrors = 0;

  private constructor(db: SqlClient) {
    super();
    this.#db = db;
  }

  /** Migrates, seeds any missing demo stall, and loads every row into memory. */
  static async open(db: SqlClient): Promise<PostgresStore> {
    await migrate(db);
    const store = new PostgresStore(db);
    await db.transaction(async (tx) => {
      for (const { vendor, terminal } of DEMO_STALLS) {
        const { rows } = await tx.query("SELECT 1 FROM vendors WHERE id = $1", [vendor.id]);
        if (rows.length > 0) continue;
        await writeVendor(tx, vendor);
        await writeCatalog(tx, vendor.id, vendor.catalog);
        await tx.query(
          "INSERT INTO terminals (id, vendor_id, label) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
          [terminal.id, terminal.vendorId, terminal.label],
        );
      }
    });
    await store.#load();
    return store;
  }

  async #load(): Promise<void> {
    const db = this.#db;
    const items = await db.query("SELECT * FROM catalog_items ORDER BY vendor_id, position");
    const byVendor = new Map<string, CatalogItem[]>();
    for (const r of items.rows) {
      const list = byVendor.get(String(r.vendor_id)) ?? [];
      list.push(rowToItem(r));
      byVendor.set(String(r.vendor_id), list);
    }
    this.vendorMap.clear();
    for (const r of (await db.query("SELECT * FROM vendors ORDER BY id = 'rosa' DESC, id")).rows) {
      const v = rowToVendor(r, byVendor.get(String(r.id)) ?? []);
      this.vendorMap.set(v.id, v);
    }
    this.terminals.clear();
    for (const r of (await db.query("SELECT * FROM terminals")).rows) {
      const t: Terminal = {
        id: String(r.id),
        vendorId: String(r.vendor_id),
        label: String(r.label),
      };
      this.terminals.set(t.id, t);
    }
    this.sales.clear();
    for (const r of (await db.query("SELECT * FROM sales ORDER BY seq")).rows) {
      const s = rowToSale(r);
      this.sales.set(s.id, s);
    }
    for (const r of (await db.query("SELECT * FROM capture_refunds")).rows)
      this.refunds.set(String(r.capture_id), Number(r.refunded_minor));
    for (const r of (await db.query("SELECT * FROM policy_usage")).rows) {
      const currency = String(r.currency) as Currency;
      this.usage.set(`${r.vendor_id}|${r.day}|${currency}`, {
        currency,
        refunded: Number(r.refunded_minor),
        paidOut: Number(r.paid_out_minor),
      });
    }
    this.audit.clear();
    for (const r of (await db.query("SELECT * FROM audit_log ORDER BY vendor_id, seq")).rows)
      super.appendAudit(
        {
          seq: Number(r.seq),
          at: iso(r.at) as string,
          event: r.event as AuditEntry["event"],
          actor: String(r.actor),
          action: r.action ?? null,
          decision: r.decision as AuditEntry["decision"],
        },
        String(r.vendor_id),
      );
    this.pins.clear();
    for (const r of (await db.query("SELECT vendor_id, state FROM pin_states")).rows)
      this.pins.set(String(r.vendor_id), r.state as PinGuardState);
    this.tokenMap.clear();
    for (const r of (await db.query("SELECT * FROM mcp_tokens ORDER BY created_at")).rows) {
      const t: McpToken = {
        id: String(r.id),
        label: String(r.label),
        tokenHash: String(r.token_hash),
        stalls: r.stalls as string[],
        createdAt: iso(r.created_at) as string,
      };
      if (r.revoked_at !== null) t.revokedAt = iso(r.revoked_at);
      this.tokenMap.set(t.id, t);
    }
    this.approvalMap.clear();
    for (const r of (await db.query("SELECT data FROM approvals ORDER BY seq")).rows) {
      const a = r.data as Approval;
      this.approvalMap.set(a.id, a);
    }
    this.supplierMap.clear();
    for (const r of (await db.query("SELECT * FROM suppliers ORDER BY seq")).rows) {
      const s = rowToSupplier(r);
      this.supplierMap.set(s.id, s);
    }
    this.payoutMap.clear();
    for (const r of (await db.query("SELECT * FROM payouts ORDER BY seq")).rows) {
      const p = rowToPayout(r);
      this.payoutMap.set(p.id, p);
    }
    this.statementMap.clear();
    const months = await db.query("SELECT * FROM statement_months ORDER BY vendor_id, month");
    for (const r of months.rows)
      super.saveStatementMonths(String(r.vendor_id), [
        {
          month: String(r.month),
          currency: String(r.currency),
          inflow: Number(r.inflow_minor),
          count: Number(r.inflow_count),
        },
      ]);
    this.goalMap.clear();
    for (const r of (await db.query("SELECT * FROM savings_goals")).rows)
      this.goalMap.set(String(r.vendor_id), {
        currency: String(r.currency),
        target: Number(r.target_minor),
        saved: Number(r.saved_minor),
      });
  }

  #enqueue(what: string, job: Job): void {
    this.#pending += 1;
    this.#queue = this.#queue
      .then(() => this.#db.transaction(job))
      .catch((err: Error) => {
        this.writeErrors += 1;
        console.error(`postgres write failed (${what}): ${err.message}`);
      })
      .finally(() => {
        this.#pending -= 1;
      });
  }

  /** Writes still queued. */
  get pending(): number {
    return this.#pending;
  }

  /** Resolves once every write queued so far reached Postgres (or failed and was logged). */
  async flush(): Promise<void> {
    while (this.#pending > 0) await this.#queue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.#db.end();
  }

  override saveSale(sale: Sale): void {
    super.saveSale(sale);
    const s = structuredClone(sale);
    this.#enqueue("sale", (tx) =>
      tx
        .query(
          `INSERT INTO sales (id, vendor_id, terminal_id, status, method, order_id, capture_id,
             total_minor, currency, lines, created_at, paid_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, method = EXCLUDED.method,
             order_id = EXCLUDED.order_id, capture_id = EXCLUDED.capture_id,
             total_minor = EXCLUDED.total_minor, currency = EXCLUDED.currency, lines = EXCLUDED.lines,
             paid_at = EXCLUDED.paid_at, expires_at = EXCLUDED.expires_at`,
          [
            s.id,
            s.vendorId,
            s.terminalId,
            s.status,
            s.method,
            s.orderId,
            s.captureId ?? null,
            s.total.minor,
            s.total.currency,
            JSON.stringify(s.lines),
            s.createdAt,
            s.paidAt ?? null,
            s.expiresAt,
          ],
        )
        .then(() => undefined),
    );
  }

  override setCatalog(vendorId: string, catalog: CatalogItem[]): void {
    super.setCatalog(vendorId, catalog);
    const items = structuredClone(catalog);
    this.#enqueue("catalog", async (tx) => {
      await writeCatalog(tx, vendorId, items);
      await tx.query("UPDATE vendors SET prices_need_review = false WHERE id = $1", [vendorId]);
    });
  }

  override updateVendor(vendorId: string, patch: Partial<Omit<Vendor, "id">>): Vendor {
    const next = super.updateVendor(vendorId, patch);
    const v = structuredClone(next);
    this.#enqueue("vendor", async (tx) => {
      await writeVendor(tx, v);
      if (patch.catalog) await writeCatalog(tx, v.id, v.catalog);
    });
    return next;
  }

  override addRefund(captureId: string, minor: number): number {
    const total = super.addRefund(captureId, minor);
    this.#enqueue("refund", (tx) =>
      tx
        .query(
          `INSERT INTO capture_refunds (capture_id, refunded_minor) VALUES ($1, $2)
           ON CONFLICT (capture_id) DO UPDATE
             SET refunded_minor = capture_refunds.refunded_minor + EXCLUDED.refunded_minor`,
          [captureId, minor],
        )
        .then(() => undefined),
    );
    return total;
  }

  override addUsage(
    day: string,
    currency: Currency,
    refunded: number,
    paidOut: number,
    vendorId = DEFAULT_STALL,
  ): void {
    super.addUsage(day, currency, refunded, paidOut, vendorId);
    this.#enqueue("usage", (tx) => addUsageSql(tx, day, currency, refunded, paidOut, vendorId));
  }

  override appendAudit(entry: AuditEntry, vendorId = DEFAULT_STALL): void {
    super.appendAudit(entry, vendorId);
    const e = structuredClone(entry);
    this.#enqueue("audit", (tx) =>
      tx
        .query(
          `INSERT INTO audit_log (vendor_id, seq, at, event, actor, action, decision)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) ON CONFLICT (vendor_id, seq) DO NOTHING`,
          [
            vendorId,
            e.seq,
            e.at,
            e.event,
            e.actor,
            JSON.stringify(e.action ?? null),
            JSON.stringify(e.decision),
          ],
        )
        .then(() => undefined),
    );
  }

  override saveSupplier(supplier: Supplier): void {
    super.saveSupplier(supplier);
    const s = structuredClone(supplier);
    this.#enqueue("supplier", (tx) =>
      tx
        .query(
          `INSERT INTO suppliers (id, name, recipient_type, receiver, currency, created_at, vendor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
             recipient_type = EXCLUDED.recipient_type, receiver = EXCLUDED.receiver,
             currency = EXCLUDED.currency`,
          [
            s.id,
            s.name,
            s.recipientType,
            s.receiver,
            s.currency,
            s.createdAt,
            s.vendorId ?? DEFAULT_STALL,
          ],
        )
        .then(() => undefined),
    );
  }

  override deleteSupplier(id: string): boolean {
    const existed = super.deleteSupplier(id);
    if (existed)
      this.#enqueue("supplier", (tx) =>
        tx.query("DELETE FROM suppliers WHERE id = $1", [id]).then(() => undefined),
      );
    return existed;
  }

  override saveStatementMonths(vendorId: string, months: StatementMonth[]): void {
    super.saveStatementMonths(vendorId, months);
    const rows = months.map((m) => ({ ...m }));
    this.#enqueue("statement", async (tx) => {
      for (const m of rows)
        await tx.query(
          `INSERT INTO statement_months (vendor_id, month, currency, inflow_minor, inflow_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (vendor_id, month, currency) DO UPDATE SET
             inflow_minor = EXCLUDED.inflow_minor, inflow_count = EXCLUDED.inflow_count`,
          [vendorId, m.month, m.currency, m.inflow, m.count],
        );
    });
  }

  override deleteStatementMonths(vendorId: string): number {
    const n = super.deleteStatementMonths(vendorId);
    this.#enqueue("statement", (tx) =>
      tx
        .query("DELETE FROM statement_months WHERE vendor_id = $1", [vendorId])
        .then(() => undefined),
    );
    return n;
  }

  override saveSavingsGoal(vendorId: string, goal: SavingsGoal | undefined): void {
    super.saveSavingsGoal(vendorId, goal);
    const g = goal && { ...goal };
    this.#enqueue("goal", (tx) =>
      (g
        ? tx.query(
            `INSERT INTO savings_goals (vendor_id, currency, target_minor, saved_minor)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (vendor_id) DO UPDATE SET currency = EXCLUDED.currency,
               target_minor = EXCLUDED.target_minor, saved_minor = EXCLUDED.saved_minor`,
            [vendorId, g.currency, g.target, g.saved],
          )
        : tx.query("DELETE FROM savings_goals WHERE vendor_id = $1", [vendorId])
      ).then(() => undefined),
    );
  }

  override savePayout(payout: Payout): void {
    super.savePayout(payout);
    const p = structuredClone(payout);
    this.#enqueue("payout", (tx) =>
      tx
        .query(
          `INSERT INTO payouts (id, supplier_id, supplier_name, recipient_type, receiver,
             amount_minor, currency, note, batch_id, item_id, status, error, created_at, updated_at,
             vendor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO UPDATE SET batch_id = EXCLUDED.batch_id,
             item_id = EXCLUDED.item_id, status = EXCLUDED.status, error = EXCLUDED.error,
             updated_at = EXCLUDED.updated_at`,
          [
            p.id,
            p.supplierId,
            p.supplierName,
            p.recipientType,
            p.receiver,
            p.amount.minor,
            p.amount.currency,
            p.note ?? null,
            p.batchId ?? null,
            p.itemId ?? null,
            p.status,
            p.error ?? null,
            p.createdAt,
            p.updatedAt,
            p.vendorId ?? DEFAULT_STALL,
          ],
        )
        .then(() => undefined),
    );
  }

  override savePinState(state: PinGuardState, vendorId = DEFAULT_STALL): void {
    super.savePinState(state, vendorId);
    const json = JSON.stringify(state);
    this.#enqueue("pin", (tx) =>
      tx
        .query(
          `INSERT INTO pin_states (vendor_id, state) VALUES ($1, $2::jsonb)
           ON CONFLICT (vendor_id) DO UPDATE SET state = EXCLUDED.state`,
          [vendorId, json],
        )
        .then(() => undefined),
    );
  }

  override saveMcpToken(token: McpToken): void {
    super.saveMcpToken(token);
    const t = structuredClone(token);
    this.#enqueue("mcp-token", (tx) =>
      tx
        .query(
          `INSERT INTO mcp_tokens (id, token_hash, label, stalls, created_at, revoked_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)
           ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, stalls = EXCLUDED.stalls,
             revoked_at = EXCLUDED.revoked_at`,
          [t.id, t.tokenHash, t.label, JSON.stringify(t.stalls), t.createdAt, t.revokedAt ?? null],
        )
        .then(() => undefined),
    );
  }

  override saveApproval(approval: Approval): void {
    super.saveApproval(approval);
    const a = structuredClone(approval);
    this.#enqueue("approval", (tx) =>
      tx
        .query(
          `INSERT INTO approvals (id, vendor_id, status, data, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data`,
          [a.id, a.vendorId, a.status, JSON.stringify(a), a.createdAt],
        )
        .then(() => undefined),
    );
  }
}

/** Atomic increment of a day's cap usage (safe under concurrent writers). */
export async function addUsageSql(
  tx: SqlQuery,
  day: string,
  currency: Currency,
  refunded: number,
  paidOut: number,
  vendorId = DEFAULT_STALL,
): Promise<void> {
  await tx.query(
    `INSERT INTO policy_usage (vendor_id, day, currency, refunded_minor, paid_out_minor)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (vendor_id, day, currency) DO UPDATE SET
       refunded_minor = policy_usage.refunded_minor + EXCLUDED.refunded_minor,
       paid_out_minor = policy_usage.paid_out_minor + EXCLUDED.paid_out_minor`,
    [vendorId, day, currency, refunded, paidOut],
  );
}

async function writeVendor(tx: SqlQuery, v: Vendor): Promise<void> {
  await tx.query(
    `INSERT INTO vendors (id, display_name, currency, country, time_zone, onboarded, prices_need_review)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
       currency = EXCLUDED.currency, country = EXCLUDED.country, time_zone = EXCLUDED.time_zone,
       onboarded = EXCLUDED.onboarded, prices_need_review = EXCLUDED.prices_need_review`,
    [
      v.id,
      v.displayName,
      v.currency,
      v.country ?? null,
      v.timeZone ?? null,
      v.onboarded ?? null,
      v.pricesNeedReview ?? null,
    ],
  );
}

async function writeCatalog(tx: SqlQuery, vendorId: string, items: CatalogItem[]): Promise<void> {
  await tx.query("DELETE FROM catalog_items WHERE vendor_id = $1", [vendorId]);
  for (const [position, it] of items.entries())
    await tx.query(
      `INSERT INTO catalog_items (vendor_id, position, sku, name, names, aliases, price_minor, currency)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        vendorId,
        position,
        it.sku,
        it.name,
        it.names ? JSON.stringify(it.names) : null,
        JSON.stringify(it.aliases),
        it.price.minor,
        it.price.currency,
      ],
    );
}

function iso(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return (v instanceof Date ? v : new Date(String(v))).toISOString();
}

function rowToItem(r: Row): CatalogItem {
  const item: CatalogItem = {
    sku: String(r.sku),
    name: String(r.name),
    aliases: r.aliases as string[],
    price: { minor: Number(r.price_minor), currency: String(r.currency) as Currency },
  };
  if (r.names) item.names = r.names as CatalogItem["names"];
  return item;
}

function rowToVendor(r: Row, catalog: CatalogItem[]): Vendor {
  const v: Vendor = {
    id: String(r.id),
    displayName: String(r.display_name),
    currency: String(r.currency) as Currency,
    catalog,
  };
  if (r.country !== null) v.country = String(r.country);
  if (r.time_zone !== null) v.timeZone = String(r.time_zone);
  if (r.onboarded !== null) v.onboarded = Boolean(r.onboarded);
  if (r.prices_need_review !== null) v.pricesNeedReview = Boolean(r.prices_need_review);
  return v;
}

function rowToSupplier(r: Row): Supplier {
  return {
    id: String(r.id),
    name: String(r.name),
    recipientType: String(r.recipient_type) as Supplier["recipientType"],
    receiver: String(r.receiver),
    currency: String(r.currency) as Currency,
    createdAt: iso(r.created_at) as string,
    ...stallOf(r),
  };
}

/** Rows of the default stall keep no vendorId (as they were written before multi-stall). */
function stallOf(r: Row): { vendorId?: string } {
  const id = r.vendor_id == null ? DEFAULT_STALL : String(r.vendor_id);
  return id === DEFAULT_STALL ? {} : { vendorId: id };
}

function rowToPayout(r: Row): Payout {
  const p: Payout = {
    id: String(r.id),
    supplierId: String(r.supplier_id),
    supplierName: String(r.supplier_name),
    recipientType: String(r.recipient_type) as Payout["recipientType"],
    receiver: String(r.receiver),
    amount: { minor: Number(r.amount_minor), currency: String(r.currency) as Currency },
    status: String(r.status) as Payout["status"],
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
    ...stallOf(r),
  };
  if (r.note !== null) p.note = String(r.note);
  if (r.batch_id !== null) p.batchId = String(r.batch_id);
  if (r.item_id !== null) p.itemId = String(r.item_id);
  if (r.error !== null) p.error = String(r.error);
  return p;
}

function rowToSale(r: Row): Sale {
  const s: Sale = {
    id: String(r.id),
    vendorId: String(r.vendor_id),
    terminalId: String(r.terminal_id),
    lines: r.lines as Sale["lines"],
    total: { minor: Number(r.total_minor), currency: String(r.currency) as Currency },
    status: r.status as Sale["status"],
    orderId: String(r.order_id),
    createdAt: iso(r.created_at) as string,
    expiresAt: iso(r.expires_at) as string,
    method: r.method as Sale["method"],
  };
  if (r.capture_id !== null) s.captureId = String(r.capture_id);
  const paidAt = iso(r.paid_at);
  if (paidAt) s.paidAt = paidAt;
  return s;
}
