// web/src/rails-panel.tsx: extra payment rails on the customer checkout — wallets PayPal confirms
// (Apple Pay, Google Pay, OXXO) listed as going through PayPal, and push rails (Pix, SPEI, Bre-B)
// that show a QR + bank data, stay "pending — check your bank app" and take the vendor's PIN.
import { useEffect, useState } from "preact/hooks";
import type { Sale } from "../../shared/types";
import { ApiError, api, type RailsInfo } from "./api";
import { useT } from "./i18n";

export function RailsPanel({ sale, onSale }: { sale: Sale; onSale: (s: Sale) => void }) {
  const { t } = useT();
  const [info, setInfo] = useState<RailsInfo>();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.rails(sale.id).then(setInfo, () => setInfo(undefined));
  }, [sale.id, sale.status, sale.method]);

  if (!info || info.rails.length === 0) return null;

  async function choose(rail: string) {
    setBusy(true);
    setError("");
    try {
      const res = await api.selectRail(sale.id, rail);
      setInfo(res);
      onSale(res.sale);
    } catch {
      setError(t("checkout.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.vendorConfirm(sale.id, pin);
      setPin("");
      onSale(res.sale);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? t("checkout.pinWrong")
          : t("checkout.failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sale.status === "pending_bank" && info.payment) {
    return (
      <section class="rails pending-bank" data-rail={info.payment.rail}>
        <p class="result" role="status">
          {t("checkout.pendingBank")}
        </p>
        <img
          class="rail-qr"
          src={`/api/sales/${sale.id}/rail-qr.svg?m=${sale.method}`}
          alt={info.payment.rail}
          width={220}
          height={220}
        />
        <pre class="rail-data">{info.payment.text}</pre>
        <p class="hint">{t("checkout.pendingBankHint")}</p>
        <form class="vendor-confirm" onSubmit={confirm}>
          <label>
            {t("checkout.vendorPin")}{" "}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onInput={(e) => setPin((e.target as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" class="secondary" disabled={busy || pin.length < 4}>
            {t("checkout.vendorConfirm")}
          </button>
        </form>
        <button type="button" class="link" disabled={busy} onClick={() => choose("paypal")}>
          {t("checkout.backToPayPal")}
        </button>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const viaPayPal = info.rails.filter((r) => r.confirmation === "paypal");
  const push = info.rails.filter((r) => r.confirmation === "push");
  return (
    <section class="rails">
      {viaPayPal.length > 0 && (
        <p class="hint">
          {viaPayPal.map((r) => t("checkout.railVia", { rail: r.label })).join(" · ")}
        </p>
      )}
      {push.length > 0 && (
        <div class="actions">
          <p class="hint">{t("checkout.otherRails")}</p>
          {push.map((r) => (
            <button
              key={r.id}
              type="button"
              class="secondary"
              disabled={busy}
              onClick={() => choose(r.id)}
            >
              {t("checkout.payWithRail", { rail: r.label })}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
