// web/src/payouts-panel.tsx: back-office "Suppliers & payouts" panel — the supplier allowlist (add or
// remove with the PIN), a pay form with the PIN and today's limits, the payout history with status,
// and an assistant proposal prefilled for the vendor to confirm. The server decides; this renders.

import { useEffect, useRef, useState } from "preact/hooks";
import { decimalsOf } from "../../shared/currency";
import { type Currency, formatMoney, type Money, parseAmount } from "../../shared/money";
import type { Payout, PayoutStatus, RecipientType, Supplier } from "../../shared/types";
import { type Key, reasonText, useT } from "./i18n";
import { boUrl } from "./stall";

/** What the assistant's propose_payout returned; the vendor still confirms with her PIN. */
export interface PayoutProposal {
  supplierId: string;
  supplierName: string;
  amount: Money;
  note?: string;
}

interface Limits {
  maxPayout: Money;
  maxPayoutPerDay: Money;
  leftToday: Money;
}

const TONE: Partial<Record<PayoutStatus, string>> = {
  SUCCESS: "ok",
  PENDING: "info",
  PROCESSING: "info",
  UNKNOWN: "info",
  UNCLAIMED: "warn",
  ONHOLD: "warn",
};

const newRequestId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return undefined;
  }
};

/** Minor units -> what a person would type ("150", "150.5"). */
const asText = (m: Money) => String(m.minor / 10 ** decimalsOf(m.currency));

