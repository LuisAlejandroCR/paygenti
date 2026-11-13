// web/src/judge.tsx: judge mode at /judge — vendor and customer side by side on one screen
// (stacked on mobile) with a short guided script that follows the PayPal mode from /api/config
// (simulated pay button on the mock gateway, test card in sandbox).
// The customer panel follows the vendor panel only: the vendor adopts any open sale on load, so
// both panels always show the same sale. The header is the same title bar as every other screen.
import { useEffect, useState } from "preact/hooks";
import { SANDBOX_TEST_VISA } from "../../shared/funding";
import { api } from "./api";
import { Checkout } from "./checkout";
import { useT } from "./i18n";
import { judgeIntroKey, judgeStepKeys, type PayPalMode } from "./judge-steps";
import { LangToggle } from "./lang-toggle";
import { VendorApp } from "./vendor";

export function JudgeApp({ terminal }: { terminal: string }) {
  const { t } = useT();
  const [saleId, setSaleId] = useState<string>();
  const [mode, setMode] = useState<PayPalMode>();

  useEffect(() => {
    api
      .config()
      .then((c) => setMode(c.paypal))
      .catch(() => {});
  }, []);

  return (
    <div class="judge">
      <header class="judge-head">
        <div class="bar">
          <h1 class="stall">Paygenti · {t("judge.title")}</h1>
          <LangToggle />
        </div>
        <p>
          {t(judgeIntroKey(mode))}{" "}
          <a
            class="bar-btn judge-soundbox"
            href={`/soundbox?terminal=${terminal}`}
            target="_blank"
            rel="noopener"
          >
            {t("judge.openSoundbox")}
          </a>
        </p>
        <ol>
          {judgeStepKeys(mode).map((k) => (
            <li key={k}>{t(k, { card: SANDBOX_TEST_VISA })}</li>
          ))}
        </ol>
      </header>
      <div class="judge-panels">
        <section class="judge-panel" aria-label={t("judge.vendor")}>
          <h2>{t("judge.vendor")}</h2>
          <VendorApp terminal={terminal} embedded onSale={(s) => s && setSaleId(s.id)} />
        </section>
        <section class="judge-panel" aria-label={t("judge.customer")}>
          <h2>{t("judge.customer")}</h2>
          {saleId ? (
            <Checkout key={saleId} saleId={saleId} embedded />
          ) : (
            <p class="hint">{t("judge.noSale")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
