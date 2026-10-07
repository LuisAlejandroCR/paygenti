// web/src/vendor.tsx: the vendor's screen — push-to-talk cart with keypad fallback, "Cobrar", QR of
// /t/:terminal, sticker writer and a live SSE feed; on sale.paid it shows PAGADO and announces it.
// On load it adopts the terminal's open sale (so /judge never shows a sale the vendor cannot see);
// "Cancel" cancels that sale on the server so the sticker stops pointing at it.
import { useEffect, useRef, useState } from "preact/hooks";
import { currencyInfo, decimalsOf } from "../../shared/currency";
import { type Currency, formatMoney, fromPayPalValue, type Money } from "../../shared/money";
import type { CartLine, CatalogItem, Sale, TerminalEvent } from "../../shared/types";
import { announcePaid, unlockAudio } from "./announce";
import { ApiError, api } from "./api";
import { useT } from "./i18n";
import { BackspaceIcon, ClockIcon, PaidCheck, XCircleIcon } from "./icons";
import { LangToggle } from "./lang-toggle";
import { Onboarding } from "./onboarding";
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

export function press(digits: string, key: string, decimals = 2): string {
  if (key === "⌫") return digits.slice(0, -1);
  if (key === ".") return decimals === 0 || digits.includes(".") ? digits : `${digits || "0"}.`;
  const [units = "", cents] = digits.split(".");
  if (cents !== undefined) return cents.length >= decimals ? digits : digits + key;
  if (units.length >= 6) return digits;
  return units === "0" ? key : digits + key;
}