export function PayoutsPanel({
  token,
  currency,
  proposal,
  onAuthLost,
}: {
  token: string;
  currency: Currency;
  proposal: PayoutProposal | null;
  onAuthLost: () => void;
}) {
  const { t, locale } = useT();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [add, setAdd] = useState({
    name: "",
    type: "EMAIL" as RecipientType,
    receiver: "",
    pin: "",
  });
  const [pay, setPay] = useState({ supplierId: "", amount: "", note: "", pin: "" });
  const [requestId, setRequestId] = useState(newRequestId);
  const [removing, setRemoving] = useState<{ id: string; name: string; pin: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  /** Error code of the last failed call (PAYOUT_UNCONFIRMED keeps the request id for a safe retry). */
  const lastError = useRef("");

  const reset = () => {
    setError("");
    setNotice("");
  };

  async function call<T>(path: string, body?: unknown): Promise<T | undefined> {
    const res = await fetch(boUrl(path), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => undefined);
    if (!res) {
      setError(t("bo.offline"));
      return undefined;
    }
    const data = (await res.json().catch(() => ({}))) as T & {
      error?: string;
      reason?: string;
      params?: Record<string, string | number>;
    };
    if (!res.ok) {
      lastError.current = data.error ?? "";
      if (res.status === 401 && data.error === "SESSION_REQUIRED") onAuthLost();
      setError(
        reasonText(data.error, data.params, data.reason, locale) ??
          t("bo.error", { code: data.error ?? res.status }),
      );
      return undefined;
    }
    return data;
  }

  async function load() {
    const [s, p] = await Promise.all([
      call<{ suppliers: Supplier[] }>("/suppliers"),
      call<{ payouts: Payout[]; limits: Limits; paypal: string }>("/payouts"),
    ]);
    if (s) setSuppliers(s.suppliers);
    if (p) {
      setPayouts(p.payouts);
      setLimits(p.limits);
      setSandbox(p.paypal === "sandbox");
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  // An assistant proposal fills the pay form; the PIN is still typed by the vendor.
  useEffect(() => {
    if (!proposal) return;
    setPay({
      supplierId: proposal.supplierId,
      amount: asText(proposal.amount),
      note: proposal.note ?? "",
      pin: "",
    });
    setRequestId(newRequestId());
    panel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [proposal]);

  async function addSupplier(e: Event) {
    e.preventDefault();
    reset();
    setBusy(true);
    const r = await call<{ supplier: Supplier }>("/suppliers", {
      name: add.name,
      recipientType: add.type,
      receiver: add.receiver,
      pin: add.pin,
    });
    setBusy(false);
    setAdd((a) => ({ ...a, pin: "" }));
    if (!r) return;
    setAdd({ name: "", type: "EMAIL", receiver: "", pin: "" });
    await load();
    setNotice(t("pay.added", { name: r.supplier.name }));
  }

  async function remove(e: Event) {
    e.preventDefault();
    if (!removing) return;
    reset();
    const r = await call<{ supplier: Supplier }>(`/suppliers/${removing.id}/remove`, {
      pin: removing.pin,
    });
    setRemoving(null);
    if (!r) return;
    await load();
    setNotice(t("pay.removed", { name: r.supplier.name }));
  }

  async function sendPayout(e: Event) {
    e.preventDefault();
    reset();
    const supplier = suppliers.find((s) => s.id === pay.supplierId);
    const minor = parseAmount(pay.amount, supplier?.currency ?? currency, 7);
    if (!minor) return setError(t("pay.amountFormat"));
    setBusy(true);
    const r = await call<{
      code: string;
      reason: string;
      params?: Record<string, string | number>;
    }>("/payouts", {
      supplierId: pay.supplierId,
      amountMinor: minor,
      ...(pay.note.trim() && { note: pay.note.trim() }),
      pin: pay.pin,
      ...(requestId && { requestId }),
    });
    setBusy(false);
    setPay((p) => ({ ...p, pin: "" }));
    if (!r) {
      // A refused payout never reached PayPal's books: the next try is a new request. A lost answer
      // keeps the id, so retrying returns the same payout instead of paying twice.
      if (lastError.current !== "PAYOUT_UNCONFIRMED") setRequestId(newRequestId());
      return void load();
    }
    setPay({ supplierId: "", amount: "", note: "", pin: "" });
    setRequestId(newRequestId());
    await load();
    setNotice(reasonText(r.code, r.params, r.reason, locale) ?? r.reason);
  }

  async function refresh(id: string) {
    reset();
    const r = await call<{ payout: Payout }>(`/payouts/${id}/refresh`, {});
    if (r) await load();
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleString(locale === "es" ? "es-MX" : "en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <section class="panel payouts-panel" ref={panel} aria-labelledby="payouts-title">
      <h2 id="payouts-title">{t("pay.title")}</h2>
      <p class="hint">{t("pay.intro")}</p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p class="hint" role="status">
          {notice}
        </p>
      )}

      <h3>{t("pay.suppliers")}</h3>
      {suppliers.length === 0 ? (
        <p class="muted">{t("pay.noSuppliers")}</p>
      ) : (
        <ul class="supplier-list">
          {suppliers.map((s) => (
            <li key={s.id}>
              <span class="supplier-name">{s.name}</span>
              <span class="supplier-receiver">
                {s.receiver} · {s.currency}
              </span>
              <button
                type="button"
                class="secondary"
                aria-label={t("pay.removeLabel", { name: s.name })}
                onClick={() => setRemoving({ id: s.id, name: s.name, pin: "" })}
              >
                {t("pay.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <form
          class="subform"
          onSubmit={remove}
          aria-label={t("pay.removeLabel", { name: removing.name })}
        >
          <label>
            {t("pay.removeConfirm", { name: removing.name })}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={removing.pin}
              onInput={(e) => setRemoving({ ...removing, pin: e.currentTarget.value })}
            />
          </label>
          <div class="row-actions">
            <button type="submit" class="primary" disabled={removing.pin.length < 4}>
              {t("pay.remove")}
            </button>
            <button type="button" class="secondary" onClick={() => setRemoving(null)}>
              {t("bo.cancel")}
            </button>
          </div>
        </form>
      )}

      <form class="subform" onSubmit={addSupplier} aria-label={t("pay.addTitle")}>
        <h3>{t("pay.addTitle")}</h3>
        <label>
          {t("pay.name")}
          <input
            value={add.name}
            maxLength={60}
            onInput={(e) => setAdd({ ...add, name: e.currentTarget.value })}
          />
        </label>
        <label>
          {t("pay.type")}
          <select
            value={add.type}
            onChange={(e) => setAdd({ ...add, type: e.currentTarget.value as RecipientType })}
          >
            <option value="EMAIL">{t("pay.typeEmail")}</option>
            <option value="PHONE">{t("pay.typePhone")}</option>
          </select>
        </label>
        {add.type === "PHONE" && sandbox && <p class="hint">{t("pay.phoneSandbox")}</p>}
        <label>
          {t("pay.receiver")}
          <input
            inputMode={add.type === "EMAIL" ? "email" : "tel"}
            autoComplete="off"
            value={add.receiver}
            onInput={(e) => setAdd({ ...add, receiver: e.currentTarget.value })}
          />
        </label>
        <label>
          {t("pay.pin")}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={add.pin}
            onInput={(e) => setAdd({ ...add, pin: e.currentTarget.value })}
          />
        </label>
        <button
          type="submit"
          class="primary"
          disabled={busy || !add.name.trim() || !add.receiver.trim() || add.pin.length < 4}
        >
          {t("pay.add")}
        </button>
      </form>

      <form class="subform" onSubmit={sendPayout} aria-label={t("pay.payTitle")}>
        <h3>{t("pay.payTitle")}</h3>
        {proposal && pay.supplierId === proposal.supplierId && (
          <p class="hint proposal" role="status">
            {t("pay.proposal", {
              name: proposal.supplierName,
              amount: formatMoney(proposal.amount),
            })}
          </p>
        )}
        {limits && (
          <p class="hint">
            {t("pay.limits", {
              max: formatMoney(limits.maxPayout),
              daily: formatMoney(limits.maxPayoutPerDay),
              left: formatMoney(limits.leftToday),
            })}
          </p>
        )}
        <label>
          {t("pay.supplier")}
          <select
            value={pay.supplierId}
            onChange={(e) => setPay({ ...pay, supplierId: e.currentTarget.value })}
          >
            <option value="">{t("pay.choose")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("pay.amount")}
          <input
            inputMode="decimal"
            value={pay.amount}
            onInput={(e) => setPay({ ...pay, amount: e.currentTarget.value })}
          />
        </label>
        <label>
          {t("pay.note")}
          <input
            value={pay.note}
            maxLength={200}
            onInput={(e) => setPay({ ...pay, note: e.currentTarget.value })}
          />
        </label>
        <label>
          {t("pay.pin")}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pay.pin}
            onInput={(e) => setPay({ ...pay, pin: e.currentTarget.value })}
          />
        </label>
        <button
          type="submit"
          class="primary"
          disabled={busy || !pay.supplierId || !pay.amount.trim() || pay.pin.length < 4}
        >
          {t("pay.pay")}
        </button>
      </form>

      <h3>{t("pay.history")}</h3>
      {payouts.length === 0 ? (
        <p class="muted">{t("pay.noHistory")}</p>
      ) : (
        <ul class="payout-list" data-testid="payout-history">
          {payouts.map((p) => (
            <li key={p.id}>
              <span class="payout-main">
                <strong>{formatMoney(p.amount)}</strong> · {p.supplierName}
              </span>
              <span class="payout-meta">
                <span class={`ledger-pill tone-${TONE[p.status] ?? "bad"}`}>
                  {t(`pay.status.${p.status}` as Key)}
                </span>{" "}
                {time(p.createdAt)}
                {p.note && ` · ${p.note}`}
              </span>
              {(p.status === "PENDING" || p.status === "PROCESSING" || p.status === "UNKNOWN") && (
                <button type="button" class="secondary" onClick={() => void refresh(p.id)}>
                  {t("pay.refreshStatus")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
