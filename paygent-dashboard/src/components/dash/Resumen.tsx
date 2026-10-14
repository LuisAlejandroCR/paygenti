// Resumen.tsx: overview tab — wine sales card (verified total, 3 KPIs, day strip), shortcut pills,
// month-to-date pace vs last month, rails strip and top products. Totals are verified-only; the
// self-declared amount is always shown beside it, never added in.
import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Icon, RAIL_COLOR, RAIL_NAME, RailIcon, itemIcon } from "@/components/icons";
import { usePrefs } from "@/lib/prefs";
import {
  daily,
  daysIn,
  inMonth,
  monthKey,
  monthName,
  shiftMonth,
  split,
  byRail,
  topItems,
} from "@/lib/stats";
import { TODAY } from "@/lib/mock";
import { useDash, type FlowName } from "./context";
import { ChartCard, Delta, Money, Tap } from "./shared";

export function HatchDefs() {
  return (
    <defs>
      <pattern
        id="hatch"
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" fill="var(--card)" />
        <rect width="3" height="6" fill="var(--declared)" />
      </pattern>
    </defs>
  );
}

// Pace ring: outer arc = verified vs last month, inner hatched arc = self-declared, tick = days elapsed.
function PaceRing({
  verified,
  declared,
  elapsed,
}: {
  verified: number;
  declared: number;
  elapsed: number;
}) {
  const arc = (r: number, p: number) => {
    const c = 2 * Math.PI * r;
    return { strokeDasharray: `${(Math.min(100, p) / 100) * c} ${c}` };
  };
  const a = (elapsed / 100) * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0" aria-hidden>
      <HatchDefs />
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--muted)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r="27"
        fill="none"
        stroke="var(--verified)"
        strokeWidth="6"
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
        style={arc(27, verified)}
      />
      <circle cx="32" cy="32" r="18" fill="none" stroke="var(--muted)" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        r="18"
        fill="none"
        stroke="url(#hatch)"
        strokeWidth="5"
        transform="rotate(-90 32 32)"
        style={arc(18, declared)}
      />
      <line
        x1={32 + 22 * Math.cos(a)}
        y1={32 + 22 * Math.sin(a)}
        x2={32 + 31 * Math.cos(a)}
        y2={32 + 31 * Math.sin(a)}
        stroke="var(--foreground)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function useMonthStats() {
  const { txs, search, stall } = useDash();
  return useMemo(() => {
    const m = search.month;
    const prev = shiftMonth(m, -1);
    const isCurrent = m === monthKey(TODAY);
    const day = isCurrent ? TODAY.getDate() : daysIn(m);
    const cur = split(inMonth(txs, m), stall.currency);
    const prevAll = split(inMonth(txs, prev), stall.currency);
    const prevSame = split(
      inMonth(txs, prev).filter((t) => new Date(t.date).getDate() <= day),
      stall.currency,
    );
    return { m, prev, day, cur, prevAll, prevSame, total: daysIn(m) };
  }, [txs, search.month, stall.currency]);
}