export function VendorApp({
  terminal,
  onSale,
}: {
  terminal: string;
  onSale?: (sale: Sale | undefined) => void;
}) {
  const { t } = useT();
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
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [keypadOpen, setKeypadOpen] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [reviewPrices, setReviewPrices] = useState(false);
  const saleRef = useRef<Sale | undefined>(undefined);
  saleRef.current = sale;

  useEffect(() => {
    fetch(`/api/terminals/${terminal}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("terminal"))))
      .then(
        (d: {
          vendor: {
            id: string;
            displayName: string;
            currency: Currency;
            catalog?: CatalogItem[];
            onboarded?: boolean;
            pricesNeedReview?: boolean;
          };
          payUrl: string;
          openSale: Sale | null;
        }) => {
          setStall(d.vendor.displayName);
          setVendorId(d.vendor.id);
          setPayUrl(d.payUrl);
          setCurrency(d.vendor.currency);
          setCatalog(d.vendor.catalog ?? []);
          setNeedsSetup(d.vendor.onboarded === false);
          setReviewPrices(!!d.vendor.pricesNeedReview);
          // Resume the sale already waiting on this terminal instead of hiding it behind a keypad.
          if (d.openSale && !saleRef.current) {
            setSale(d.openSale);
            onSale?.(d.openSale);
            setPhase("waiting");
          }
        },
      )
      .catch(() => setError(t("vendor.terminalNotFound")));
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
    es.addEventListener("sale.cancelled", (e) => {
      if (mine(e as MessageEvent<string>)) reset();
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
      onSale?.(created);
      setPhase("waiting");
    } catch {
      setError(t("vendor.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const current = saleRef.current;
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.cancelSale(current.id);
      reset();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (code === "SALE_ALREADY_PAID") {
        const { sale: paid } = await api.sale(current.id).catch(() => ({ sale: current }));
        setSale(paid);
        setPhase("paid");
      } else if (code === "SALE_NOT_OPEN" || code === "SALE_NOT_FOUND") {
        reset();
      } else {
        setError(t("vendor.cancelFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDigits("");
    setCart([]);
    setSale(undefined);
    onSale?.(undefined);
    setPhase("entry");
  }

  if (needsSetup)
    return (
      <Onboarding
        terminal={terminal}
        firstRun
        onDone={(v) => {
          setStall(v.displayName);
          setCurrency(v.currency);
          setCatalog(v.catalog);
          setReviewPrices(!!v.pricesNeedReview);
          setDigits("");
          setNeedsSetup(false);
        }}
      />
    );

  const decimals = decimalsOf(currency);
  const symbol = currencyInfo(currency).symbol;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <main class={`vendor phase-${phase}`}>
      <header class="bar">
        <span class="stall">{stall || "paygent"}</span>
        <span class={online ? "status on" : "status"} role="status">
          {online ? t("app.online") : t("app.offline")}
        </span>
        <LangToggle />
      </header>

      {phase === "entry" && vendorId && (
        <VoiceCart
          vendorId={vendorId}
          cart={cart}
          onCart={setCart}
          onCharge={() => charge(true)}
          busy={busy}
          catalog={catalog}
          keypad={{ open: keypadOpen, toggle: () => setKeypadOpen((v) => !v) }}
        />
      )}

      {phase === "entry" && cart.length === 0 && keypadOpen && (
        <section class="entry card" aria-label={t("vendor.amountEntry")}>
          <output class="amount num" aria-live="polite">
            {symbol}
            {digits || "0"}
          </output>
          <div class="keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                class="key num"
                aria-label={k === "⌫" ? t("vendor.delete") : k === "." ? t("vendor.decimal") : k}
                disabled={k === "." && decimals === 0}
                onClick={() => setDigits((d) => press(d, k, decimals))}
              >
                {k === "⌫" ? <BackspaceIcon size={26} /> : k}
              </button>
            ))}
          </div>
          <button type="button" class="primary" disabled={!amount || busy} onClick={() => charge()}>
            {busy
              ? t("vendor.creating")
              : amount
                ? t("vendor.chargeAmount", { amount: formatMoney(amount) })
                : t("vendor.charge")}
          </button>
        </section>
      )}

      {phase === "waiting" && sale && (
        <section class="waiting card" aria-live="polite">
          <p class="show">{t("vendor.show")}</p>
          <p class="total num">{formatMoney(sale.total)}</p>
          <img
            class="qr"
            src={`/api/terminals/${terminal}/qr.svg`}
            alt={t("vendor.qrAlt", { terminal })}
          />
          <p class="hint">{t("vendor.scanHint")}</p>
          <p class="pending">
            <span class="pulse" aria-hidden="true" />
            {t("vendor.waiting")} · PayPal
          </p>
          <p class="timer num">
            <ClockIcon size={20} />
            <span>{mmss}</span>
          </p>
          <button type="button" class="secondary" disabled={busy} onClick={cancel}>
            {t("vendor.cancel")}
          </button>
        </section>
      )}

      {phase === "paid" && sale && (
        <section class="result paid flood" role="alert">
          <PaidCheck />
          <p class="big paid-word">{t("vendor.paid")}</p>
          <p class="total num paid-amount">{formatMoney(sale.total)}</p>
          <p class="paid-via">PayPal ✓</p>
          <button type="button" class="ghost" onClick={reset}>
            {t("vendor.newSale")}
          </button>
        </section>
      )}

      {(phase === "failed" || phase === "expired") && (
        <section class="result bad card" role="alert">
          <span class="bad-icon">
            {phase === "failed" ? <XCircleIcon size={64} /> : <ClockIcon size={64} />}
          </span>
          <p class="big">{phase === "failed" ? t("vendor.declined") : t("vendor.expired")}</p>
          {sale && <p class="total num">{formatMoney(sale.total)}</p>}
          <button type="button" class="primary" onClick={reset}>
            {t("vendor.newSale")}
          </button>
        </section>
      )}

      {phase === "entry" && reviewPrices && (
        <p class="hint review-prices" role="note">
          {t("onb.reviewBanner", { currency })} <a href="/backoffice">{t("onb.reviewLink")}</a>
        </p>
      )}

      {phase === "entry" && payUrl && (
        <button type="button" class="link" onClick={() => setShowSticker((v) => !v)}>
          {showSticker ? t("vendor.hideSticker") : t("vendor.writeSticker")}
        </button>
      )}
      {phase === "entry" && showSticker && <StickerPanel terminal={terminal} url={payUrl} />}
      {phase === "entry" && (
        <a class="link settings-link" href={`/setup?terminal=${encodeURIComponent(terminal)}`}>
          {t("onb.settings")}
        </a>
      )}

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
