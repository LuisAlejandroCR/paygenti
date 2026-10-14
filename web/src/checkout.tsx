// web/src/checkout.tsx: the customer's /pay/:saleId page — stall, lines and total before paying.
// Sandbox: PayPal JS SDK v6 buttons (PayPal, Venmo, Pay Later, card — each only where PayPal offers
// it for the sale's currency and buyer) approve the server-created order; our server captures.
// Mock: "Pagar (simulado)" / "Simular rechazo" drive the mock gateway through the same capture.
// Extra rails (Pix, SPEI, Bre-B, wallets via PayPal) come from RailsPanel when configured; in
// sandbox, eligible Apple Pay / Google Pay buttons mount above PayPal's (wallet-buttons.ts).
// Listens to the terminal's SSE feed so a vendor cancel (or paid/expired) shows up live. A sale that
// can no longer be paid always says what to do next (nothing was charged; ask for a new charge).
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { type FundingSource, fundingCandidates, sandboxBuyerCountry } from "../../shared/funding";
import { formatMoney, money, toPayPalValue } from "../../shared/money";
import type { Sale, TerminalEvent } from "../../shared/types";
import { type WalletId, walletCandidates } from "../../shared/wallets";
import { ApiError, type AppConfig, api } from "./api";
import { type Key, lineName, useT } from "./i18n";
import { XCircleIcon } from "./icons";
import { LangToggle } from "./lang-toggle";
import { mountCheckout, prepareCheckout } from "./paypal-sdk";
import { RailsPanel } from "./rails-panel";
import { mountWallets } from "./wallet-buttons";

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function Checkout({ saleId, embedded = false }: { saleId: string; embedded?: boolean }) {
  const { t, locale } = useT();
  const [sale, setSale] = useState<Sale>();
  const [stall, setStall] = useState("");
  const [config, setConfig] = useState<AppConfig>();
  const [error, setError] = useState<Key | "">("");
  const [busy, setBusy] = useState(false);
  /** Not an error: the buyer closed PayPal's window; any method can be tried again. */
  const [notice, setNotice] = useState<Key | "">("");
  /** Methods the SDK mounted for this buyer (sandbox); undefined until eligibility answers. */
  const [shown, setShown] = useState<FundingSource[]>();
  const buttonsRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const walletsRef = useRef<HTMLDivElement>(null);
  const [walletsShown, setWalletsShown] = useState<WalletId[]>([]);
  const payWithId = useId();

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
    for (const type of [
      "sale.paid",
      "sale.failed",
      "sale.expired",
      "sale.cancelled",
      "sale.pending_bank",
      "sale.vendor_confirmed",
    ])
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

  const currency = sale?.total.currency ?? "";
  const candidates = fundingCandidates(currency);

  useEffect(() => {
    if (!payable || config?.paypal !== "sandbox" || !config.clientId || !buttonsRef.current) return;
    const buttons = buttonsRef.current;
    const message = messageRef.current;
    const amount = toPayPalValue(sale.total);
    const testBuyerCountry = sandboxBuyerCountry(
      currency,
      new URLSearchParams(window.location.search).get("buyerCountry"),
    );
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setShown(undefined);
    prepareCheckout({
      env: "sandbox",
      clientId: config.clientId,
      locale,
      currency,
      amount,
      candidates,
      testBuyerCountry,
    })
      .then(async (ready) => {
        if (cancelled) return;
        const unmount = await mountCheckout(ready, buttons, message, {
          orderId: sale.orderId,
          currency,
          amount,
          testBuyerCountry,
          dark: prefersDark(),
          onApprove: () => {
            setNotice("");
            setError("");
            return capture();
          },
          onCancel: () => setNotice("checkout.paymentClosed"),
          onError: () => setError("checkout.paypalError"),
        });
        if (cancelled) return unmount();
        cleanup = unmount;
        setShown(ready.sources);
      })
      .catch(() => {
        if (!cancelled) setError("checkout.sdkError");
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [payable, config, sale?.orderId, locale]);

  // Apple Pay / Google Pay: only rails configured on the server, only in sandbox, only if eligible.
  useEffect(() => {
    if (!payable || config?.paypal !== "sandbox" || !config.clientId || !walletsRef.current) return;
    const host = walletsRef.current;
    const clientId = config.clientId;
    const amount = toPayPalValue(sale.total);
    const testBuyerCountry = sandboxBuyerCountry(
      currency,
      new URLSearchParams(window.location.search).get("buyerCountry"),
    );
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    api
      .rails(sale.id)
      .then(async (info) => {
        const wallets = walletCandidates(info.rails.map((r) => r.id));
        if (cancelled || wallets.length === 0) return;
        const res = await mountWallets(wallets, host, {
          env: "sandbox",
          clientId,
          locale,
          testBuyerCountry,
          orderId: sale.orderId,
          sale: { currency, amount, countryCode: testBuyerCountry ?? "US", label: stall },
          // Throws unless our server's PayPal capture really marked the sale paid.
          capture: async () => {
            setNotice("");
            setError("");
            const { sale: updated } = await api.capture(saleId);
            setSale(updated);
            if (updated.status !== "paid") throw new Error(updated.status);
          },
          onError: () => setError("checkout.paypalError"),
        });
        if (cancelled) return res.cleanup();
        cleanup = res.cleanup;
        setWalletsShown(res.shown);
      })
      .catch(() => {}); // wallets are optional: PayPal's own buttons still work
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [payable, config, sale?.orderId, locale]);

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

  const sandbox = payable && config?.paypal === "sandbox";
  const Title = embedded ? "h2" : "h1";
  const dead = sale.status === "expired" || sale.status === "cancelled" || sale.status === "failed";

  return (
    <main
      class="checkout"
      data-funding={candidates.join(" ")}
      data-funding-shown={shown?.join(" ")}
    >
      <header class="bar">
        <div class="bar-title">
          <p class="eyebrow">{t("checkout.payTo")}</p>
          <Title class="stall">{stall}</Title>
        </div>
        <LangToggle />
      </header>
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
      {/* Pay Later message from PayPal, mounted only when Pay Later is eligible for this buyer. */}
      {sandbox && <div ref={messageRef} class="pp-message" />}

      {sale.status === "paid" && (
        <p class="result paid" role="alert">
          {t("checkout.paid")}
        </p>
      )}
      {sale.status === "vendor_confirmed" && (
        <p class="result" role="alert">
          {t("checkout.vendorConfirmed")}
        </p>
      )}
      {(sale.status === "open" || sale.status === "pending_bank") && (
        <RailsPanel sale={sale} onSale={setSale} />
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
      {dead && <p class="hint">{t("checkout.nextStep")}</p>}

      {sandbox && (
        <div class="pay-with" role="group" aria-labelledby={payWithId}>
          <h2 id={payWithId} class="pay-with-title">
            {t("checkout.payWith")}
          </h2>
          {!shown && !error && (
            <p class="hint" role="status">
              {t("checkout.loadingMethods")}
            </p>
          )}
          {shown?.length === 0 && <p class="hint">{t("checkout.noMethods")}</p>}
          <div
            ref={walletsRef}
            class="pp-buttons wallet-buttons"
            data-wallets-shown={walletsShown.join(" ")}
          />
          <div ref={buttonsRef} class="pp-buttons" />
          {notice && (
            <p class="hint" role="status">
              {t(notice)}
            </p>
          )}
        </div>
      )}
      {payable && config?.paypal === "mock" && (
        <div class="actions">
          <button type="button" class="primary" disabled={busy} onClick={() => simulate(false)}>
            {busy ? t("checkout.processing") : t("checkout.payMock")}
          </button>
          <button type="button" class="danger block" disabled={busy} onClick={() => simulate(true)}>
            <XCircleIcon size={20} />
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
