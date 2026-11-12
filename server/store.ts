// server/store.ts: persistence behind a small synchronous Store interface. MemoryStore keeps
// everything in process (tests, zero-setup judge mode); server/db/postgres.ts persists the same state.
// Seeds two demo stalls of one owner: Rosa (tamales y atole, MXN, "rosa-01") and Don Beto (tacos,
// MXN, "beto-01"). Policy state (caps, audit, PIN lockouts), suppliers, payouts and approvals are
// kept per stall (vendorId); scoped.ts gives each stall a Store view that cannot see the others.
// Also keeps the financial footprint inputs: imported statement aggregates (month, currency, inflow,
// count only) and each vendor's savings goal.
import { type Currency, money } from "../shared/money";
import type { SavingsGoal, StatementMonth } from "../shared/passport";
import type {
  Approval,
  CatalogItem,
  McpToken,
  PasskeyCredential,
  Payout,
  Sale,
  Supplier,
  Terminal,
  Vendor,
} from "../shared/types";
import type { AuditEntry } from "./policy/audit";
import type { PinGuardState } from "./policy/pin";

/** The stall rows from before multi-stall belong to. */
export const DEFAULT_STALL = "rosa";

/** Committed money moves for one local day and currency (minor units). */
export interface DailyUsage {
  currency: Currency;
  refunded: number;
  paidOut: number;
}

/**
 * State the policy lock needs to survive a restart: daily caps, audit log, PIN lockouts. The
 * trailing `vendorId` picks the stall (default "rosa"); a stall's lock only ever sees its own rows.
 */
export interface PolicyStore {
  usageForDay(day: string, vendorId?: string): DailyUsage[];
  /** Atomic increment of a day's committed totals. */
  addUsage(
    day: string,
    currency: Currency,
    refunded: number,
    paidOut: number,
    vendorId?: string,
  ): void;
  auditEntries(vendorId?: string): AuditEntry[];
  appendAudit(entry: AuditEntry, vendorId?: string): void;
  pinState(vendorId?: string): PinGuardState | undefined;
  savePinState(state: PinGuardState, vendorId?: string): void;
}

export interface Store extends PolicyStore {
  /** Every stall, in insertion order. */
  vendors(): Vendor[];
  terminalsForVendor(vendorId: string): Terminal[];
  /** Owner-issued MCP tokens (hash only), oldest first. */
  mcpTokens(): McpToken[];
  saveMcpToken(token: McpToken): void;
  /** Face ID / fingerprint passkeys enrolled for one terminal, oldest first. */
  passkeys(terminalId: string): PasskeyCredential[];
  getPasskey(id: string): PasskeyCredential | undefined;
  /** Inserts, or updates the signature counter of, a passkey. */
  savePasskey(passkey: PasskeyCredential): void;
  /** Proposals from Claude, newest first; `vendorId` filters to one stall. */
  approvals(vendorId?: string): Approval[];
  getApproval(id: string): Approval | undefined;
  saveApproval(approval: Approval): void;
  getVendor(id: string): Vendor | undefined;
  getTerminal(id: string): Terminal | undefined;
  getSale(id: string): Sale | undefined;
  findSaleByOrderId(orderId: string): Sale | undefined;
  findSaleByCaptureId(captureId: string): Sale | undefined;
  /** Newest first. */
  salesForTerminal(terminalId: string): Sale[];
  /** Every sale, newest first (back-office reports). */
  allSales(): Sale[];
  saveSale(sale: Sale): void;
  /** Replaces a vendor's catalog; later reads (voice parser, vendor app) see it immediately. */
  setCatalog(vendorId: string, catalog: CatalogItem[]): void;
  /** Replaces a vendor's profile fields (name, country, currency...). */
  updateVendor(vendorId: string, patch: Partial<Omit<Vendor, "id">>): Vendor;
  /** Committed refunds (minor units) against one PayPal capture. */
  refundedForCapture(captureId: string): number;
  /** Adds a committed refund and returns the new total for that capture. */
  addRefund(captureId: string, minor: number): number;
  /** The payout allowlist, oldest first. */
  suppliers(): Supplier[];
  getSupplier(id: string): Supplier | undefined;
  saveSupplier(supplier: Supplier): void;
  /** False when there was no such supplier. Past payouts keep their own copy of the receiver. */
  deleteSupplier(id: string): boolean;
  /** Every payout, newest first. */
  payouts(): Payout[];
  getPayout(id: string): Payout | undefined;
  findPayoutByBatchId(batchId: string): Payout | undefined;
  savePayout(payout: Payout): void;
  /** Imported bank-statement aggregates for a vendor (self-reported, never verified). */
  statementMonths(vendorId: string): StatementMonth[];
  /** Upserts by (month, currency): a re-import of the same month replaces it, others are kept. */
  saveStatementMonths(vendorId: string, months: StatementMonth[]): void;
  /** Deletes every imported aggregate; returns how many months were removed. */
  deleteStatementMonths(vendorId: string): number;
  savingsGoal(vendorId: string): SavingsGoal | undefined;
  /** `undefined` clears the goal. */
  saveSavingsGoal(vendorId: string, goal: SavingsGoal | undefined): void;
}

