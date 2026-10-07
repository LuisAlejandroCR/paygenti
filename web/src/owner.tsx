// web/src/owner.tsx: the owner's multi-paygent UI — the stall switcher (only with 2+ stalls), the
// "All my paygents" page at /backoffice/all (totals per currency, never mixed), the approvals inbox
// for Claude's proposals (approved with this stall's PIN) and the Claude (MCP) token panel.
import { useEffect, useState } from "preact/hooks";
import { formatMoney, type Money } from "../../shared/money";
import type { Approval, McpToken, StallSummary } from "../../shared/types";
import { reasonText, useT } from "./i18n";
import { LangToggle } from "./lang-toggle";
import { boUrl, currentStall, fetchStalls, sessionsHeader } from "./stall";

const ALL = "__all";

/** A select of the owner's stalls plus "All my paygents"; renders nothing with a single stall. */
export function StallSwitcher({ all = false }: { all?: boolean }) {
  const { t } = useT();
  const [stalls, setStalls] = useState<StallSummary[]>([]);
  useEffect(() => {
    void fetchStalls().then(setStalls);
  }, []);
  if (stalls.length < 2) return null;
  const go = (id: string) =>
    location.assign(id === ALL ? "/backoffice/all" : `/backoffice?stall=${encodeURIComponent(id)}`);
  return (
    <label class="stall-switcher">
      <span class="sr-only">{t("owner.switch")}</span>
      <select
        data-testid="stall-switcher"
        value={all ? ALL : currentStall()}
        onChange={(e) => go(e.currentTarget.value)}
      >
        {stalls.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
        <option value={ALL}>{t("owner.all")}</option>
      </select>
    </label>
  );
}

interface StallOverview {
  id: string;
  displayName: string;
  paid: Money;
  cash: Money;
  refunded: Money;
  net: Money;
  count: number;
  pendingApprovals: number;
}
interface CurrencyTotal {
  currency: string;
  paid: Money;
  cash: Money;
  refunded: Money;
  net: Money;
  count: number;
  stalls: number;
}

/** /backoffice/all: today's totals of every stall this browser is signed in to. */
export function OwnerOverviewApp() {
  const { t } = useT();
  const [stalls, setStalls] = useState<StallSummary[]>([]);
  const [data, setData] = useState<{ stalls: StallOverview[]; totals: CurrencyTotal[] } | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const list = await fetchStalls();
      setStalls(list);
      const header = sessionsHeader(list.map((s) => s.id));
      if (!header) return;
      const r = await fetch("/api/owner/overview", {
        headers: { "X-Paygent-Sessions": header },
      }).catch(() => undefined);
      if (r?.ok) setData(await r.json());
      else setError(t("bo.offline"));
    })();
  }, []);

  const signedIn = new Set(data?.stalls.map((s) => s.id));
  return (
    <main class="backoffice owner">
      <header class="bar">
        <h1 class="stall">{t("owner.all")}</h1>
        <nav class="bar-actions">
          <StallSwitcher all />
          <LangToggle />
        </nav>
      </header>
      {error && <p class="error">{error}</p>}
      <section class="panel" data-testid="owner-totals">
        <h2>{t("owner.totals")}</h2>
        {data && data.totals.length > 0 ? (
          <table class="lines">
            <tbody>
              {data.totals.map((c) => (
                <tr key={c.currency} data-currency={c.currency}>
                  <td>
                    <strong>{c.currency}</strong> · {t("owner.stallsCount", { count: c.stalls })}
                  </td>
                  <td>{t("bo.salesCount", { count: c.count })}</td>
                  <td class="num">
                    <strong>{formatMoney(c.net)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="hint">{t("owner.signInHint")}</p>
        )}
        <p class="hint">{t("owner.noFx")}</p>
      </section>
      {stalls.map((s) => {
        const o = data?.stalls.find((x) => x.id === s.id);
        return (
          <section class="panel" key={s.id} data-testid={`owner-stall-${s.id}`}>
            <h2>{s.displayName}</h2>
            {o ? (
              <>
                <p class="total">
                  {formatMoney(o.net)} · {t("bo.salesCount", { count: o.count })}
                </p>
                {o.pendingApprovals > 0 && (
                  <p class="hint">{t("owner.pending", { count: o.pendingApprovals })}</p>
                )}
              </>
            ) : null}
            <a class="bar-btn" href={`/backoffice?stall=${encodeURIComponent(s.id)}`}>
              {signedIn.has(s.id) ? t("owner.open") : t("owner.signIn")}
            </a>
          </section>
        );
      })}
    </main>
  );
}

/** Claude's proposals for this stall; approving asks for this stall's PIN right here. */
export function ApprovalsPanel({ token, onDone }: { token: string; onDone?: () => void }) {
  const { t, locale } = useT();
  const [items, setItems] = useState<Approval[]>([]);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch(boUrl("/approvals"), {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    if (r?.ok) setItems(((await r.json()) as { approvals: Approval[] }).approvals);
  }
  useEffect(() => {
    void load();
  }, [token]);

  async function decide(id: string, action: "approve" | "reject") {
    const r = await fetch(boUrl(`/approvals/${id}/${action}`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(action === "approve" ? { pin: pins[id] ?? "" } : {}),
    }).catch(() => undefined);
    const data = (await r?.json().catch(() => ({}))) as { error?: string; reason?: string };
    setMsg(
      r?.ok
        ? t(action === "approve" ? "owner.approved" : "owner.rejected")
        : (reasonText(data.error, undefined, data.reason, locale) ??
            t("bo.error", { code: data.error ?? "?" })),
    );
    setPins({ ...pins, [id]: "" });
    await load();
    onDone?.();
  }

  const pending = items.filter((a) => a.status === "pending");
  if (pending.length === 0 && !msg) return null;
  return (
    <section class="panel" data-testid="approvals">
      <h2>{t("owner.approvals")}</h2>
      <p class="hint">{t("owner.approvalsHint")}</p>
      {msg && <p role="status">{msg}</p>}
      <ul class="approvals">
        {pending.map((a) => (
          <li key={a.id}>
            <p>
              <strong>{t(a.kind === "refund" ? "owner.kindRefund" : "owner.kindPayout")}</strong>{" "}
              {formatMoney(a.amount)}
              {!a.preview.allow && <span class="badge">{a.preview.code}</span>}
            </p>
            {a.note && <p class="hint note">“{a.note}”</p>}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder={t("bo.confirmPin")}
              value={pins[a.id] ?? ""}
              onInput={(e) => setPins({ ...pins, [a.id]: e.currentTarget.value })}
            />
            <button
              type="button"
              class="primary"
              disabled={(pins[a.id] ?? "").length < 4}
              onClick={() => void decide(a.id, "approve")}
            >
              {t("owner.approve")}
            </button>
            <button type="button" class="secondary" onClick={() => void decide(a.id, "reject")}>
              {t("owner.reject")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Create/revoke the MCP token Claude uses; the secret is shown once, only its hash is stored. */
export function ClaudeAccessPanel() {
  const { t } = useT();
  const [tokens, setTokens] = useState<Omit<McpToken, "tokenHash">[]>([]);
  const [secret, setSecret] = useState("");
  const [ids, setIds] = useState<string[]>([currentStall()]);

  const headers = () => ({
    "X-Paygent-Sessions": sessionsHeader(ids),
    "Content-Type": "application/json",
  });
  async function load(list = ids) {
    const r = await fetch("/api/owner/mcp-tokens", {
      headers: { "X-Paygent-Sessions": sessionsHeader(list) },
    }).catch(() => undefined);
    if (r?.ok) setTokens(((await r.json()) as { tokens: typeof tokens }).tokens);
  }
  useEffect(() => {
    void fetchStalls().then((s) => {
      const all = s.length ? s.map((x) => x.id) : ids;
      setIds(all);
      void load(all);
    });
  }, []);

  async function create() {
    const r = await fetch("/api/owner/mcp-tokens", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ label: "Claude" }),
    }).catch(() => undefined);
    if (r?.ok) setSecret(((await r.json()) as { secret: string }).secret);
    await load();
  }
  async function revoke(id: string) {
    await fetch(`/api/owner/mcp-tokens/${id}/revoke`, {
      method: "POST",
      headers: headers(),
      body: "{}",
    }).catch(() => undefined);
    await load();
  }

  const live = tokens.filter((x) => !x.revokedAt);
  return (
    <section class="panel" data-testid="claude-access">
      <h2>{t("owner.claudeTitle")}</h2>
      <p class="hint">{t("owner.claudeHint", { url: `${location.origin}/mcp` })}</p>
      {secret && (
        <p>
          {t("owner.secretOnce")} <code data-testid="mcp-secret">{secret}</code>
        </p>
      )}
      <ul>
        {live.map((x) => (
          <li key={x.id}>
            {x.label} · {x.stalls.join(", ")}{" "}
            <button type="button" class="secondary" onClick={() => void revoke(x.id)}>
              {t("owner.revoke")}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" class="secondary" onClick={() => void create()}>
        {t("owner.newToken")}
      </button>
    </section>
  );
}
