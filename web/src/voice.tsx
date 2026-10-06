// web/src/voice.tsx: push-to-talk ordering — Web Speech API (es-MX) transcribes, the server parses
// into catalog lines, and the vendor edits the cart (qty +/-, remove) before charging.
import { useRef, useState } from "preact/hooks";
import { formatMoney, type Money, money } from "../../shared/money";
import type { CartLine } from "../../shared/types";
import { api } from "./api";
import { lineName, speechLang, useT } from "./i18n";

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

export function cartTotal(cart: CartLine[]): Money {
  const currency = cart[0]?.unitPrice.currency ?? "MXN";
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
}

export function VoiceCart({ vendorId, cart, onCart, onCharge, busy }: Props) {
  const { t, locale } = useT();
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState("");
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
          {listening ? t("voice.listening") : t("voice.hold")}
        </button>
      ) : (
        <p class="hint">{t("voice.unsupported")}</p>
      )}
      {heard && <p class="heard">«{heard}»</p>}
      {note && <p class="hint">{note}</p>}
      {cart.length > 0 && (
        <>
          <ul class="cart">
            {cart.map((l) => (
              <li key={l.sku}>
                <span class="cart-name">{lineName(l, locale)}</span>
                <span class="qty">
                  <button
                    type="button"
                    class="step"
                    aria-label={t("voice.removeOne", { name: lineName(l, locale) })}
                    onClick={() => setQty(l.sku, l.qty - 1)}
                  >
                    −
                  </button>
                  <span aria-live="polite">{l.qty}</span>
                  <button
                    type="button"
                    class="step"
                    aria-label={t("voice.addOne", { name: lineName(l, locale) })}
                    onClick={() => setQty(l.sku, l.qty + 1)}
                  >
                    +
                  </button>
                </span>
                <span class="num">
                  {formatMoney(money(l.unitPrice.minor * l.qty, l.unitPrice.currency))}
                </span>
                <button
                  type="button"
                  class="step remove"
                  aria-label={t("voice.removeAll", { name: lineName(l, locale) })}
                  onClick={() => setQty(l.sku, 0)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" class="primary" disabled={busy} onClick={onCharge}>
            {busy
              ? t("vendor.creating")
              : t("vendor.chargeAmount", { amount: formatMoney(cartTotal(cart)) })}
          </button>
          <button type="button" class="secondary" onClick={() => onCart([])}>
            {t("voice.clear")}
          </button>
        </>
      )}
    </section>
  );
}