export function Resumen() {
  const { stall, txs, search, nav, open } = useDash();
  const { t, locale, money } = usePrefs();
  const c = stall.currency;
  const s = useMonthStats();
  const monthTxs = useMemo(() => inMonth(txs, s.m), [txs, s.m]);
  const rails = useMemo(() => byRail(monthTxs, c), [monthTxs, c]);
  const items = useMemo(() => topItems(monthTxs, c), [monthTxs, c]);
  const pendingIds = monthTxs.filter((x) => x.status === "pending_bank").map((x) => x.id);
  const allPending = txs.filter((x) => x.status === "pending_bank");
  const [dismissed, setDismissed] = useState(false);

  const mName = monthName(s.m, locale);
  const pName = monthName(s.prev, locale);
  const delta = s.prevSame.verified
    ? ((s.cur.verified - s.prevSame.verified) / s.prevSame.verified) * 100
    : 0;
  const pctV = s.prevAll.verified ? Math.round((s.cur.verified / s.prevAll.verified) * 100) : 0;
  const pctD = s.prevAll.declared ? Math.round((s.cur.declared / s.prevAll.declared) * 100) : 0;

  const six = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const m = shiftMonth(monthKey(TODAY), i - 5);
        const sp = split(inMonth(txs, m), c);
        return {
          m,
          label: monthName(m, locale, "short"),
          verified: Math.round(sp.verified),
          declared: Math.round(sp.declared),
        };
      }),
    [txs, c, locale],
  );

  const dayByDay = useMemo(() => {
    const a = daily(txs, s.m, c, s.day),
      b = daily(txs, s.prev, c);
    return a.map((r, i) => ({ day: r.day, now: r.verified, before: b[i]?.verified ?? 0 }));
  }, [txs, s, c]);

  // long-press / right-click compare
  const hovered = useRef<string | null>(null);
  const timer = useRef<number>(0);
  const compare = () =>
    hovered.current &&
    hovered.current !== s.m &&
    open({ kind: "compare", a: s.m, b: hovered.current });

  const dismiss = () => {
    setDismissed(true);
    toast(t("dismissed"), { action: { label: t("undo"), onClick: () => setDismissed(false) } });
  };

  const actions: { flow: FlowName; label: string; icon: keyof typeof Icon }[] = [
    { flow: "cobrar", label: t("a_charge"), icon: "charge" },
    { flow: "confirmar", label: t("a_confirm"), icon: "transfer" },
    { flow: "reembolso", label: t("a_refund"), icon: "refund" },
    { flow: "payout", label: t("a_payout"), icon: "supplier" },
    { flow: "importar", label: t("a_import"), icon: "upload" },
    { flow: "exportar", label: t("a_export"), icon: "download" },
  ];

  const tip = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    color: "var(--popover-foreground)",
  };
  const cal = useMemo(
    () => daily(txs, s.m, c).map((r) => ({ day: r.day, total: r.verified, future: r.day > s.day })),
    [txs, s.m, s.day, c],
  );
  const calMax = Math.max(1, ...cal.map((d) => d.total));
  const cum = useMemo(() => {
    const a = daily(txs, s.m, c),
      b = daily(txs, s.prev, c);
    let x = 0,
      y = 0;
    return a.map((r, i) => {
      x += r.verified;
      y += b[i]?.verified ?? 0;
      return { day: r.day, now: r.day <= s.day ? x : null, before: y };
    });
  }, [txs, s, c]);
  const sixMax = Math.max(1, ...six.map((x) => x.verified));
  const railTot = rails.reduce((a, x) => a + x.verified, 0) || 1;
  const itemMax = Math.max(1, ...items.map((i) => Math.max(i.verified, i.declared)));

  const emptyMonth = !monthTxs.length;
  const emptyNote = (
    <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
      <p className="font-semibold">{t("empty_month")}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{t("empty_month_hint")}</p>
    </div>
  );

  const summary = `${t("sales_of")} ${mName}: ${t("verified")} ${money(s.cur.verified, c)}, ${t("declared")} ${money(s.cur.declared, c)}, ${Math.round(delta)}% ${t("vs")} ${pName}`;

  return (
    <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      {/* Alert */}
      {allPending.length > 0 && !dismissed && (
        <div
          className="lg:col-span-3 flex items-center gap-3 rounded-2xl border border-warning/50 bg-warning-soft p-2 pl-4 text-warning-foreground"
          role="alert"
        >
          <Icon.alert className="shrink-0" />
          <Tap
            className="flex flex-1 flex-wrap items-center gap-x-2 rounded-xl py-2 hover:shadow-none"
            onClick={() =>
              open({ kind: "flow", flow: "confirmar", ids: allPending.map((x) => x.id) })
            }
          >
            <span className="font-semibold">{t("alert_spei", { n: allPending.length })}</span>
            <span className="font-bold underline underline-offset-2">→ {t("confirm_pin")}</span>
          </Tap>
          <button
            onClick={dismiss}
            className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-warning/20 cursor-pointer"
            aria-label={t("close")}
          >
            <Icon.x />
          </button>
        </div>
      )}

      {/* Ticket hero: wine band with the month total, 3 KPIs and a day-by-day calendar strip */}
      <section className="lg:col-span-3 overflow-hidden rounded-3xl bg-primary text-primary-foreground shadow-lift">
        <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em]">
                {t("sales_of")} {mName}
              </h2>
              {s.prevSame.verified > 0 ? (
                <Popover>
                  <PopoverTrigger
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-full"
                    aria-label={t("daybyday")}
                  >
                    <Delta pct={delta} label={`${t("vs")} ${pName}`} />
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <p className="mb-2 text-sm font-bold">{t("daybyday")}</p>
                    <div className="h-40">
                      <ResponsiveContainer>
                        <BarChart data={dayByDay}>
                          <XAxis dataKey="day" fontSize={10} tickLine={false} axisLine={false} />
                          <Tooltip formatter={(v: number) => money(v, c)} contentStyle={tip} />
                          <Bar
                            dataKey="before"
                            name={pName}
                            fill="var(--muted-foreground)"
                            opacity={0.35}
                            radius={[3, 3, 0, 0]}
                          />
                          <Bar
                            dataKey="now"
                            name={mName}
                            fill="var(--verified)"
                            radius={[3, 3, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="rounded-full bg-primary-foreground/15 px-2.5 py-1 text-xs font-semibold">
                  {t("no_prev")}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={summary}
              onClick={() => nav({ tab: "ventas" })}
              className="mt-2 block w-full rounded-2xl text-left cursor-pointer"
            >
              <Money
                value={s.cur.verified}
                currency={c}
                className="block text-[clamp(2rem,10vw,3.75rem)] font-extrabold leading-tight tracking-tight"
              />
              <span className="mt-1 block text-sm opacity-90">
                {t("day_of", { d: s.day, t: s.total })}
                {s.prevAll.verified > 0 && ` · ${t("pct_of_last", { p: pctV, m: pName })}`}
              </span>
            </button>
          </div>
          <div className="grid grid-cols-3 divide-x divide-primary-foreground/20 overflow-hidden rounded-2xl bg-primary-foreground/10 md:grid-cols-1 md:divide-x-0 md:divide-y">
            {[
              {
                k: "verified",
                label: t("verified"),
                v: s.cur.verified,
                f: "verificado",
                icon: <Icon.check size={14} />,
              },
              {
                k: "declared",
                label: t("declared"),
                v: s.cur.declared,
                f: "autodeclarado",
                icon: <span className="hatch-on-wine size-3 rounded-sm" />,
              },
              {
                k: "pending",
                label: t("pending"),
                v: s.cur.pending,
                f: "pending_bank",
                icon: <Icon.clock size={14} />,
                n: s.cur.pendingCount,
              },
            ].map((x) => (
              <Tap
                key={x.k}
                onClick={() => nav({ tab: "movimientos", filter: x.f as never })}
                className="min-w-0 rounded-none px-2 py-3 text-left sm:p-3 hover:bg-primary-foreground/10 hover:shadow-none md:flex md:items-center md:justify-between"
              >
                <span className="flex flex-col items-start gap-1 text-[11px] font-semibold leading-tight [hyphens:auto] [overflow-wrap:anywhere] sm:flex-row sm:items-center sm:gap-1.5 sm:uppercase sm:tracking-wide">
                  <span className="shrink-0">{x.icon}</span>
                  {x.label}
                </span>
                <span className="mt-1 block md:mt-0">
                  {x.n !== undefined && <span className="num mr-1.5 text-lg font-bold">{x.n}</span>}
                  <Money
                    value={x.v}
                    currency={c}
                    compact
                    className={x.n !== undefined ? "text-xs" : "text-lg font-bold"}
                  />
                </span>
              </Tap>
            ))}
          </div>
        </div>
        {/* Calendar strip: one cell per day, height = that day's sales, future days dotted */}
        <button
          type="button"
          onClick={() => nav({ tab: "ventas" })}
          aria-label={t("see_sales")}
          className="group flex h-16 w-full items-end gap-[3px] bg-primary-foreground/5 px-5 pb-3 pt-2 cursor-pointer hover:bg-primary-foreground/10 sm:px-6"
        >
          {cal.map((d) => (
            <span
              key={d.day}
              aria-hidden
              title={`${d.day}: ${money(d.total, c)}`}
              className="flex h-full flex-1 flex-col justify-end"
            >
              <span
                className={
                  d.future
                    ? "mx-auto size-1 rounded-full bg-primary-foreground/30"
                    : "w-full rounded-t-sm bg-primary-foreground/80 transition-all"
                }
                style={
                  d.future ? undefined : { height: `${Math.max(6, (d.total / calMax) * 100)}%` }
                }
              />
            </span>
          ))}
        </button>
      </section>
      {/* Shortcuts as pills, right below the wine sales card */}
      <div className="lg:col-span-3 -mt-1 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {actions.map((a, i) => {
          const I = Icon[a.icon];
          return (
            <Tap
              key={a.flow}
              onClick={() =>
                open({
                  kind: "flow",
                  flow: a.flow,
                  ids: a.flow === "confirmar" ? allPending.map((x) => x.id) : undefined,
                })
              }
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold hover:shadow-none ${i === 0 ? "bg-primary text-primary-foreground shadow-soft" : "border border-border bg-card text-foreground hover:border-primary hover:text-primary-text"}`}
            >
              <I size={16} />
              {a.label}
            </Tap>
          );
        })}
      </div>

      {/* Running total vs last month (cumulative), with 6-month chips to jump */}
      <ChartCard
        title={t("pace")}
        className="lg:col-span-2"
        summary={`${t("pace")} (${t("verified")}): ${money(s.cur.verified, c)} ${t("vs")} ${money(s.prevAll.verified, c)} ${pName}`}
        rows={cum.map((r) => ({
          dia: r.day,
          [mName]: Math.round(r.now ?? 0),
          [pName]: Math.round(r.before),
        }))}
      >
        <div
          className="mb-3 flex gap-1.5 overflow-x-auto"
          onContextMenu={(e) => {
            e.preventDefault();
            compare();
          }}
        >
          {six.map((x) => {
            const h = Math.max(4, (x.verified / sixMax) * 22);
            return (
              <button
                key={x.m}
                onClick={() => nav({ month: x.m })}
                onMouseEnter={() => {
                  hovered.current = x.m;
                }}
                onTouchStart={() => {
                  hovered.current = x.m;
                  timer.current = window.setTimeout(compare, 550);
                }}
                onTouchEnd={() => clearTimeout(timer.current)}
                aria-pressed={x.m === s.m}
                className={`flex min-h-11 min-w-14 flex-col items-center justify-end gap-1 rounded-xl border px-2 py-1.5 text-[11px] font-semibold capitalize cursor-pointer ${x.m === s.m ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted"}`}
              >
                <span className="w-3 rounded-sm bg-current opacity-70" style={{ height: h }} />
                {x.label}
              </button>
            );
          })}
        </div>
        <div className="relative h-52">
          {!s.cur.verified && !s.prevAll.verified && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              {emptyNote}
            </div>
          )}
          <ResponsiveContainer>
            <AreaChart data={cum} margin={{ left: 0, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="wineFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} interval={4} />
              <YAxis hide />
              <Tooltip
                formatter={(v: number, n) => [
                  money(v, c, { compact: true }),
                  n === "now" ? mName : pName,
                ]}
                labelFormatter={(d) => `${t("day")} ${d}`}
                contentStyle={tip}
              />
              <Area
                type="monotone"
                dataKey="before"
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                fill="none"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="now"
                stroke="var(--primary)"
                fill="url(#wineFill)"
                strokeWidth={2.5}
              />
              <ReferenceLine x={s.day} stroke="var(--border)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-primary" />
            {mName}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-muted-foreground" />
            {pName}
          </span>
        </div>
      </ChartCard>

      {/* Rails as a 100% stacked strip + ranked rows (no donut) */}
      <ChartCard
        title={t("how_paid")}
        summary={`${t("how_paid")}: ${rails.map((r) => `${RAIL_NAME[r.rail]} ${money(r.verified, c)} · ${t("declared")} ${money(r.declared, c)}`).join(", ")}`}
        rows={rails.map((r) => ({
          rail: RAIL_NAME[r.rail],
          verificado: Math.round(r.verified),
          autodeclarado: Math.round(r.declared),
        }))}
        action={
          <button
            onClick={() => nav({ tab: "perfil", section: "rieles" })}
            className="min-h-11 px-2 text-sm font-semibold text-primary-text cursor-pointer"
          >
            {t("see_all")}
          </button>
        }
      >
        <div className="flex h-4 overflow-hidden rounded-full" aria-hidden>
          {rails.map((r) =>
            r.verified ? (
              <span
                key={r.rail}
                style={{
                  width: `${(r.verified / railTot) * 100}%`,
                  background: RAIL_COLOR[r.rail],
                  opacity: search.rail && search.rail !== r.rail ? 0.3 : 1,
                }}
              />
            ) : null,
          )}
        </div>
        {emptyMonth && emptyNote}
        <ul className="mt-3 space-y-1">
          {rails.map((r) => (
            <li key={r.rail}>
              <button
                onClick={() => nav({ rail: search.rail === r.rail ? undefined : r.rail })}
                aria-pressed={search.rail === r.rail}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-sm cursor-pointer ${search.rail === r.rail ? "bg-accent" : "hover:bg-muted"}`}
              >
                <RailIcon rail={r.rail} size={18} />
                <span className="truncate font-medium">{RAIL_NAME[r.rail]}</span>
                {r.declared > r.verified && (
                  <span className="hatch size-2.5 rounded-sm" aria-label={t("declared")} />
                )}
                <span className="ml-auto flex flex-col items-end leading-tight">
                  <Money
                    value={r.verified}
                    currency={c}
                    compact
                    className="text-sm font-semibold"
                  />
                  {r.declared > 0 && (
                    <Money
                      value={r.declared}
                      currency={c}
                      compact
                      className="text-[11px] text-declared"
                    />
                  )}
                </span>
                <span className="num w-9 text-right text-xs text-muted-foreground">
                  {Math.round((r.verified / railTot) * 100)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ChartCard>

      {/* Top products as proportional bars */}
      <section className="tile p-4 sm:p-5 lg:col-span-3">
        <h2 className="mb-3 text-base font-bold">{t("top_items")}</h2>
        {!items.length && emptyNote}
        <ul className="space-y-2">
          {items.map((it) => {
            const I = itemIcon(it.item);

            return (
              <li key={it.item}>
                <Tap
                  onClick={() => open({ kind: "item", item: it.item })}
                  className="block rounded-xl p-2 hover:bg-muted hover:shadow-none"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-primary-text">
                      <I />
                    </span>
                    <span className="truncate font-semibold">{it.item}</span>
                    <span className="num text-xs text-muted-foreground">×{it.count}</span>
                    <Money value={it.verified} currency={c} compact className="ml-auto font-bold" />
                    {it.declared > 0 && (
                      <Money
                        value={it.declared}
                        currency={c}
                        compact
                        className="text-xs text-declared"
                      />
                    )}
                  </div>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted">
                    <span
                      className="bg-verified"
                      style={{ width: `${(it.verified / itemMax) * 100}%` }}
                    />
                  </div>
                  {it.declared > 0 && (
                    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="hatch"
                        style={{ width: `${(it.declared / itemMax) * 100}%` }}
                      />
                    </div>
                  )}
                </Tap>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export { RailIcon };
