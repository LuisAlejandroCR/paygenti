// web/src/backoffice.tsx: the vendor's back office at /backoffice — PIN login, today's sales,
// cash reconcile, invoice with QR, refunds (PIN asked again each time) and the optional agent.
// All numbers come from the server; this page only renders them.
import { useEffect, useState } from "preact/hooks";
import { formatMoney, type Money } from "../../shared/money";
import { type Key, reasonText, useT } from "./i18n";
import { LangToggle } from "./lang-toggle";

/** Session token shared with /backoffice/ledger (same key as ledger.tsx; not imported to keep AG Grid lazy). */
const LEDGER_TOKEN_KEY = "paygent.bo.token";

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

const ERRORS: Record<string, Key> = {
  PIN_WRONG: "bo.pinWrong",
  PIN_LOCKED: "bo.pinLocked",
  SESSION_REQUIRED: "bo.sessionRequired",
  AGENT_FAILED: "bo.agentFailed",
};

function toMinor(text: string): number | undefined {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

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

  async function call<T>(path: string, body?: unknown): Promise<T | undefined> {
    setError("");
    const res = await fetch(`/api/backoffice${path}`, {
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
    fetch("/api/backoffice/config")
      .then((r) => r.json())
      .then((c: { agent: boolean }) => setAgent(c.agent))
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
    const r = await call<{ text: string }>("/agent", {
      message: ask,
      ...(askPin && { pin: askPin }),
    });
    setAskPin("");
    if (r) {
      setAnswer(r.text);
      void loadToday();
    }
  }

  if (!token)
    return (
      <main class="backoffice">
        <h1>
          {t("bo.title")} <LangToggle />
        </h1>
        <form onSubmit={login} class="panel">
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
        </form>
        {error && <p class="error">{error}</p>}
      </main>
    );

  return (
    <main class="backoffice">
      <header class="bar">
        <span class="stall">{t("bo.title")}</span>
        <LangToggle />
        <a class="secondary" href="/backoffice/ledger">
          {t("ledger.open")}
        </a>
        <button type="button" class="secondary" onClick={() => setToken(null)}>
          {t("bo.exit")}
        </button>
      </header>
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
        </form>
      )}

      <section class="panel">
        <h2>{t("bo.today")}</h2>
        {today && (
          <>
            <p class="total">
              {formatMoney(today.total)} · {t("bo.salesCount", { count: today.count })}
            </p>
            <table class="lines">
              <tbody>
                {today.sales.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {new Date(s.paidAt).toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", {
                        timeStyle: "short",
                      })}
                    </td>
                    <td>{s.items}</td>
                    <td class="num">{formatMoney(s.total)}</td>
                    <td>
                      {s.status === "paid" ? (
                        <button
                          type="button"
                          class="secondary"
                          onClick={() => setRefund({ saleId: s.id, amount: "", pin: "" })}
                        >
                          {t("bo.refund")}
                        </button>
                      ) : (
                        t("bo.refunded")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <button type="button" class="secondary" onClick={() => void loadToday()}>
          {t("bo.refresh")}
        </button>
      </section>

      {refund && (
        <form class="panel" onSubmit={doRefund}>
          <h2>{t("bo.refundTitle")}</h2>
          <label>
            {t("bo.refundAmount")}
            <input
              inputMode="decimal"
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
          <button type="submit" class="primary">
            {t("bo.refund")}
          </button>
          <button type="button" class="secondary" onClick={() => setRefund(null)}>
            {t("bo.cancel")}
          </button>
        </form>
      )}

      <form class="panel" onSubmit={reconcile}>
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

      <form class="panel" onSubmit={makeInvoice}>
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
    </main>
  );
}
