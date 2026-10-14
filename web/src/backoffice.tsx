// web/src/backoffice.tsx: the vendor's back office at /backoffice — PIN login, today's sales,
// cash reconcile, invoice with QR, refunds (PIN asked again each time), suppliers and payouts, and
// the optional agent (whose payout proposals prefill the payouts panel for PIN confirmation).
// All numbers come from the server; this page only renders them. Jump links reach each panel; a
// refund is confirmed inline under its own sale, in an outlined (never filled) destructive panel.

import { useEffect, useState } from "preact/hooks";
import {
  type Currency,
  formatMoney,
  type Money,
  parseAmount,
  toPayPalValue,
} from "../../shared/money";
import { FootprintPanel } from "./footprint";
import { type Key, reasonText, useT } from "./i18n";
import { AlertIcon, UndoIcon } from "./icons";
import { LangToggle } from "./lang-toggle";
import { MenuEditor } from "./menu-editor";
import { ApprovalsPanel, ClaudeAccessPanel, StallSwitcher } from "./owner";
import { PassportPanel } from "./passport-panel";
import { type PayoutProposal, PayoutsPanel } from "./payouts-panel";
import { boUrl, tokenKey } from "./stall";

/** Session token shared with /backoffice/ledger (same key as ledger.tsx; not imported to keep AG Grid lazy). */
const LEDGER_TOKEN_KEY = tokenKey();

/** One tool the agent ran, as the server reports it. */
interface AgentToolRun {
  tool: string;
  ok: boolean;
  summary?: string;
  result?: { proposal?: PayoutProposal };
}

interface SaleRow {
  id: string;
  paidAt: string;
  total: Money;
  status: string;
  refunded: Money;
  items: string;
}
interface SalesToday {
  day: string;
  count: number;
  total: Money;
  refunded: Money;
  sales: SaleRow[];
}
interface Reconcile {
  paypal: Money;
  refunded: Money;
  paypalNet: Money;
  cash: Money;
  total: Money;
}
interface Invoice {
  id: string;
  amount: Money;
  payUrl: string;
  qr: string;
}

/** Sales shown before "Show all": the full day lives in the ledger. */
const SALES_PREVIEW = 5;

const ERRORS: Record<string, Key> = {
  PIN_WRONG: "bo.pinWrong",
  PIN_LOCKED: "bo.pinLocked",
  SESSION_REQUIRED: "bo.sessionRequired",
  AGENT_FAILED: "bo.agentFailed",
};

