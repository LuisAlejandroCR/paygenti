// web/src/verify.tsx: public /verify page (no login) — reads a sales passport from the URL fragment
// (never sent to the server) or a pasted link, checks its Ed25519 signature in the browser with
// WebCrypto against /api/passport/public-key (server fallback) and shows VALID/INVALID with figures.
// Same title bar as the other screens (title left, language right).
import { useEffect, useState } from "preact/hooks";
import { isPayPalCurrency } from "../../shared/currency";
import { type Currency, formatMoney, money } from "../../shared/money";
import {
  decodePayload,
  fromBase64Url,
  type SignedPassport,
  verifyPassport,
} from "../../shared/passport";
import { FootprintFigures } from "./footprint";
import { useT } from "./i18n";
import { LangToggle } from "./lang-toggle";

type State =
  | { kind: "empty" }
  | { kind: "checking" }
  | { kind: "malformed" }
  | { kind: "done"; valid: boolean; passport: SignedPassport };

interface PublicKey {
  keyId: string;
  publicKey: string;
}

async function check(p: SignedPassport): Promise<boolean> {
  const key = (await fetch("/api/passport/public-key").then((r) => r.json())) as PublicKey;
  if (key.keyId !== p.keyId) return false;
  try {
    return await verifyPassport(p, fromBase64Url(key.publicKey));
  } catch {
    // No Ed25519 in this browser's WebCrypto: ask the server (stateless check).
    const r = await fetch("/api/passport/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    return ((await r.json()) as { valid?: boolean }).valid === true;
  }
}

function payloadFrom(text: string): string {
  const i = text.indexOf("#");
  return i >= 0 ? text.slice(i + 1) : text;
}

export function VerifyApp() {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "empty" });
  const [pasted, setPasted] = useState("");

  async function run(raw: string) {
    const payload = payloadFrom(raw).trim();
    if (!payload) return setState({ kind: "empty" });
    const p = decodePayload(payload);
    if (!p) return setState({ kind: "malformed" });
    setState({ kind: "checking" });
    const valid = await check(p).catch(() => false);
    setState({ kind: "done", valid, passport: p });
  }

  useEffect(() => {
    const onHash = () => void run(location.hash.slice(1));
    onHash();
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  return (
    <main class="backoffice verify">
      <header class="bar">
        <h1 class="stall">{t("verify.title")}</h1>
        <LangToggle />
      </header>
      <p class="hint">{t("verify.intro")}</p>
      <form
        class="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void run(pasted);
        }}
      >
        <label>
          {t("verify.paste")}
          <textarea rows={3} value={pasted} onInput={(e) => setPasted(e.currentTarget.value)} />
        </label>
        <button type="submit" class="primary" disabled={!pasted.trim()}>
          {t("verify.check")}
        </button>
      </form>
      {state.kind === "checking" && <p class="hint">{t("verify.checking")}</p>}
      {state.kind === "malformed" && (
        <p class="verdict invalid" role="alert">
          {t("verify.malformed")}
        </p>
      )}
      {state.kind === "done" && <Result valid={state.valid} passport={state.passport} />}
    </main>
  );
}

function Result({ valid, passport }: { valid: boolean; passport: SignedPassport }) {
  const { t } = useT();
  const r = passport.report;
  const cur: Currency = isPayPalCurrency(r.currency) ? r.currency : "USD";
  const m = (minor: number) => formatMoney(money(Number(minor) || 0, cur));
  return (
    <section class="panel passport">
      <p class={`verdict ${valid ? "valid" : "invalid"}`} role="status" data-valid={valid}>
        {valid ? t("verify.valid") : t("verify.invalid")}
      </p>
      <p class="hint">{valid ? t("verify.validHint") : t("verify.invalidHint")}</p>
      {r.demoKey && <p class="hint">{t("passport.demoKey")}</p>}
      <PassportFigures passport={passport} money={m} />
    </section>
  );
}

export function PassportFigures({
  passport,
  money: m,
}: {
  passport: SignedPassport;
  money: (minor: number) => string;
}) {
  const { t } = useT();
  const r = passport.report;
  const v = r.verified;
  return (
    <>
      <h2>{r.vendor?.name}</h2>
      <p>{t("passport.period", { from: r.period?.from, to: r.period?.to })}</p>
      <h3>{t("passport.verified")}</h3>
      <table class="lines">
        <tbody>
          <tr>
            <td>{t("passport.count")}</td>
            <td class="num">{v.count}</td>
          </tr>
          <tr>
            <td>{t("passport.gross")}</td>
            <td class="num">{m(v.gross)}</td>
          </tr>
          <tr>
            <td>{t("passport.refunds")}</td>
            <td class="num">−{m(v.refunds)}</td>
          </tr>
          <tr>
            <td>
              <strong>{t("passport.net")}</strong>
            </td>
            <td class="num">
              <strong data-field="net">{m(v.net)}</strong>
            </td>
          </tr>
          <tr>
            <td>{t("passport.daysActive")}</td>
            <td class="num">{v.daysActive}</td>
          </tr>
          <tr>
            <td>{t("passport.avgTicket")}</td>
            <td class="num">{m(v.averageTicket)}</td>
          </tr>
        </tbody>
      </table>
      {v.daily?.length > 0 && (
        <table class="lines daily">
          <thead>
            <tr>
              <th>{t("passport.day")}</th>
              <th class="num">{t("passport.count")}</th>
              <th class="num">{t("passport.net")}</th>
            </tr>
          </thead>
          <tbody>
            {v.daily.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td class="num">{d.count}</td>
                <td class="num">{m(d.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{t("passport.selfReported")}</h3>
      <p class="hint">{t("passport.selfReportedHint")}</p>
      <table class="lines">
        <tbody>
          <tr>
            <td>{t("passport.cash")}</td>
            <td class="num">{m(r.selfReported?.cash)}</td>
          </tr>
        </tbody>
      </table>
      {r.footprint && <FootprintFigures footprint={r.footprint} />}
      <p class="hint">{t("passport.issued", { at: r.issuedAt, key: passport.keyId })}</p>
    </>
  );
}
