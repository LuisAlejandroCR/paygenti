// web/src/checkout.tsx: the customer's /pay/:saleId page — stall, lines and total before paying.
// Sandbox: PayPal JS SDK buttons approve the server-created order, then our server captures.
// Mock: "Pagar (simulado)" / "Simular rechazo" drive the mock gateway through the same capture.
import { useEffect, useRef, useState } from "preact/hooks";
import { formatMoney, money } from "../../shared/money";
import type { Sale } from "../../shared/types";
import { type AppConfig, ApiError, api } from "./api";

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

function loadSdk(clientId: string, currency: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const q = new URLSearchParams({ "client-id": clientId, currency, intent: "capture", locale: "es_MX" });
    s.src = `https://www.paypal.com/sdk/js?${q}`;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("sdk")));
    s.onerror = () => reject(new Error("sdk"));
    document.head.append(s);
  });
}

export function Checkout({ saleId }: { saleId: string }) {
  const [sale, setSale] = useState<Sale>();
  const [stall, setStall] = useState("");
  const [config, setConfig] = useState<AppConfig>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const buttonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.sale(saleId), api.config()])
      .then(([s, c]) => {
        setSale(s.sale);
        setStall(s.stall);
        setConfig(c);
      })
      .catch(() => setError("No encontramos esta venta."));
  }, [saleId]);

  async function capture() {
    try {
      const { sale: updated } = await api.capture(saleId);
      setSale(updated);
      if (updated.status === "failed") setError("El pago fue rechazado. Intenta con otro método.");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (code === "SALE_EXPIRED") setError("Esta venta expiró. Pide a la vendedora un cobro nuevo.");
      else setError("No se pudo completar el pago. Intenta de nuevo.");
      api.sale(saleId).then((s) => setSale(s.sale), () => {});
    }
  }

  const payable = sale && (sale.status === "open" || sale.status === "approved");

  useEffect(() => {
    if (!payable || config?.paypal !== "sandbox" || !config.clientId || !buttonsRef.current) return;
    const el = buttonsRef.current;
    let cancelled = false;
    loadSdk(config.clientId, sale.total.currency)
      .then((pp) => {
        if (cancelled) return;
        el.replaceChildren();
        return pp
          .Buttons({
            style: { layout: "vertical", shape: "pill", height: 55 },
            createOrder: () => sale.orderId,
            onApprove: capture,
            onError: () => setError("PayPal no pudo procesar el pago."),
          })
          .render(el);
      })
      .catch(() => setError("No se pudo cargar PayPal. Revisa tu conexión."));
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
      setError("No se pudo simular el pago.");
    } finally {
      setBusy(false);
    }
  }

  if (!sale) {
    return (
      <main class="checkout">
        <p class={error ? "error" : "hint"} role={error ? "alert" : "status"}>
          {error || "Cargando…"}
        </p>
      </main>
    );
  }

  return (
    <main class="checkout">
      <h1 class="stall">{stall}</h1>
      <table class="lines">
        <caption class="sr-only">Productos</caption>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.sku}>
              <td>
                {l.qty} × {l.name}
              </td>
              <td class="num">{formatMoney(money(l.unitPrice.minor * l.qty, l.unitPrice.currency))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td class="num total">{formatMoney(sale.total)}</td>
          </tr>
        </tfoot>
      </table>

      {sale.status === "paid" && (
        <p class="result paid" role="alert">
          ¡Pago recibido! Gracias.
        </p>
      )}
      {sale.status === "refunded" && <p class="result">Este pago fue reembolsado.</p>}
      {sale.status === "expired" && (
        <p class="result bad" role="alert">
          Esta venta expiró. Pide a la vendedora un cobro nuevo.
        </p>
      )}
      {sale.status === "failed" && (
        <p class="result bad" role="alert">
          Pago rechazado.
        </p>
      )}

      {payable && config?.paypal === "sandbox" && <div ref={buttonsRef} class="pp-buttons" />}
      {payable && config?.paypal === "mock" && (
        <div class="actions">
          <button type="button" class="primary" disabled={busy} onClick={() => simulate(false)}>
            {busy ? "Procesando…" : "Pagar (simulado)"}
          </button>
          <button type="button" class="secondary" disabled={busy} onClick={() => simulate(true)}>
            Simular rechazo
          </button>
          <p class="hint">Modo demostración: no se mueve dinero real.</p>
        </div>
      )}

      {error && sale.status !== "expired" && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
