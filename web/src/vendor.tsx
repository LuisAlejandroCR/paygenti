// web/src/vendor.tsx: the vendor's screen — push-to-talk cart with keypad fallback, "Cobrar", QR of
// /t/:terminal, sticker writer and a live SSE feed; on sale.paid it shows PAGADO and announces it.
import { useEffect, useRef, useState } from "preact/hooks";
import { type Currency, formatMoney, fromPayPalValue, type Money } from "../../shared/money";
import type { CartLine, Sale, TerminalEvent } from "../../shared/types";
import { announcePaid, unlockAudio } from "./announce";
import { api } from "./api";
import { StickerPanel } from "./sticker";
import { VoiceCart } from "./voice";

type Phase = "entry" | "waiting" | "paid" | "failed" | "expired";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const;

export function toMinor(digits: string, currency: Currency): Money | undefined {
  const clean = digits.replace(/\.$/, "");
  if (!clean) return undefined;
  try {
    const m = fromPayPalValue(clean, currency);
    return m.minor > 0 ? m : undefined;
  } catch {
    return undefined;
  }
}

function press(digits: string, key: string): string {
  if (key === "⌫") return digits.slice(0, -1);
  if (key === ".") return digits.includes(".") ? digits : `${digits || "0"}.`;
  const [units = "", cents] = digits.split(".");
  if (cents !== undefined) return cents.length >= 2 ? digits : digits + key;
  if (units.length >= 6) return digits;
  return units === "0" ? key : digits + key;
}

export function VendorApp({ terminal }: { terminal: string }) {
  const [digits, setDigits] = useState("");
  const [phase, setPhase] = useState<Phase>("entry");
  const [sale, setSale] = useState<Sale>();
  const [stall, setStall] = useState("");
  const [currency, setCurrency] = useState<Currency>("MXN");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [left, setLeft] = useState(0);
  const [vendorId, setVendorId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payUrl, setPayUrl] = useState("");
  const [showSticker, setShowSticker] = useState(false);
  const saleRef = useRef<Sale | undefined>(undefined);
  saleRef.current = sale;

  useEffect(() => {
    fetch(`/api/terminals/${terminal}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("terminal"))))
      .then(
        (d: {
          vendor: { id: string; displayName: string; currency: Currency };
          payUrl: string;
        }) => {
          setStall(d.vendor.displayName);
          setVendorId(d.vendor.id);
          setPayUrl(d.payUrl);
          setCurrency(d.vendor.currency);
        },
      )
      .catch(() => setError("No se encontró esta terminal."));
  }, [terminal]);

  useEffect(() => {
    const es = new EventSource(`/api/terminals/${terminal}/events`);
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    const mine = (e: MessageEvent<string>): TerminalEvent | undefined => {
      const event = JSON.parse(e.data) as TerminalEvent;
      return event.sale.id === saleRef.current?.id ? event : undefined;
    };
    es.addEventListener("sale.paid", (e) => {
      const ev = mine(e as MessageEvent<string>);
      if (!ev) return;
      setSale(ev.sale);
      setPhase("paid");
      announcePaid(ev.sale.total);
    });
    es.addEventListener("sale.failed", (e) => {
      const ev = mine(e as MessageEvent<string>);
      if (ev) setPhase("failed");
    });
    es.addEventListener("sale.expired", (e) => {
      const ev = mine(e as MessageEvent<string>);
      if (ev) setPhase("expired");
    });
    return () => es.close();
  }, [terminal]);

  useEffect(() => {
    if (phase !== "waiting" || !sale) return;
    const tick = () => {
      const ms = Date.parse(sale.expiresAt) - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) setPhase("expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, sale]);

  const amount = toMinor(digits, currency);

  async function charge(fromCart = false) {
    if (busy || (fromCart ? cart.length === 0 : !amount)) return;
    unlockAudio();
    setBusy(true);
    setError("");
    try {
      const { sale: created } = fromCart
        ? await api.createSaleFromCart(terminal, cart)
        : await api.createSale(terminal, amount?.minor ?? 0);
      setSale(created);
      setPhase("waiting");
    } catch {
      setError("No se pudo crear el cobro. Revisa la conexión e intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDigits("");
    setCart([]);
    setSale(undefined);
    setPhase("entry");
  }

  return (
    <main class={`vendor phase-${phase}`}>
      <header class="bar">
        <span class="stall">{stall || "paygent"}</span>
        <span class={online ? "dot on" : "dot"} role="status">
          {online ? "En línea" : "Sin conexión"}
        </span>
      </header>

      {phase === "entry" && vendorId && (
        <VoiceCart
          vendorId={vendorId}
          cart={cart}
          onCart={setCart}
          onCharge={() => charge(true)}
          busy={busy}
        />
      )}

      {phase === "entry" && cart.length === 0 && (
        <section class="entry" aria-label="Captura del monto">
          <output class="amount" aria-live="polite">
            ${digits || "0"}
          </output>
          <div class="keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                class="key"
                aria-label={k === "⌫" ? "Borrar" : k === "." ? "Punto decimal" : k}
                onClick={() => setDigits((d) => press(d, k))}
              >
                {k}
              </button>
            ))}
          </div>
          <button type="button" class="primary" disabled={!amount || busy} onClick={() => charge()}>
            {busy ? "Creando…" : amount ? `Cobrar ${formatMoney(amount)}` : "Cobrar"}
          </button>
        </section>
      )}

      {phase === "waiting" && sale && (
        <section class="waiting" aria-live="polite">
          <p class="total">{formatMoney(sale.total)}</p>
          <img
            class="qr"
            src={`/api/terminals/${terminal}/qr.svg`}
            alt={`Código QR para pagar en el puesto ${terminal}`}
          />
          <p class="hint">Escanea o toca el sticker para pagar con PayPal</p>
          <p class="timer">
            Esperando pago… {Math.floor(left / 60000)}:
            {String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}
          </p>
          <button type="button" class="secondary" onClick={reset}>
            Cancelar
          </button>
        </section>
      )}

      {phase === "paid" && sale && (
        <section class="result paid" role="alert">
          <p class="big">PAGADO</p>
          <p class="total">{formatMoney(sale.total)}</p>
          <button type="button" class="primary" onClick={reset}>
            Nueva venta
          </button>
        </section>
      )}

      {(phase === "failed" || phase === "expired") && (
        <section class="result bad" role="alert">
          <p class="big">{phase === "failed" ? "Pago rechazado" : "Cobro expirado"}</p>
          <button type="button" class="primary" onClick={reset}>
            Nueva venta
          </button>
        </section>
      )}

      {phase === "entry" && payUrl && (
        <button type="button" class="link" onClick={() => setShowSticker((v) => !v)}>
          {showSticker ? "Ocultar sticker" : "Grabar sticker"}
        </button>
      )}
      {phase === "entry" && showSticker && <StickerPanel terminal={terminal} url={payUrl} />}

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
