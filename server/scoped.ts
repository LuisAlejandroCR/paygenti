// server/scoped.ts: StallStore — one stall's view of the shared Store. Sales, suppliers, payouts,
// approvals and policy state (daily caps, audit, PIN lockouts) are filtered and stamped with that
// stall's vendorId, so a stall's PolicyEngine and back office can never read or spend another's.
import type { Currency } from "../shared/money";
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
import { type DailyUsage, DEFAULT_STALL, type Store } from "./store";

const owner = (row: { vendorId?: string }) => row.vendorId ?? DEFAULT_STALL;

export class StallStore implements Store {
  constructor(
    readonly base: Store,
    readonly vendorId: string,
  ) {}

  #mine<T extends { vendorId?: string }>(row: T | undefined): T | undefined {
    return row && owner(row) === this.vendorId ? row : undefined;
  }

  /** Default-stall rows keep no vendorId, exactly as before multi-stall. */
  #stamp<T extends { vendorId?: string }>(row: T): T {
    const { vendorId: _drop, ...rest } = row;
    return (this.vendorId === DEFAULT_STALL ? rest : { ...rest, vendorId: this.vendorId }) as T;
  }

  vendors(): Vendor[] {
    const v = this.base.getVendor(this.vendorId);
    return v ? [v] : [];
  }
  terminalsForVendor(vendorId: string): Terminal[] {
    return vendorId === this.vendorId ? this.base.terminalsForVendor(vendorId) : [];
  }
  mcpTokens(): McpToken[] {
    return [];
  }
  saveMcpToken(): void {
    throw new Error("stall store: MCP tokens belong to the owner");
  }
  passkeys(terminalId: string): PasskeyCredential[] {
    return this.base.passkeys(terminalId).filter((p) => p.vendorId === this.vendorId);
  }
  getPasskey(id: string): PasskeyCredential | undefined {
    const p = this.base.getPasskey(id);
    return p?.vendorId === this.vendorId ? p : undefined;
  }
  savePasskey(passkey: PasskeyCredential): void {
    this.base.savePasskey({ ...passkey, vendorId: this.vendorId });
  }
  approvals(): Approval[] {
    return this.base.approvals(this.vendorId);
  }
  getApproval(id: string): Approval | undefined {
    return this.#mine(this.base.getApproval(id));
  }
  saveApproval(approval: Approval): void {
    this.base.saveApproval({ ...approval, vendorId: this.vendorId });
  }
  statementMonths(vendorId: string): StatementMonth[] {
    return vendorId === this.vendorId ? this.base.statementMonths(vendorId) : [];
  }
  saveStatementMonths(vendorId: string, months: StatementMonth[]): void {
    if (vendorId !== this.vendorId) throw new Error("stall store: statement of another stall");
    this.base.saveStatementMonths(vendorId, months);
  }
  deleteStatementMonths(vendorId: string): number {
    if (vendorId !== this.vendorId) throw new Error("stall store: statement of another stall");
    return this.base.deleteStatementMonths(vendorId);
  }
  savingsGoal(vendorId: string): SavingsGoal | undefined {
    return vendorId === this.vendorId ? this.base.savingsGoal(vendorId) : undefined;
  }
  saveSavingsGoal(vendorId: string, goal: SavingsGoal | undefined): void {
    if (vendorId !== this.vendorId) throw new Error("stall store: goal of another stall");
    this.base.saveSavingsGoal(vendorId, goal);
  }
  getVendor(id: string): Vendor | undefined {
    return id === this.vendorId ? this.base.getVendor(id) : undefined;
  }
  getTerminal(id: string): Terminal | undefined {
    return this.#mine(this.base.getTerminal(id));
  }
  getSale(id: string): Sale | undefined {
    return this.#mine(this.base.getSale(id));
  }
  findSaleByOrderId(orderId: string): Sale | undefined {
    return this.#mine(this.base.findSaleByOrderId(orderId));
  }
  findSaleByCaptureId(captureId: string): Sale | undefined {
    return this.#mine(this.base.findSaleByCaptureId(captureId));
  }
  salesForTerminal(terminalId: string): Sale[] {
    return this.getTerminal(terminalId) ? this.base.salesForTerminal(terminalId) : [];
  }
  allSales(): Sale[] {
    return this.base.allSales().filter((s) => s.vendorId === this.vendorId);
  }
  saveSale(sale: Sale): void {
    if (sale.vendorId !== this.vendorId) throw new Error("stall store: sale of another stall");
    this.base.saveSale(sale);
  }
  setCatalog(vendorId: string, catalog: CatalogItem[]): void {
    if (vendorId !== this.vendorId) throw new Error("stall store: catalog of another stall");
    this.base.setCatalog(vendorId, catalog);
  }
  updateVendor(vendorId: string, patch: Partial<Omit<Vendor, "id">>): Vendor {
    if (vendorId !== this.vendorId) throw new Error("stall store: another stall");
    return this.base.updateVendor(vendorId, patch);
  }
  /** Capture ids are PayPal-unique; only captures of this stall's own sales are reachable. */
  refundedForCapture(captureId: string): number {
    return this.findSaleByCaptureId(captureId) ? this.base.refundedForCapture(captureId) : 0;
  }
  addRefund(captureId: string, minor: number): number {
    if (!this.findSaleByCaptureId(captureId))
      throw new Error("stall store: capture of another stall");
    return this.base.addRefund(captureId, minor);
  }
  suppliers(): Supplier[] {
    return this.base.suppliers().filter((s) => owner(s) === this.vendorId);
  }
  getSupplier(id: string): Supplier | undefined {
    return this.#mine(this.base.getSupplier(id));
  }
  saveSupplier(supplier: Supplier): void {
    const prior = this.base.getSupplier(supplier.id);
    if (prior && owner(prior) !== this.vendorId) throw new Error("stall store: another stall");
    this.base.saveSupplier(this.#stamp(supplier));
  }
  deleteSupplier(id: string): boolean {
    return this.getSupplier(id) ? this.base.deleteSupplier(id) : false;
  }
  payouts(): Payout[] {
    return this.base.payouts().filter((p) => owner(p) === this.vendorId);
  }
  getPayout(id: string): Payout | undefined {
    return this.#mine(this.base.getPayout(id));
  }
  findPayoutByBatchId(batchId: string): Payout | undefined {
    return this.#mine(this.base.findPayoutByBatchId(batchId));
  }
  savePayout(payout: Payout): void {
    const prior = this.base.getPayout(payout.id);
    if (prior && owner(prior) !== this.vendorId) throw new Error("stall store: another stall");
    this.base.savePayout(this.#stamp(payout));
  }
  usageForDay(day: string): DailyUsage[] {
    return this.base.usageForDay(day, this.vendorId);
  }
  addUsage(day: string, currency: Currency, refunded: number, paidOut: number): void {
    this.base.addUsage(day, currency, refunded, paidOut, this.vendorId);
  }
  auditEntries(): AuditEntry[] {
    return this.base.auditEntries(this.vendorId);
  }
  appendAudit(entry: AuditEntry): void {
    this.base.appendAudit(entry, this.vendorId);
  }
  pinState(): PinGuardState | undefined {
    return this.base.pinState(this.vendorId);
  }
  savePinState(state: PinGuardState): void {
    this.base.savePinState(state, this.vendorId);
  }
}