export const DEMO_VENDOR: Vendor = {
  id: "rosa",
  displayName: "Rosa — Tamales y atole",
  currency: "MXN",
  country: "MX",
  timeZone: "America/Mexico_City",
  onboarded: true,
  catalog: [
    {
      sku: "tamal-rajas",
      name: "Rajas tamale",
      names: { en: "Rajas tamale", es: "Tamal de rajas" },
      aliases: [
        "rajas",
        "tamal de rajas",
        "de rajas",
        "tamal verde",
        "rajas tamale",
        "green tamale",
        "green",
      ],
      price: money(2500, "MXN"),
    },
    {
      sku: "tamal-mole",
      name: "Mole tamale",
      names: { en: "Mole tamale", es: "Tamal de mole" },
      aliases: [
        "mole",
        "tamal de mole",
        "de mole",
        "oaxaqueño",
        "tamal oaxaqueño",
        "mole tamale",
        "red tamale",
        "red",
        "chicken",
      ],
      price: money(2800, "MXN"),
    },
    {
      sku: "tamal-dulce",
      name: "Sweet tamale",
      names: { en: "Sweet tamale", es: "Tamal dulce" },
      aliases: [
        "dulce",
        "tamal dulce",
        "de dulce",
        "tamal rosa",
        "sweet tamale",
        "sweet",
        "pink tamale",
      ],
      price: money(2200, "MXN"),
    },
    {
      sku: "atole",
      name: "Atole",
      names: { en: "Atole", es: "Atole" },
      aliases: ["atole", "atolito", "atole blanco", "vaso de atole", "corn drink"],
      price: money(2000, "MXN"),
    },
    {
      sku: "champurrado",
      name: "Champurrado",
      names: { en: "Champurrado", es: "Champurrado" },
      aliases: [
        "champurrado",
        "champurradito",
        "atole de chocolate",
        "chocolate atole",
        "hot chocolate",
      ],
      price: money(2200, "MXN"),
    },
  ],
};

export const DEMO_TERMINAL: Terminal = { id: "rosa-01", vendorId: "rosa", label: "Puesto de Rosa" };

/** Second demo stall of the same owner: shows the switcher and the "All my paygents" view. */
export const DEMO_VENDOR_BETO: Vendor = {
  id: "beto",
  displayName: "Don Beto — Tacos",
  currency: "MXN",
  country: "MX",
  timeZone: "America/Mexico_City",
  onboarded: true,
  catalog: [
    {
      sku: "taco-pastor",
      name: "Al pastor taco",
      names: { en: "Al pastor taco", es: "Taco al pastor" },
      aliases: ["pastor", "al pastor", "taco al pastor", "tacos al pastor", "pastor taco"],
      price: money(1800, "MXN"),
    },
    {
      sku: "taco-suadero",
      name: "Suadero taco",
      names: { en: "Suadero taco", es: "Taco de suadero" },
      aliases: ["suadero", "de suadero", "taco de suadero", "suadero taco", "beef taco"],
      price: money(2000, "MXN"),
    },
    {
      sku: "agua-horchata",
      name: "Horchata",
      names: { en: "Horchata", es: "Agua de horchata" },
      aliases: ["horchata", "agua de horchata", "agua"],
      price: money(2500, "MXN"),
    },
  ],
};

export const DEMO_TERMINAL_BETO: Terminal = {
  id: "beto-01",
  vendorId: "beto",
  label: "Puesto de Don Beto",
};

