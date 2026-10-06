// web/src/backoffice.tsx: the vendor's back office at /backoffice — PIN login, today's sales,
// cash reconcile, invoice with QR, refunds (PIN asked again each time) and the optional agent.
// All numbers come from the server; this page only renders them.
import { useEffect, useState } from "preact/hooks";
import { formatMoney, type Money } from "../../shared/money";

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

const ERRORS: Record<string, string> = {
  PIN_WRONG: "PIN incorrecto.",
  PIN_LOCKED: "Demasiados intentos. Espera unos minutos.",
  SESSION_REQUIRED: "La sesión venció. Entra de nuevo con tu PIN.",
  AGENT_FAILED: "El asistente no respondió. Usa los botones.",
};

function toMinor(text: string): number | undefined {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export function BackOfficeApp() {
  const [token, setToken] = useState<string | null>(null);
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
      setError("Sin conexión con el servidor.");
      return undefined;
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string };
    if (!res.ok) {
      setError(data.reason ?? ERRORS[data.error ?? ""] ?? `Error: ${data.error ?? res.status}`);
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
    if (minor === undefined) return setError("Escribe el efectivo en pesos, por ejemplo 350.");
    const r = await call<Reconcile>("/reconcile", { cashMinor: minor });
    if (r) setRec(r);
  }

  async function makeInvoice(e: Event) {
    e.preventDefault();
    const minor = toMinor(invAmount);
    if (!minor) return setError("Escribe el monto de la factura en pesos.");
    const r = await call<Invoice>("/invoices", { amountMinor: minor, description: invDesc });
    if (r) setInvoice(r);
  }

  async function doRefund(e: Event) {
    e.preventDefault();
    if (!refund) return;
    const minor = toMinor(refund.amount);
    if (!minor) return setError("Escribe cuánto devolver en pesos.");
    const r = await call<{ reason: string }>("/refunds", {
      saleId: refund.saleId,
      amountMinor: minor,
      pin: refund.pin,
    });
    setRefund(null);
    if (r) {
      setNotice(r.reason);
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
        <h1>Mi negocio</h1>
        <form onSubmit={login} class="panel">
          <label>
            PIN de la vendedora
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onInput={(e) => setPin(e.currentTarget.value)}
            />
          </label>
          <button type="submit" class="primary" disabled={pin.length < 4}>
            Entrar
          </button>
        </form>
        {error && <p class="error">{error}</p>}
      </main>
    );

  return (
    <main class="backoffice">
      <header class="bar">
        <span class="stall">Mi negocio</span>
        <button type="button" class="secondary" onClick={() => setToken(null)}>
          Salir
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
          <h2>Pregúntale al asistente</h2>
          <input
            placeholder="¿Cuánto vendí hoy?"
            value={ask}
            onInput={(e) => setAsk(e.currentTarget.value)}
          />
          <input
            type="password"
            inputMode="numeric"
            placeholder="PIN (solo para devoluciones)"
            value={askPin}
            onInput={(e) => setAskPin(e.currentTarget.value)}
          />
          <button type="submit" class="primary" disabled={!ask.trim()}>
            Preguntar
          </button>
          {answer && <p>{answer}</p>}
        </form>
      )}

      <section class="panel">
        <h2>Ventas de hoy</h2>
        {today && (
          <>
            <p class="total">
              {formatMoney(today.total)} · {today.count} ventas
            </p>
            <table class="lines">
              <tbody>
                {today.sales.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {new Date(s.paidAt).toLocaleTimeString("es-MX", { timeStyle: "short" })}
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
                          Devolver
                        </button>
                      ) : (
                        "Devuelta"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <button type="button" class="secondary" onClick={() => void loadToday()}>
          Actualizar
        </button>
      </section>

      {refund && (
        <form class="panel" onSubmit={doRefund}>
          <h2>Devolución</h2>
          <label>
            ¿Cuánto devolver? (pesos)
            <input
              inputMode="decimal"
              value={refund.amount}
              onInput={(e) => setRefund({ ...refund, amount: e.currentTarget.value })}
            />
          </label>
          <label>
            Confirma con tu PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={refund.pin}
              onInput={(e) => setRefund({ ...refund, pin: e.currentTarget.value })}
            />
          </label>
          <button type="submit" class="primary">
            Devolver
          </button>
          <button type="button" class="secondary" onClick={() => setRefund(null)}>
            Cancelar
          </button>
        </form>
      )}

      <form class="panel" onSubmit={reconcile}>
        <h2>Cuadre del día</h2>
        <label>
          Efectivo en caja (pesos)
          <input inputMode="decimal" value={cash} onInput={(e) => setCash(e.currentTarget.value)} />
        </label>
        <button type="submit" class="primary">
          Cuadrar
        </button>
        {rec && (
          <table class="lines">
            <tbody>
              <tr>
                <td>PayPal</td>
                <td class="num">{formatMoney(rec.paypal)}</td>
              </tr>
              <tr>
                <td>Devoluciones</td>
                <td class="num">−{formatMoney(rec.refunded)}</td>
              </tr>
              <tr>
                <td>Efectivo</td>
                <td class="num">{formatMoney(rec.cash)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Total</strong>
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
        <h2>Factura con QR</h2>
        <label>
          Monto (pesos)
          <input
            inputMode="decimal"
            value={invAmount}
            onInput={(e) => setInvAmount(e.currentTarget.value)}
          />
        </label>
        <label>
          Concepto
          <input value={invDesc} onInput={(e) => setInvDesc(e.currentTarget.value)} />
        </label>
        <button type="submit" class="primary">
          Crear factura
        </button>
        {invoice && (
          <div class="qr">
            <img src={invoice.qr} alt={`QR de la factura ${invoice.id}`} />
            <p>
              {formatMoney(invoice.amount)} ·{" "}
              <a href={invoice.payUrl} target="_blank" rel="noreferrer">
                Abrir factura
              </a>
            </p>
          </div>
        )}
      </form>
    </main>
  );
}