export function BackOfficeApp() {
  const { t, locale } = useT();
  const [token, setToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(LEDGER_TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [agent, setAgent] = useState(false);
  const [currency, setCurrency] = useState<Currency>("MXN");
  const toMinor = (text: string) => parseAmount(text, currency, 7);
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const [today, setToday] = useState<SalesToday | null>(null);
  const [cash, setCash] = useState("");
  const [rec, setRec] = useState<Reconcile | null>(null);
  const [invAmount, setInvAmount] = useState("");
  const [invDesc, setInvDesc] = useState("");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [refund, setRefund] = useState<{ saleId: string; amount: string; pin: string } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [ask, setAsk] = useState("");
  const [askPin, setAskPin] = useState("");
  const [answer, setAnswer] = useState("");
  const [ran, setRan] = useState<AgentToolRun[]>([]);
  const [proposal, setProposal] = useState<PayoutProposal | null>(null);
  const [allSales, setAllSales] = useState(false);
  const salesCount = (count: number) =>
    count === 1 ? t("bo.salesCountOne") : t("bo.salesCount", { count });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", { timeStyle: "short" });

  async function call<T>(path: string, body?: unknown): Promise<T | undefined> {
    setError("");
    const res = await fetch(boUrl(path), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
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
      const known = ERRORS[data.error ?? ""];
      setError(
        reasonText(data.error, data.params, data.reason, locale) ??
          (known ? t(known) : t("bo.error", { code: data.error ?? res.status })),
      );
      if (res.status === 401 && data.error === "SESSION_REQUIRED") setToken(null);
      return undefined;
    }
    return data;
  }

  useEffect(() => {
    fetch(boUrl("/config"))
      .then((r) => r.json())
      .then((c: { agent: boolean; limits?: { currency?: Currency } }) => {
        setAgent(c.agent);
        if (c.limits?.currency) setCurrency(c.limits.currency);
      })
      .catch(() => setAgent(false));
  }, []);

  useEffect(() => {
    if (token) void loadToday();
    try {
      if (token) sessionStorage.setItem(LEDGER_TOKEN_KEY, token);
      else sessionStorage.removeItem(LEDGER_TOKEN_KEY);
    } catch {
      // Storage blocked: the ledger page will ask to sign in again.
    }
  }, [token]);

  async function login(e: Event) {
    e.preventDefault();
    const r = await call<{ token: string }>("/session", { pin });
    setPin("");
    if (r) setToken(r.token);
  }

  async function loadToday() {
    const r = await call<SalesToday>("/sales-today");
    if (r) setToday(r);
  }

  async function reconcile(e: Event) {
    e.preventDefault();
    const minor = toMinor(cash || "0");
    if (minor === undefined) return setError(t("bo.cashFormat"));
    const r = await call<Reconcile>("/reconcile", { cashMinor: minor });
    if (r) setRec(r);
  }

  async function makeInvoice(e: Event) {
    e.preventDefault();
    const minor = toMinor(invAmount);
    if (!minor) return setError(t("bo.invoiceFormat"));
    const r = await call<Invoice>("/invoices", { amountMinor: minor, description: invDesc });
    if (r) setInvoice(r);
  }

  async function doRefund(e: Event) {
    e.preventDefault();
    if (!refund) return;
    setNotice("");
    const minor = toMinor(refund.amount);
    if (!minor) return setError(t("bo.refundFormat"));
    const r = await call<{
      code: string;
      reason: string;
      params?: Record<string, string | number>;
    }>("/refunds", {
      saleId: refund.saleId,
      amountMinor: minor,
      pin: refund.pin,
    });
    setRefund(null);
    if (r) {
      setNotice(reasonText(r.code, r.params, r.reason, locale) ?? r.reason);
      void loadToday();
    }
  }

  async function askAgent(e: Event) {
    e.preventDefault();
    const r = await call<{
      text: string;
      code?: string;
      params?: Record<string, string | number>;
      actions?: AgentToolRun[];
    }>("/agent", {
      message: ask,
      locale,
      ...(askPin && { pin: askPin }),
    });
    setAskPin("");
    if (r) {
      setAnswer((r.code && reasonText(r.code, r.params, undefined, locale)) || r.text);
      setRan(r.actions ?? []);
      const proposed = r.actions?.find((a) => a.tool === "propose_payout" && a.ok)?.result;
      if (proposed?.proposal) setProposal({ ...proposed.proposal });
      void loadToday();
    }
  }

  if (!token)
    return (
      <main class="backoffice">
        <header class="bar">
          <h1 class="stall">{t("bo.title")}</h1>
          <nav class="bar-actions">
            <StallSwitcher />
            <LangToggle />
          </nav>
        </header>
        <form onSubmit={login} class="panel login-card">
          <p class="hint">{t("bo.loginHint")}</p>
          <label>
            {t("bo.pin")}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onInput={(e) => setPin(e.currentTarget.value)}
            />
          </label>
          <button type="submit" class="primary" disabled={pin.length < 4}>
            {t("bo.enter")}
          </button>
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </form>
        <a class="link back-link" href="/">
          {t("bo.backToRegister")}
        </a>
      </main>
    );

  const sections: [string, Key][] = [
    ["sales", "bo.today"],
    ["reconcile", "bo.reconcileTitle"],
    ["invoice", "bo.invoiceTitle"],
    ["payouts", "pay.title"],
    ["passport", "passport.title"],
    ["footprint", "footprint.manage"],
    ["menu", "menu.title"],
    ["claude", "owner.claudeTitle"],
  ];
  const shown = today ? (allSales ? today.sales : today.sales.slice(0, SALES_PREVIEW)) : [];

  return (
    <main class="backoffice">
      <header class="bar">
        <h1 class="stall">{t("bo.title")}</h1>
        <nav class="bar-actions">
          <StallSwitcher />
          <LangToggle />
          <a class="bar-btn" href="/setup">
            {t("onb.settings")}
          </a>
          <a class="bar-btn" href="/backoffice/ledger">
            {t("ledger.open")}
          </a>
          <button type="button" class="bar-btn" onClick={() => setToken(null)}>
            {t("bo.exit")}
          </button>
        </nav>
      </header>
      <nav class="section-nav" aria-label={t("bo.sections")}>
        {sections.map(([id, key]) => (
          <a key={id} href={`#${id}`}>
            {t(key)}
          </a>
        ))}
      </nav>
      {/* Sticky, so a refund result or an error stays in view wherever the vendor scrolled. */}
      <div class="bo-messages">
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
      </div>

      {agent && (
        <form class="panel" onSubmit={askAgent}>
          <h2>{t("bo.askTitle")}</h2>
          <input
            placeholder={t("bo.askPlaceholder")}
            value={ask}
            onInput={(e) => setAsk(e.currentTarget.value)}
          />
          <input
            type="password"
            inputMode="numeric"
            placeholder={t("bo.askPin")}
            value={askPin}
            onInput={(e) => setAskPin(e.currentTarget.value)}
          />
          <button type="submit" class="primary" disabled={!ask.trim()}>
            {t("bo.ask")}
          </button>
          {answer && <p>{answer}</p>}
          {ran.length > 0 && (
            <div class="agent-tools" data-testid="agent-tools">
              <p class="hint">{t("bo.toolsRan")}</p>
              <ul>
                {ran.map((a, i) => (
                  <li key={`${a.tool}-${i}`} class={a.ok ? "ok" : "denied"}>
                    <code>{a.tool}</code>
                    {a.tool.startsWith("paypal_") && (
                      <span class="badge">{t("bo.toolPaypal")}</span>
                    )}
                    {a.summary && <span> · {a.summary}</span>}
                  </li>
                ))}
              </ul>
              {ran.some((a) => a.tool === "refund" || a.tool === "propose_payout") && (
                <p class="hint">{t("bo.toolLocked")}</p>
              )}
            </div>
          )}
        </form>
      )}

      <ApprovalsPanel token={token} onDone={() => void loadToday()} />

      <section class="panel" id="sales">
        <h2>{t("bo.today")}</h2>
        {today && (
          <p class="total today-total">
            {formatMoney(today.total)} · {salesCount(today.count)}
          </p>
        )}
        {today && today.sales.length === 0 && <p class="empty-state">{t("bo.noSales")}</p>}
        {shown.length > 0 && (
          <ul class="sale-list">
            {shown.map((s) => (
              <li key={s.id}>
                <div class="sale-main">
                  <span class="sale-items">{s.items}</span>
                  <span class="num sale-amount">{formatMoney(s.total)}</span>
                </div>
                <div class="sale-meta">
                  <span>{time(s.paidAt)}</span>
                  {s.refunded.minor > 0 && (
                    <span class="ledger-pill tone-warn">
                      {s.status === "paid"
                        ? t("bo.refundedAmount", { amount: formatMoney(s.refunded) })
                        : t("bo.refunded")}
                    </span>
                  )}
                  {s.status === "paid" && refund?.saleId !== s.id && (
                    <button
                      type="button"
                      class="danger row-btn"
                      onClick={() => setRefund({ saleId: s.id, amount: "", pin: "" })}
                    >
                      <UndoIcon size={18} />
                      {t("bo.refund")}
                    </button>
                  )}
                </div>
                {refund?.saleId === s.id && (
                  <form class="panel confirm-panel" onSubmit={doRefund}>
                    <h3 class="confirm-title">
                      <AlertIcon size={20} />
                      {t("bo.refundOf")}
                    </h3>
                    <p class="hint">{t("bo.refundHint")}</p>
                    <label>
                      {t("bo.refundAmount")}
                      <input
                        inputMode="decimal"
                        placeholder={toPayPalValue(s.total)}
                        value={refund.amount}
                        onInput={(e) => setRefund({ ...refund, amount: e.currentTarget.value })}
                      />
                    </label>
                    <label>
                      {t("bo.confirmPin")}
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        value={refund.pin}
                        onInput={(e) => setRefund({ ...refund, pin: e.currentTarget.value })}
                      />
                    </label>
                    <div class="confirm-actions">
                      <button type="submit" class="danger block">
                        <UndoIcon size={20} />
                        {t("bo.refund")}
                      </button>
                      <button type="button" class="secondary" onClick={() => setRefund(null)}>
                        {t("bo.cancel")}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {today && today.sales.length > SALES_PREVIEW && (
          <button
            type="button"
            class="link"
            aria-expanded={allSales}
            onClick={() => setAllSales((v) => !v)}
          >
            {allSales ? t("bo.showFewer") : t("bo.showAll", { count: today.sales.length })}
          </button>
        )}
        <button type="button" class="secondary" onClick={() => void loadToday()}>
          {t("bo.refresh")}
        </button>
      </section>

      <form class="panel" id="reconcile" onSubmit={reconcile}>
        <h2>{t("bo.reconcileTitle")}</h2>
        <label>
          {t("bo.cash")}
          <input inputMode="decimal" value={cash} onInput={(e) => setCash(e.currentTarget.value)} />
        </label>
        <button type="submit" class="primary">
          {t("bo.reconcile")}
        </button>
        {rec && (
          <table class="lines">
            <tbody>
              <tr>
                <td>PayPal</td>
                <td class="num">{formatMoney(rec.paypal)}</td>
              </tr>
              <tr>
                <td>{t("bo.refunds")}</td>
                <td class="num">−{formatMoney(rec.refunded)}</td>
              </tr>
              <tr>
                <td>{t("bo.cashRow")}</td>
                <td class="num">{formatMoney(rec.cash)}</td>
              </tr>
              <tr>
                <td>
                  <strong>{t("bo.total")}</strong>
                </td>
                <td class="num">
                  <strong>{formatMoney(rec.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </form>

      <form class="panel" id="invoice" onSubmit={makeInvoice}>
        <h2>{t("bo.invoiceTitle")}</h2>
        <label>
          {t("bo.amount")}
          <input
            inputMode="decimal"
            value={invAmount}
            onInput={(e) => setInvAmount(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("bo.concept")}
          <input value={invDesc} onInput={(e) => setInvDesc(e.currentTarget.value)} />
        </label>
        <button type="submit" class="primary">
          {t("bo.createInvoice")}
        </button>
        {invoice && (
          <div class="qr">
            <img src={invoice.qr} alt={t("bo.invoiceQrAlt", { id: invoice.id })} />
            <p>
              {formatMoney(invoice.amount)} ·{" "}
              <a href={invoice.payUrl} target="_blank" rel="noreferrer">
                {t("bo.openInvoice")}
              </a>
            </p>
          </div>
        )}
      </form>

      <PayoutsPanel
        token={token}
        currency={currency}
        proposal={proposal}
        onAuthLost={() => setToken(null)}
      />

      <PassportPanel currency={currency} token={token} onAuthLost={() => setToken(null)} />

      <FootprintPanel currency={currency} token={token} onAuthLost={() => setToken(null)} />

      <MenuEditor token={token} onAuthLost={() => setToken(null)} />

      <ClaudeAccessPanel />
    </main>
  );
}
