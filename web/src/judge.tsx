// web/src/judge.tsx: judge mode at /judge — vendor and customer side by side on one screen
// (stacked on mobile) with a short guided script. Works with zero env vars on the mock gateway.
import { useEffect, useState } from "preact/hooks";
import type { Sale } from "../../shared/types";
import { Checkout } from "./checkout";
import { type Key, useT } from "./i18n";
import { LangToggle } from "./lang-toggle";
import { VendorApp } from "./vendor";

const STEPS: Key[] = ["judge.step1", "judge.step2", "judge.step3", "judge.step4", "judge.step5"];

export function JudgeApp({ terminal }: { terminal: string }) {
  const { t } = useT();
  const [saleId, setSaleId] = useState<string>();

  useEffect(() => {
    fetch(`/api/terminals/${terminal}`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d?: { openSale: Sale | null }) => {
        if (d?.openSale) setSaleId((cur) => cur ?? d.openSale?.id);
      })
      .catch(() => {});
  }, [terminal]);

  return (
    <div class="judge">
      <header class="judge-head">
        <h1>
          paygent · {t("judge.title")} <LangToggle />
        </h1>
        <p>
          {t("judge.intro")}{" "}
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
          {STEPS.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
      </header>
      <div class="judge-panels">
        <section class="judge-panel" aria-label={t("judge.vendor")}>
          <h2>{t("judge.vendor")}</h2>
          <VendorApp terminal={terminal} onSale={(s) => s && setSaleId(s.id)} />
        </section>
        <section class="judge-panel" aria-label={t("judge.customer")}>
          <h2>{t("judge.customer")}</h2>
          {saleId ? (
            <Checkout key={saleId} saleId={saleId} />
          ) : (
            <p class="hint">{t("judge.noSale")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
