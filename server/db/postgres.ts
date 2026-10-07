// server/db/postgres.ts: PostgresStore — the Store backed by Postgres (selected by DATABASE_URL).
// open() migrates and loads every row into the in-memory MemoryStore it extends, so the synchronous
// Store API is unchanged; each write is then applied to memory at once and to Postgres through one
// ordered queue, every job in its own transaction. Counters (daily cap usage, refunds per capture)
// are atomic SQL increments, so even two processes on one DB never lose an update; a unique index
// keeps one capture id per sale. close() flushes the queue (SIGTERM on Render) before exiting.
// Suppliers (payout allowlist) and payouts are loaded and written the same way.
import type { Currency } from "../../shared/money";
import type { CatalogItem, Payout, Sale, Supplier, Terminal, Vendor } from "../../shared/types";
import type { AuditEntry } from "../policy/audit";
import type { PinGuardState } from "../policy/pin";
import { DEMO_TERMINAL, DEMO_VENDOR, MemoryStore } from "../store";
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

  /** Migrates, seeds the demo vendor if the DB is empty, and loads every row into memory. */
  static async open(db: SqlClient): Promise<PostgresStore> {
    await migrate(db);
    const store = new PostgresStore(db);
    await db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT 1 FROM vendors WHERE id = $1", [DEMO_VENDOR.id]);
      if (rows.length === 0) {
        await writeVendor(tx, DEMO_VENDOR);
        await writeCatalog(tx, DEMO_VENDOR.id, DEMO_VENDOR.catalog);
        await tx.query(
          "INSERT INTO terminals (id, vendor_id, label) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
          [DEMO_TERMINAL.id, DEMO_TERMINAL.vendorId, DEMO_TERMINAL.label],
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
    this.vendors.clear();
    for (const r of (await db.query("SELECT * FROM vendors")).rows) {
      const v = rowToVendor(r, byVendor.get(String(r.id)) ?? []);
      this.vendors.set(v.id, v);
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
      this.usage.set(`${r.day}|${currency}`, {
        currency,
        refunded: Number(r.refunded_minor),
        paidOut: Number(r.paid_out_minor),
      });
    }
    this.audit.length = 0;
    for (const r of (await db.query("SELECT * FROM audit_log ORDER BY seq")).rows)
      this.audit.push({
        seq: Number(r.seq),
        at: iso(r.at) as string,
        event: r.event as AuditEntry["event"],
        actor: String(r.actor),
        action: r.action ?? null,
        decision: r.decision as AuditEntry["decision"],
      });
    const pin = (await db.query("SELECT state FROM pin_state WHERE id = 1")).rows[0];
    this.pin = pin ? (pin.state as PinGuardState) : undefined;
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

  override addUsage(day: string, currency: Currency, refunded: number, paidOut: number): void {
    super.addUsage(day, currency, refunded, paidOut);
    this.#enqueue("usage", (tx) => addUsageSql(tx, day, currency, refunded, paidOut));
  }

  override appendAudit(entry: AuditEntry): void {
    super.appendAudit(entry);
    const e = structuredClone(entry);
    this.#enqueue("audit", (tx) =>
      tx
        .query(
          `INSERT INTO audit_log (seq, at, event, actor, action, decision)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) ON CONFLICT (seq) DO NOTHING`,
          [
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
          `INSERT INTO suppliers (id, name, recipient_type, receiver, currency, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
             recipient_type = EXCLUDED.recipient_type, receiver = EXCLUDED.receiver,
             currency = EXCLUDED.currency`,
          [s.id, s.name, s.recipientType, s.receiver, s.currency, s.createdAt],
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

  override savePayout(payout: Payout): void {
    super.savePayout(payout);
    const p = structuredClone(payout);
    this.#enqueue("payout", (tx) =>
      tx
        .query(
          `INSERT INTO payouts (id, supplier_id, supplier_name, recipient_type, receiver,
             amount_minor, currency, note, batch_id, item_id, status, error, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
          ],
        )
        .then(() => undefined),
    );
  }

  override savePinState(state: PinGuardState): void {
    super.savePinState(state);
    const json = JSON.stringify(state);
    this.#enqueue("pin", (tx) =>
      tx
        .query(
          `INSERT INTO pin_state (id, state) VALUES (1, $1::jsonb)
           ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`,
          [json],
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
): Promise<void> {
  await tx.query(
    `INSERT INTO policy_usage (day, currency, refunded_minor, paid_out_minor) VALUES ($1, $2, $3, $4)
     ON CONFLICT (day, currency) DO UPDATE SET
       refunded_minor = policy_usage.refunded_minor + EXCLUDED.refunded_minor,
       paid_out_minor = policy_usage.paid_out_minor + EXCLUDED.paid_out_minor`,
    [day, currency, refunded, paidOut],
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
  };
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
