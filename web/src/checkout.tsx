// web/src/checkout.tsx: the customer's /pay/:saleId page — stall, lines and total before paying.
// Sandbox: PayPal JS SDK buttons approve the server-created order, then our server captures.
// Mock: "Pagar (simulado)" / "Simular rechazo" drive the mock gateway through the same capture.
// Listens to the terminal's SSE feed so a vendor cancel (or paid/expired) shows up live.
import { useEffect, useRef, useState } from "preact/hooks";
import { formatMoney, money } from "../../shared/money";
import type { Sale, TerminalEvent } from "../../shared/types";
import { ApiError, type AppConfig, api } from "./api";
import { type Key, type Locale, lineName, useT } from "./i18n";
import { LangToggle } from "./lang-toggle";

interface PayPalButtons {
  render(el: HTMLElement): Promise<void>;
}
interface PayPalNamespace {
  Buttons(opts: {
    style?: Record<string, string | number>;
    createOrder: () => string;
    onApprove: () => Promise<void>;
    onCancel?: () => void;
    onError: (err: unknown) => void;
  }): PayPalButtons;
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

function loadSdk(clientId: string, currency: string, locale: Locale): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const q = new URLSearchParams({
      "client-id": clientId,
      currency,
      intent: "capture",
      locale: locale === "es" ? "es_MX" : "en_US",
    });
    s.src = `https://www.paypal.com/sdk/js?${q}`;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("sdk")));
    s.onerror = () => reject(new Error("sdk"));
    document.head.append(s);
  });
}

export function Checkout({ saleId }: { saleId: string }) {
  const { t, locale } = useT();
  const [sale, setSale] = useState<Sale>();
  const [stall, setStall] = useState("");
  const [config, setConfig] = useState<AppConfig>();
  const [error, setError] = useState<Key | "">("");
  const [busy, setBusy] = useState(false);
  const buttonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.sale(saleId), api.config()])
      .then(([s, c]) => {
        setSale(s.sale);
        setStall(s.stall);
        setConfig(c);
      })
      .catch(() => setError("checkout.notFound"));
  }, [saleId]);

  const terminalId = sale?.terminalId;
  useEffect(() => {
    if (!terminalId) return;
    const es = new EventSource(`/api/terminals/${terminalId}/events`);
    const onEvent = (e: Event) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as TerminalEvent;
      if (ev.sale.id === saleId) setSale(ev.sale);
    };
    for (const type of ["sale.paid", "sale.failed", "sale.expired", "sale.cancelled"])
      es.addEventListener(type, onEvent);
    return () => es.close();
  }, [terminalId, saleId]);

  async function capture() {
    try {
      const { sale: updated } = await api.capture(saleId);
      setSale(updated);
      if (updated.status === "failed") setError("checkout.declinedRetry");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (code === "SALE_EXPIRED") setError("checkout.expired");
      else if (code === "SALE_CANCELLED") setError("checkout.cancelled");
      else setError("checkout.failed");
      api.sale(saleId).then(
        (s) => setSale(s.sale),
        () => {},
      );
    }
  }

  const payable = sale && (sale.status === "open" || sale.status === "approved");

  useEffect(() => {
    if (!payable || config?.paypal !== "sandbox" || !config.clientId || !buttonsRef.current) return;
    const el = buttonsRef.current;
    let cancelled = false;
    loadSdk(config.clientId, sale.total.currency, locale)
      .then((pp) => {
        if (cancelled) return;
        el.replaceChildren();
        return pp
          .Buttons({
            style: { layout: "vertical", shape: "pill", height: 55 },
            createOrder: () => sale.orderId,
            onApprove: capture,
            onError: () => setError("checkout.paypalError"),
          })
          .render(el);
      })
      .catch(() => setError("checkout.sdkError"));
    return () => {
      cancelled = true;
    };
  }, [payable, config, sale?.orderId]);

  async function simulate(decline: boolean) {
    if (!sale || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.mockApprove(sale.orderId, decline);
      await capture();
    } catch {
      setError("checkout.simulateError");
    } finally {
      setBusy(false);
    }
  }

  if (!sale) {
    return (
      <main class="checkout">
        <p class={error ? "error" : "hint"} role={error ? "alert" : "status"}>
          {error ? t(error) : t("checkout.loading")}
        </p>
      </main>
    );
  }

  return (
    <main class="checkout">
      <h1 class="stall">
        {stall} <LangToggle />
      </h1>
      <table class="lines">
        <caption class="sr-only">{t("checkout.items")}</caption>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.sku}>
              <td>
                {l.qty} × {lineName(l, locale)}
              </td>
              <td class="num">
                {formatMoney(money(l.unitPrice.minor * l.qty, l.unitPrice.currency))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t("checkout.total")}</th>
            <td class="num total">{formatMoney(sale.total)}</td>
          </tr>
        </tfoot>
      </table>

      {sale.status === "paid" && (
        <p class="result paid" role="alert">
          {t("checkout.paid")}
        </p>
      )}
      {sale.status === "refunded" && <p class="result">{t("checkout.refunded")}</p>}
      {sale.status === "expired" && (
        <p class="result bad" role="alert">
          {t("checkout.expired")}
        </p>
      )}
      {sale.status === "cancelled" && (
        <p class="result bad" role="alert">
          {t("checkout.cancelled")}
        </p>
      )}
      {sale.status === "failed" && (
        <p class="result bad" role="alert">
          {t("checkout.declined")}
        </p>
      )}

      {payable && config?.paypal === "sandbox" && <div ref={buttonsRef} class="pp-buttons" />}
      {payable && config?.paypal === "mock" && (
        <div class="actions">
          <button type="button" class="primary" disabled={busy} onClick={() => simulate(false)}>
            {busy ? t("checkout.processing") : t("checkout.payMock")}
          </button>
          <button type="button" class="secondary" disabled={busy} onClick={() => simulate(true)}>
            {t("checkout.declineMock")}
          </button>
          <p class="hint">{t("checkout.demoNote")}</p>
        </div>
      )}

      {error && sale.status !== "expired" && sale.status !== "cancelled" && (
        <p class="error" role="alert">
          {t(error)}
        </p>
      )}
    </main>
  );
}