/** Every demo stall and its terminal, seeded into an empty store. */
export const DEMO_STALLS: ReadonlyArray<{ vendor: Vendor; terminal: Terminal }> = [
  { vendor: DEMO_VENDOR, terminal: DEMO_TERMINAL },
  { vendor: DEMO_VENDOR_BETO, terminal: DEMO_TERMINAL_BETO },
];

export class MemoryStore implements Store {
  protected readonly vendorMap = new Map<string, Vendor>(
    DEMO_STALLS.map((s) => [s.vendor.id, s.vendor]),
  );
  protected readonly terminals = new Map<string, Terminal>(
    DEMO_STALLS.map((s) => [s.terminal.id, s.terminal]),
  );
  protected readonly sales = new Map<string, Sale>();
  protected readonly refunds = new Map<string, number>();
  /** Key: `${vendorId}|${day}|${currency}`. */
  protected readonly usage = new Map<string, DailyUsage>();
  protected readonly audit = new Map<string, AuditEntry[]>();
  protected readonly pins = new Map<string, PinGuardState>();
  protected readonly supplierMap = new Map<string, Supplier>();
  protected readonly payoutMap = new Map<string, Payout>();
  /** vendorId -> "month|currency" -> aggregate. */
  protected readonly statementMap = new Map<string, Map<string, StatementMonth>>();
  protected readonly goalMap = new Map<string, SavingsGoal>();
  protected readonly tokenMap = new Map<string, McpToken>();
  protected readonly approvalMap = new Map<string, Approval>();
  protected readonly passkeyMap = new Map<string, PasskeyCredential>();

  vendors(): Vendor[] {
    return [...this.vendorMap.values()];
  }

  terminalsForVendor(vendorId: string): Terminal[] {
    return [...this.terminals.values()].filter((t) => t.vendorId === vendorId);
  }

  mcpTokens(): McpToken[] {
    return [...this.tokenMap.values()].map((t) => structuredClone(t));
  }

  passkeys(terminalId: string): PasskeyCredential[] {
    return [...this.passkeyMap.values()]
      .filter((p) => p.terminalId === terminalId)
      .map((p) => structuredClone(p));
  }

  getPasskey(id: string): PasskeyCredential | undefined {
    const p = this.passkeyMap.get(id);
    return p && structuredClone(p);
  }

  savePasskey(passkey: PasskeyCredential): void {
    this.passkeyMap.set(passkey.id, structuredClone(passkey));
  }

  saveMcpToken(token: McpToken): void {
    this.tokenMap.set(token.id, structuredClone(token));
  }

  approvals(vendorId?: string): Approval[] {
    return [...this.approvalMap.values()]
      .filter((a) => vendorId === undefined || a.vendorId === vendorId)
      .reverse()
      .map((a) => structuredClone(a));
  }

  getApproval(id: string): Approval | undefined {
    const a = this.approvalMap.get(id);
    return a && structuredClone(a);
  }

  saveApproval(approval: Approval): void {
    this.approvalMap.set(approval.id, structuredClone(approval));
  }

  getVendor(id: string): Vendor | undefined {
    return this.vendorMap.get(id);
  }

  getTerminal(id: string): Terminal | undefined {
    return this.terminals.get(id);
  }

  getSale(id: string): Sale | undefined {
    return this.sales.get(id);
  }

  findSaleByOrderId(orderId: string): Sale | undefined {
    for (const s of this.sales.values()) if (s.orderId === orderId) return s;
    return undefined;
  }

  findSaleByCaptureId(captureId: string): Sale | undefined {
    for (const s of this.sales.values()) if (s.captureId === captureId) return s;
    return undefined;
  }

  salesForTerminal(terminalId: string): Sale[] {
    return [...this.sales.values()].filter((s) => s.terminalId === terminalId).reverse();
  }

  allSales(): Sale[] {
    return [...this.sales.values()].reverse();
  }

  saveSale(sale: Sale): void {
    this.sales.set(sale.id, sale);
  }

  setCatalog(vendorId: string, catalog: CatalogItem[]): void {
    const vendor = this.vendorMap.get(vendorId);
    if (!vendor) throw new Error(`store: unknown vendor ${vendorId}`);
    // A new object: DEMO_VENDOR (shared by every MemoryStore) is never mutated.
    this.vendorMap.set(vendorId, {
      ...vendor,
      catalog: structuredClone(catalog),
      pricesNeedReview: false,
    });
  }

