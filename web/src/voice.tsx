// web/src/voice.tsx: push-to-talk ordering — Web Speech API (es-MX) transcribes, the server parses
// into catalog lines, and the vendor edits the cart (qty +/-, remove) before charging. A text box
// ("Type the order") goes through the same parser for browsers without speech, and for judges.
import { useRef, useState } from "preact/hooks";
import { type Currency, formatMoney, type Money, money } from "../../shared/money";
import type { CartLine, CatalogItem } from "../../shared/types";
import { api } from "./api";
import { lineName, speechLang, useT } from "./i18n";
import { CloseIcon, KeyboardIcon, KeypadIcon, MicIcon, MinusIcon, PlusIcon } from "./icons";

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = globalThis as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function mergeLines(cart: CartLine[], add: CartLine[]): CartLine[] {
  const out = cart.map((l) => ({ ...l }));
  for (const l of add) {
    const hit = out.find((o) => o.sku === l.sku);
    if (hit) hit.qty = Math.min(99, hit.qty + l.qty);
    else out.push({ ...l });
  }
  return out;
}

export function cartTotal(cart: CartLine[], fallback: Currency = "MXN"): Money {
  const currency = cart[0]?.unitPrice.currency ?? fallback;
  return money(
    cart.reduce((s, l) => s + l.unitPrice.minor * l.qty, 0),
    currency,
  );
}

interface Props {
  vendorId: string;
  cart: CartLine[];
  onCart: (cart: CartLine[]) => void;
  onCharge: () => void;
  busy: boolean;
  /** Real catalog for the quick-add chips (from GET /api/terminals/:id). */
  catalog?: CatalogItem[];
  /** Keypad toggle shown next to the typed order while the cart is empty. */
  keypad?: { open: boolean; toggle: () => void };
}

export function catalogLine(item: CatalogItem): CartLine {
  return { sku: item.sku, name: item.name, names: item.names, qty: 1, unitPrice: item.price };
}

export function VoiceCart({ vendorId, cart, onCart, onCharge, busy, catalog = [], keypad }: Props) {
  const { t, locale } = useT();
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const rec = useRef<Recognition | undefined>(undefined);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  async function parse(text: string) {
    setHeard(text);
    setNote("");
    try {
      const r = await api.parseVoice(text, vendorId);
      if (r.lines.length === 0) {
        setNote(t("voice.noProducts"));
        return;
      }
      onCart(mergeLines(cartRef.current, r.lines));
      if (r.unmatched.length > 0) setNote(t("voice.unmatched", { items: r.unmatched.join(", ") }));
    } catch {
      setNote(t("voice.parseFailed"));
    }
  }

  function start() {
    if (!Ctor || listening) return;
    const r = new Ctor();
    r.lang = speechLang(locale);
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text.trim()) void parse(text);
    };
    r.onerror = () => setNote(t("voice.notHeard"));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

  function stop() {
    rec.current?.stop();
  }

  function submitTyped(e: Event) {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    void parse(text);
  }

  function setQty(sku: string, qty: number) {
    onCart(
      cart
        .map((l) => (l.sku === sku ? { ...l, qty: Math.min(99, qty) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  return (
    <section class="voice" aria-label={t("voice.label")}>
      {Ctor ? (
        <button
          type="button"
          class={listening ? "ptt listening" : "ptt"}
          aria-pressed={listening}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
        >
          <span class="ptt-mic">
            <MicIcon size={30} />
          </span>
          <span class="ptt-text">
            <span class="ptt-title">{listening ? t("voice.listening") : t("voice.hold")}</span>
            <span class="ptt-hint" aria-hidden="true">
              {t("voice.example")}
            </span>
          </span>
        </button>
      ) : (
        <p class="hint">{t("voice.unsupported")}</p>
      )}
      <div class="type-row">
        <form class="type-order" onSubmit={submitTyped}>
          <label class="type-field">
            <KeyboardIcon size={18} />
            <input
              type="text"
              aria-label={t("voice.typeLabel")}
              placeholder={t("voice.typePlaceholder")}
              maxLength={500}
              value={typed}
              onInput={(e) => setTyped(e.currentTarget.value)}
            />
          </label>
          <button type="submit" class="secondary" disabled={!typed.trim()}>
            {t("voice.typeSubmit")}
          </button>
        </form>
        {keypad && cart.length === 0 && (
          <button
            type="button"
            class={keypad.open ? "keypad-toggle on" : "keypad-toggle"}
            aria-pressed={keypad.open}
            aria-label={t("vendor.keypad")}
            title={t("vendor.keypad")}
            onClick={keypad.toggle}
          >
            <KeypadIcon />
          </button>
        )}
      </div>
      {heard && <p class="heard">«{heard}»</p>}
      {note && (
        <p class="hint" role="status">
          {note}
        </p>
      )}
      {(cart.length > 0 || catalog.length > 0) && (
        <div class="cart-card">
          {cart.length === 0 && <p class="cart-empty">{t("voice.empty")}</p>}
          {cart.length > 0 && (
            <ul class="cart">
              {cart.map((l) => (
                <li key={l.sku}>
                  <span class="cart-name">
                    {lineName(l, locale)}
                    <span class="cart-unit">{formatMoney(l.unitPrice)}</span>
                  </span>
                  <span class="num cart-sum">
                    {formatMoney(money(l.unitPrice.minor * l.qty, l.unitPrice.currency))}
                  </span>
                  <span class="qty">
                    <button
                      type="button"
                      class="step"
                      aria-label={t("voice.removeOne", { name: lineName(l, locale) })}
                      onClick={() => setQty(l.sku, l.qty - 1)}
                    >
                      <MinusIcon />
                    </button>
                    <span class="qty-n" aria-live="polite">
                      {l.qty}
                    </span>
                    <button
                      type="button"
                      class="step"
                      aria-label={t("voice.addOne", { name: lineName(l, locale) })}
                      onClick={() => setQty(l.sku, l.qty + 1)}
                    >
                      <PlusIcon />
                    </button>
                  </span>
                  <button
                    type="button"
                    class="step remove"
                    aria-label={t("voice.removeAll", { name: lineName(l, locale) })}
                    onClick={() => setQty(l.sku, 0)}
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {catalog.length > 0 && (
            <div class="chips" role="group" aria-label={t("voice.menu")}>
              {catalog.map((item) => (
                <button
                  key={item.sku}
                  type="button"
                  class="chip"
                  onClick={() => onCart(mergeLines(cartRef.current, [catalogLine(item)]))}
                >
                  + {lineName(item, locale)}
                </button>
              ))}
            </div>
          )}
          {cart.length > 0 && (
            <button type="button" class="link clear-cart" onClick={() => onCart([])}>
              {t("voice.clear")}
            </button>
          )}
        </div>
      )}
      {cart.length > 0 && (
        <div class="charge-bar">
          <div class="charge-total">
            <span class="charge-label">{t("vendor.total")}</span>
            <span class="num charge-amount">{formatMoney(cartTotal(cart))}</span>
          </div>
          <button type="button" class="primary charge" disabled={busy} onClick={onCharge}>
            {busy
              ? t("vendor.creating")
              : t("vendor.chargeAmount", { amount: formatMoney(cartTotal(cart)) })}
          </button>
        </div>
      )}
    </section>
  );
}
