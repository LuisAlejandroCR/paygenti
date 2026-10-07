// server/owner/approvals.ts: ApprovalDesk — one stall's inbox of refunds and payouts Claude proposed
// over MCP. A proposal only stores a policy preview (no ticket, no budget reserved); the money moves
// only when the owner approves it with that stall's PIN, through the same BackOffice/PayoutDesk path.
import { randomUUID } from "node:crypto";
import { money } from "../../shared/money";
import type { Approval } from "../../shared/types";
import type { Authority, BackOffice } from "../backoffice/tools";
import type { StallStore } from "../scoped";

/** Pending proposals a stall keeps at most: Claude cannot flood the inbox. */
export const MAX_PENDING = 20;
/** A refusal for these keeps the proposal pending (the human can retry with the right PIN). */
const RETRYABLE = new Set([
  "PIN_REQUIRED",
  "PIN_WRONG",
  "PIN_LOCKED",
  "VENDOR_REQUIRED",
  "CUSTOMER_NOT_AUTHORIZED",
]);

export type ApprovalResult =
  | { ok: true; approval: Approval }
  | { ok: false; code: string; reason: string; approval?: Approval };

export interface ApprovalDeskDeps {
  store: StallStore;
  office: BackOffice;
  clock?: () => number;
}

export class ApprovalDesk {
  readonly #store: StallStore;
  readonly #office: BackOffice;
  readonly #clock: () => number;

  constructor(deps: ApprovalDeskDeps) {
    this.#store = deps.store;
    this.#office = deps.office;
    this.#clock = deps.clock ?? Date.now;
  }

  list(): Approval[] {
    return this.#store.approvals();
  }

  pending(): Approval[] {
    return this.list().filter((a) => a.status === "pending");
  }

  proposeRefund(
    req: { saleId: string; amountMinor: number; note: string },
    tokenId: string,
  ): ApprovalResult {
    const full = this.#full();
    if (full) return full;
    const sale = this.#store.getSale(req.saleId);
    if (!sale || sale.status !== "paid" || !sale.captureId || !sale.paidAt)
      return { ok: false, code: "SALE_NOT_REFUNDABLE", reason: "No paid sale with that id here." };
    const amount = money(req.amountMinor, sale.total.currency);
    const preview = this.#office.policy.preview(
      {
        kind: "refund",
        saleId: sale.id,
        captureId: sale.captureId,
        amount,
        capturedAt: sale.paidAt,
        capturedAmount: sale.total,
        alreadyRefunded: money(this.#store.refundedForCapture(sale.captureId), sale.total.currency),
      },
      "agent",
    );
    return this.#save({
      kind: "refund",
      saleId: sale.id,
      amount,
      note: req.note,
      preview,
      tokenId,
    });
  }

  proposePayout(
    req: { supplierId: string; amountMinor: number; note: string },
    tokenId: string,
  ): ApprovalResult {
    const full = this.#full();
    if (full) return full;
    const supplier = this.#store.getSupplier(req.supplierId);
    if (!supplier)
      return { ok: false, code: "SUPPLIER_NOT_FOUND", reason: "No such supplier on this stall." };
    const amount = money(req.amountMinor, supplier.currency);
    const preview = this.#office.policy.preview(
      { kind: "payout", recipient: supplier.receiver, amount },
      "agent",
    );
    return this.#save({
      kind: "payout",
      supplierId: supplier.id,
      amount,
      note: req.note,
      preview,
      tokenId,
    });
  }

  /** The human approves: runs the real refund/payout with their session + PIN. */
  async approve(id: string, who: Authority): Promise<ApprovalResult> {
    const a = this.#store.getApproval(id);
    if (!a) return { ok: false, code: "APPROVAL_NOT_FOUND", reason: "No such approval." };
    if (a.status !== "pending")
      return { ok: false, code: "APPROVAL_DONE", reason: `Already ${a.status}.`, approval: a };
    // Claimed synchronously: a double tap cannot run the money move twice.
    this.#store.saveApproval({ ...a, status: "executing" });
    let r: { ok: boolean; code: string; reason: string };
    try {
      r =
        a.kind === "refund"
          ? await this.#office.refund({ saleId: a.saleId ?? "", amount: a.amount }, who)
          : await this.#office.payouts.pay(
              {
                supplierId: a.supplierId ?? "",
                amountMinor: a.amount.minor,
                note: a.note.slice(0, 200) || undefined,
                requestId: a.id,
              },
              who,
            );
    } catch (err) {
      this.#store.saveApproval({ ...a, status: "pending" });
      throw err;
    }
    if (!r.ok && RETRYABLE.has(r.code)) {
      this.#store.saveApproval({ ...a, status: "pending" });
      return { ok: false, code: r.code, reason: r.reason, approval: a };
    }
    const done: Approval = {
      ...a,
      status: r.ok ? "approved" : "failed",
      decidedAt: this.#iso(),
      result: { code: r.code, reason: r.reason },
    };
    this.#store.saveApproval(done);
    return r.ok
      ? { ok: true, approval: done }
      : { ok: false, code: r.code, reason: r.reason, approval: done };
  }

  reject(id: string): ApprovalResult {
    const a = this.#store.getApproval(id);
    if (!a) return { ok: false, code: "APPROVAL_NOT_FOUND", reason: "No such approval." };
    if (a.status !== "pending")
      return { ok: false, code: "APPROVAL_DONE", reason: `Already ${a.status}.`, approval: a };
    const done: Approval = {
      ...a,
      status: "rejected",
      decidedAt: this.#iso(),
      result: { code: "REJECTED", reason: "Rejected by the owner." },
    };
    this.#store.saveApproval(done);
    return { ok: true, approval: done };
  }

  #full(): ApprovalResult | undefined {
    return this.pending().length >= MAX_PENDING
      ? { ok: false, code: "TOO_MANY_PENDING", reason: "Too many proposals await the owner." }
      : undefined;
  }

  #save(
    p: Pick<Approval, "kind" | "amount" | "note" | "preview" | "tokenId"> &
      Partial<Pick<Approval, "saleId" | "supplierId">>,
  ): ApprovalResult {
    const approval: Approval = {
      id: randomUUID(),
      vendorId: this.#store.vendorId,
      status: "pending",
      ...p,
      preview: { allow: p.preview.allow, code: p.preview.code, reason: p.preview.reason },
      createdAt: this.#iso(),
    };
    this.#store.saveApproval(approval);
    return { ok: true, approval };
  }

  #iso(): string {
    return new Date(this.#clock()).toISOString();
  }
}