  updateVendor(vendorId: string, patch: Partial<Omit<Vendor, "id">>): Vendor {
    const vendor = this.vendorMap.get(vendorId);
    if (!vendor) throw new Error(`store: unknown vendor ${vendorId}`);
    const next = { ...vendor, ...structuredClone(patch), id: vendor.id };
    this.vendorMap.set(vendorId, next);
    return next;
  }

  refundedForCapture(captureId: string): number {
    return this.refunds.get(captureId) ?? 0;
  }

  addRefund(captureId: string, minor: number): number {
    const total = this.refundedForCapture(captureId) + minor;
    this.refunds.set(captureId, total);
    return total;
  }

  suppliers(): Supplier[] {
    return [...this.supplierMap.values()].map((s) => structuredClone(s));
  }

  getSupplier(id: string): Supplier | undefined {
    const s = this.supplierMap.get(id);
    return s && structuredClone(s);
  }

  saveSupplier(supplier: Supplier): void {
    this.supplierMap.set(supplier.id, structuredClone(supplier));
  }

  deleteSupplier(id: string): boolean {
    return this.supplierMap.delete(id);
  }

  payouts(): Payout[] {
    return [...this.payoutMap.values()].reverse().map((p) => structuredClone(p));
  }

  getPayout(id: string): Payout | undefined {
    const p = this.payoutMap.get(id);
    return p && structuredClone(p);
  }

  findPayoutByBatchId(batchId: string): Payout | undefined {
    for (const p of this.payoutMap.values()) if (p.batchId === batchId) return structuredClone(p);
    return undefined;
  }

  savePayout(payout: Payout): void {
    this.payoutMap.set(payout.id, structuredClone(payout));
  }

  statementMonths(vendorId: string): StatementMonth[] {
    return [...(this.statementMap.get(vendorId)?.values() ?? [])].map((m) => ({ ...m }));
  }

  saveStatementMonths(vendorId: string, months: StatementMonth[]): void {
    const map = this.statementMap.get(vendorId) ?? new Map<string, StatementMonth>();
    for (const m of months) map.set(`${m.month}|${m.currency}`, { ...m });
    this.statementMap.set(vendorId, map);
  }

  deleteStatementMonths(vendorId: string): number {
    const n = this.statementMap.get(vendorId)?.size ?? 0;
    this.statementMap.delete(vendorId);
    return n;
  }

  savingsGoal(vendorId: string): SavingsGoal | undefined {
    const g = this.goalMap.get(vendorId);
    return g && { ...g };
  }

  saveSavingsGoal(vendorId: string, goal: SavingsGoal | undefined): void {
    if (goal) this.goalMap.set(vendorId, { ...goal });
    else this.goalMap.delete(vendorId);
  }

  usageForDay(day: string, vendorId = DEFAULT_STALL): DailyUsage[] {
    const prefix = `${vendorId}|${day}|`;
    return [...this.usage.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, u]) => ({ ...u }));
  }

  addUsage(
    day: string,
    currency: Currency,
    refunded: number,
    paidOut: number,
    vendorId = DEFAULT_STALL,
  ): void {
    const key = `${vendorId}|${day}|${currency}`;
    const u = this.usage.get(key) ?? { currency, refunded: 0, paidOut: 0 };
    this.usage.set(key, {
      currency,
      refunded: u.refunded + refunded,
      paidOut: u.paidOut + paidOut,
    });
  }

  auditEntries(vendorId = DEFAULT_STALL): AuditEntry[] {
    return [...(this.audit.get(vendorId) ?? [])];
  }

  appendAudit(entry: AuditEntry, vendorId = DEFAULT_STALL): void {
    const list = this.audit.get(vendorId) ?? [];
    list.push(entry);
    this.audit.set(vendorId, list);
  }

  pinState(vendorId = DEFAULT_STALL): PinGuardState | undefined {
    const s = this.pins.get(vendorId);
    return s && structuredClone(s);
  }

  savePinState(state: PinGuardState, vendorId = DEFAULT_STALL): void {
    this.pins.set(vendorId, structuredClone(state));
  }
}
