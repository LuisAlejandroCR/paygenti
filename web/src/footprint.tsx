// web/src/footprint.tsx: the financial footprint in the browser — FootprintFigures renders the signed
// indicators (verified and self-reported blocks kept apart, with the "not a credit score" disclaimer);
// FootprintPanel lets the vendor import a bank statement with her PIN, delete it, and set a savings goal.
import { useEffect, useState } from "preact/hooks";
import { isPayPalCurrency } from "../../shared/currency";
import { type Currency, formatMoney, money, parseAmount } from "../../shared/money";
import type { Footprint, SavingsGoal, StatementMonth } from "../../shared/passport";
import { DICTIONARIES, type Key, useT } from "./i18n";

/** Formats minor units in a row's own currency; never converts between currencies. */
function fmt(minor: number, currency: string): string {
  return isPayPalCurrency(currency) ? formatMoney(money(minor, currency)) : `${minor} ${currency}`;
}

export function FootprintFigures({ footprint: f }: { footprint: Footprint }) {
  const { t } = useT();
  const v = f.verified;
  return (
    <section class="footprint" data-provenance-split="true">
      <h3>{t("footprint.title")}</h3>
      <p>{t("footprint.pitch")}</p>
      <p class="hint" data-field="disclaimer">
        {t("footprint.disclaimer")}
      </p>
      <h4 data-provenance={v.label}>{t("footprint.verified")}</h4>
      <table class="lines">
        <tbody>
          <tr>
            <td>{t("footprint.daysActive")}</td>
            <td class="num">{v.daysActive}</td>
          </tr>
          <tr>
            <td>{t("footprint.monthsSelling")}</td>
            <td class="num">{v.monthsSelling}</td>
          </tr>
          <tr>
            <td>{t("footprint.consistency")}</td>
            <td class="num">
              {t("footprint.weeksOf", { active: v.activeWeeks, total: v.totalWeeks })}
            </td>
          </tr>
          {v.firstSaleDay && (
            <tr>
              <td>{t("footprint.firstSale")}</td>
              <td class="num">{v.firstSaleDay}</td>
            </tr>
          )}
        </tbody>
      </table>
      {v.monthly.length > 0 && (
        <>
          <p>{t("footprint.monthly")}</p>
          <table class="lines">
            <thead>
              <tr>
                <th>{t("footprint.month")}</th>
                <th class="num">{t("passport.count")}</th>
                <th class="num">{t("passport.net")}</th>
              </tr>
            </thead>
            <tbody>
              {v.monthly.map((m) => (
                <tr key={`${m.month}-${m.currency}`}>
                  <td>{m.month}</td>
                  <td class="num">{m.count}</td>
                  <td class="num">{fmt(m.net, m.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.trend.map((tr) => (
            <p class="hint" key={tr.currency}>
              {t("footprint.trend", {
                currency: tr.currency,
                direction: t(`footprint.trend.${tr.direction}` as Key),
              })}
            </p>
          ))}
        </>
      )}
      <h4 data-provenance={f.selfReported.label}>{t("footprint.selfReported")}</h4>
      <p class="hint">{t("footprint.selfReportedHint")}</p>
      <StatementTable months={f.selfReported.monthly} />
      <h4>{t("footprint.goal")}</h4>
      {f.savingsGoal ? (
        <GoalBar goal={f.savingsGoal} />
      ) : (
        <p class="hint">{t("footprint.noGoal")}</p>
      )}
    </section>
  );
}

function StatementTable({ months }: { months: StatementMonth[] }) {
  const { t } = useT();
  if (months.length === 0) return <p class="hint">{t("footprint.noStatement")}</p>;
  return (
    <table class="lines statement-months">
      <thead>
        <tr>
          <th>{t("footprint.month")}</th>
          <th class="num">{t("footprint.inflowCount")}</th>
          <th class="num">{t("footprint.inflow")}</th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={`${m.month}-${m.currency}`}>
            <td>{m.month}</td>
            <td class="num">{m.count}</td>
            <td class="num">{fmt(m.inflow, m.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GoalBar({ goal }: { goal: SavingsGoal }) {
  const { t } = useT();
  const pct = goal.target > 0 ? Math.min(100, Math.floor((goal.saved / goal.target) * 100)) : 0;
  return (
    <>
      <progress max={100} value={pct} />
      <p>
        {t("footprint.goalProgress", {
          saved: fmt(goal.saved, goal.currency),
          target: fmt(goal.target, goal.currency),
          pct,
        })}
      </p>
    </>
  );
}

export function FootprintPanel({
  token,
  onAuthLost,
  currency,
}: {
  token: string;
  onAuthLost: () => void;
  currency: Currency;
}) {
  const { t } = useT();
  const [statement, setStatement] = useState<StatementMonth[]>([]);
  const [goal, setGoal] = useState<SavingsGoal | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pin, setPin] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const auth = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    void fetch("/api/backoffice/footprint", { headers: auth })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d?: { statement: StatementMonth[]; goal: SavingsGoal | null }) => {
        if (!d) return;
        setStatement(d.statement);
        setGoal(d.goal);
      })
      .catch(() => undefined);
    // biome-ignore lint/correctness/useExhaustiveDependencies: load once per session token
  }, [token]);

  const errorText = (code: string | number) => {
    for (const key of [`footprint.err.${code}`, `reason.${code}`])
      if (key in DICTIONARIES.en) return t(key as Key);
    return t("bo.error", { code });
  };

  async function send(path: string, init: RequestInit) {
    setMsg("");
    setError("");
    setBusy(true);
    const res = await fetch(path, { ...init, headers: { ...auth, ...init.headers } }).catch(
      () => undefined,
    );
    setBusy(false);
    if (!res) {
      setError(t("bo.offline"));
      return undefined;
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401) onAuthLost();
      setError(errorText((data.error as string) ?? res.status));
      return undefined;
    }
    return data;
  }

  async function importStatement(e: Event) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("pin", pin);
    const d = await send("/api/backoffice/statement", { method: "POST", body: form });
    setPin("");
    if (!d) return;
    setStatement(d.statement as StatementMonth[]);
    setMsg(
      t("footprint.imported", { count: d.transactions as number, skipped: d.skipped as number }),
    );
  }

  async function remove() {
    const d = await send("/api/backoffice/statement/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setPin("");
    if (!d) return;
    setStatement([]);
    setMsg(t("footprint.deleted"));
  }

  async function saveGoal(e: Event) {
    e.preventDefault();
    const targetMinor = parseAmount(target, currency);
    const savedMinor = saved.trim() ? parseAmount(saved, currency) : 0;
    if (!targetMinor || savedMinor === undefined) return setError(t("footprint.goalInvalid"));
    const d = await send("/api/backoffice/savings-goal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetMinor, savedMinor }),
    });
    if (d) setGoal(d.goal as SavingsGoal);
  }

  async function clearGoal() {
    const d = await send("/api/backoffice/savings-goal", { method: "DELETE" });
    if (d) setGoal(null);
  }

  return (
    <section class="panel footprint-panel" aria-label={t("footprint.manage")}>
      <h2>{t("footprint.manage")}</h2>
      <p>{t("footprint.pitch")}</p>
      <p class="hint">{t("footprint.disclaimer")}</p>

      <form class="subform" onSubmit={importStatement} aria-label={t("footprint.import")}>
        <label>
          {t("footprint.import")}
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <p class="hint">{t("footprint.importHint")}</p>
        <label>
          {t("pay.pin")}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onInput={(e) => setPin(e.currentTarget.value)}
          />
        </label>
        <p class="actions">
          <button type="submit" class="primary" disabled={busy || !file || pin.length < 4}>
            {t("footprint.importButton")}
          </button>
          {statement.length > 0 && (
            <button
              type="button"
              class="secondary"
              disabled={busy || pin.length < 4}
              onClick={() => void remove()}
            >
              {t("footprint.delete")}
            </button>
          )}
        </p>
      </form>
      <h3>{t("footprint.selfReported")}</h3>
      <StatementTable months={statement} />

      <form class="subform" onSubmit={saveGoal} aria-label={t("footprint.goal")}>
        <h3>{t("footprint.goal")}</h3>
        {goal && <GoalBar goal={goal} />}
        <label>
          {t("footprint.goalTarget")}
          <input
            inputMode="decimal"
            value={target}
            onInput={(e) => setTarget(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("footprint.goalSaved")}
          <input
            inputMode="decimal"
            value={saved}
            onInput={(e) => setSaved(e.currentTarget.value)}
          />
        </label>
        <p class="actions">
          <button type="submit" class="secondary" disabled={busy || !target.trim()}>
            {t("footprint.goalSave")}
          </button>
          {goal && (
            <button
              type="button"
              class="secondary"
              disabled={busy}
              onClick={() => void clearGoal()}
            >
              {t("footprint.goalClear")}
            </button>
          )}
        </p>
      </form>
      {msg && (
        <p class="hint" role="status">
          {msg}
        </p>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
