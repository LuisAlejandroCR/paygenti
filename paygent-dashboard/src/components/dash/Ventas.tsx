// Ventas.tsx: sales tab — wine KPI band (sales count, ticket, per day, best day, peak hour), daily
// chart with drag-to-zoom, weekday bars and the hour heatmap. Verified and self-declared are always
// separate series; pending_bank never counts as a sale.
import { Fragment, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrefs } from "@/lib/prefs";
import { daily, heatmap, inMonth, isSale, monthKey, monthName, split, toStall } from "@/lib/stats";
import { TODAY } from "@/lib/mock";
import { Icon } from "@/components/icons";
import { useDash } from "./context";
import { ChartCard, Money, SeriesSwatch, Tap } from "./shared";
import { HatchDefs } from "./Resumen";
import { cn } from "@/lib/utils";

const tip = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
};

export function Ventas() {
  const { txs, stall, search, open, nav } = useDash();
  const { t, locale, money } = usePrefs();
  const c = stall.currency;
  const mtx = useMemo(() => inMonth(txs, search.month), [txs, search.month]);
  const upto = search.month === monthKey(TODAY) ? TODAY.getDate() : undefined;
  const days = useMemo(() => daily(txs, search.month, c, upto), [txs, search.month, c, upto]);
  const grid = useMemo(() => heatmap(mtx), [mtx]);
  const max = Math.max(1, ...grid.flat());
  const sp = split(mtx, c);
  const best = days.reduce(
    (b, d) => (d.verified > b.verified ? d : b),
    days[0] ?? { day: 0, verified: 0, declared: 0, count: 0, avg7: 0 },
  );
  const dows = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 9, 5 + i).toLocaleDateString(locale, { weekday: "short" }),
  );
  const peak = useMemo(() => {
    let p = { d: 0, h: 7, v: 0 };
    grid.forEach((row, d) =>
      row.forEach((v, h) => {
        if (v > p.v) p = { d, h: h + 7, v };
      }),
    );
    return p;
  }, [grid]);

  const sales = mtx.filter((x) => x.type === "venta" && isSale(x) && x.status !== "pending_bank");
  const vCount = sales.filter((x) => x.origin === "verificado").length;
  const dCount = sales.length - vCount;
  const nDays = Math.max(1, days.length);

  const weekday = useMemo(() => {
    const rows = dows.map((d) => ({ d, verified: 0, declared: 0 }));
    for (const x of sales) {
      const r = rows[(new Date(x.date).getDay() + 6) % 7]!;
      r[x.origin === "verificado" ? "verified" : "declared"] += toStall(x, c);
    }
    return rows.map((r) => ({
      ...r,
      verified: Math.round(r.verified),
      declared: Math.round(r.declared),
    }));
  }, [sales, c, dows]);

  const [sel, setSel] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = sel ? days.filter((d) => d.day >= sel[0] && d.day <= sel[1]) : days;
  const mName = monthName(search.month, locale);

  const kpis = [
    {
      k: "ticket",
      label: t("avg_ticket"),
      v: sp.verified / Math.max(1, vCount),
      d: sp.declared / Math.max(1, dCount),
      go: () => nav({ tab: "movimientos", filter: "verificado" }),
    },
    {
      k: "day",
      label: t("per_day"),
      v: sp.verified / nDays,
      d: sp.declared / nDays,
      go: () => nav({ tab: "movimientos" }),
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      <section className="lg:col-span-3 overflow-hidden rounded-3xl bg-primary text-primary-foreground shadow-lift">
        <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-[1fr_2fr]">
          <Tap
            onClick={() => nav({ tab: "movimientos" })}
            className="rounded-2xl text-left hover:shadow-none"
          >
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em]">
              {t("sales_of")} {mName}
            </h2>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="num text-5xl font-extrabold tracking-tight">{vCount}</span>
              <span className="text-sm opacity-85">{t("verified").toLowerCase()}</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm opacity-85">
              <span className="hatch-on-wine size-3 rounded-sm" />
              {dCount} {t("declared").toLowerCase()} · {t("not_verified")}
            </p>
          </Tap>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-primary-foreground/15 sm:grid-cols-4">
            {kpis.map((k) => (
              <Tap
                key={k.k}
                onClick={k.go}
                className="rounded-none bg-primary p-3 text-left hover:bg-primary-foreground/10 hover:shadow-none"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide">{k.label}</p>
                <Money value={k.v} currency={c} compact className="mt-1 block text-xl font-bold" />
                <span className="flex items-center gap-1 text-xs">
                  <span className="hatch-on-wine size-2.5 rounded-sm" />
                  <Money value={k.d} currency={c} compact />
                </span>
              </Tap>
            ))}
            <Tap
              onClick={() => setSel([best.day, best.day])}
              className="rounded-none bg-primary p-3 text-left hover:bg-primary-foreground/10 hover:shadow-none"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide">{t("best_day")}</p>
              <p className="num mt-1 text-xl font-bold">{best.day || "—"}</p>
              <Money value={best.verified} currency={c} compact className="text-xs" />
            </Tap>
            <Tap
              onClick={() => open({ kind: "heat", dow: peak.d, hour: peak.h })}
              className="rounded-none bg-primary p-3 text-left hover:bg-primary-foreground/10 hover:shadow-none"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide">{t("peak_hour")}</p>
              <p className="num mt-1 text-xl font-bold">{peak.v ? `${peak.h}:00` : "—"}</p>
              <p className="text-xs capitalize">
                {peak.v ? `${dows[peak.d]} · ${t("count", { n: peak.v })}` : ""}
              </p>
            </Tap>
          </div>
        </div>
      </section>

      <ChartCard
        title={t("daily")}
        className="lg:col-span-3"
        summary={`${t("daily")}: ${days.length} ${t("day").toLowerCase()}, ${t("verified")} ${money(sp.verified, c)}, ${t("declared")} ${money(sp.declared, c)}`}
        rows={days.map((d) => ({
          [t("day")]: d.day,
          [t("verified")]: Math.round(d.verified),
          [t("declared")]: Math.round(d.declared),
          [t("avg7")]: Math.round(d.avg7),
        }))}
        action={
          sel && (
            <button
              onClick={() => setSel(null)}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-primary-text hover:bg-muted cursor-pointer"
            >
              {t("reset_zoom")}
            </button>
          )
        }
      >
        <div className="h-64 select-none" style={{ touchAction: "pan-y" }}>
          <ResponsiveContainer>
            <ComposedChart
              data={shown}
              onMouseDown={(e) => e?.activeLabel != null && setDrag(Number(e.activeLabel))}
              onMouseMove={(e) => e?.activeLabel != null && setHover(Number(e.activeLabel))}
              onMouseUp={() => {
                if (drag != null && hover != null && drag !== hover)
                  setSel([Math.min(drag, hover), Math.max(drag, hover)]);
                setDrag(null);
              }}
            >
              <HatchDefs />
              <defs>
                <linearGradient id="ventasFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--verified)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--verified)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis hide />
              <Tooltip
                formatter={(v: number, n: string) => [
                  money(v, c, { compact: true }),
                  n === "verified" ? t("verified") : n === "declared" ? t("declared") : t("avg7"),
                ]}
                labelFormatter={(l) => `${t("day")} ${l}`}
                contentStyle={tip}
              />
              <Area
                dataKey="declared"
                type="monotone"
                stroke="var(--declared)"
                fill="url(#hatch)"
                fillOpacity={0.5}
              />
              <Area
                dataKey="verified"
                type="monotone"
                stroke="var(--verified)"
                strokeWidth={2.5}
                fill="url(#ventasFill)"
              />
              <Line
                dataKey="avg7"
                type="monotone"
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
              />
              {drag != null && hover != null && (
                <ReferenceArea x1={drag} x2={hover} fill="var(--primary)" fillOpacity={0.1} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <SeriesSwatch kind="verified" />
            {t("verified")}
          </span>
          <span className="flex items-center gap-1.5">
            <SeriesSwatch kind="declared" />
            {t("declared")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-muted-foreground" />
            {t("avg7")} ({t("verified").toLowerCase()})
          </span>
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <Icon.sparkle size={14} />
            {t("drag_zoom")}
          </span>
        </div>
      </ChartCard>

      <ChartCard
        title={t("by_weekday")}
        summary={t("by_weekday")}
        rows={weekday.map((w) => ({
          [t("day")]: w.d,
          [t("verified")]: w.verified,
          [t("declared")]: w.declared,
        }))}
      >
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={weekday} barGap={2}>
              <HatchDefs />
              <XAxis dataKey="d" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis hide />
              <Tooltip
                formatter={(v: number, n: string) => [
                  money(v, c, { compact: true }),
                  n === "verified" ? t("verified") : t("declared"),
                ]}
                contentStyle={tip}
                cursor={{ fill: "var(--muted)" }}
              />
              <Bar dataKey="verified" fill="var(--verified)" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="declared"
                fill="url(#hatch)"
                stroke="var(--declared)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title={t("heatmap")}
        className="lg:col-span-2"
        summary={t("heatmap")}
        rows={grid.map((r, i) => ({
          [t("day")]: dows[i] ?? "",
          ...Object.fromEntries(r.map((v, h) => [`${h + 7}h`, v])),
        }))}
      >
        <div className="overflow-x-auto pb-1">
          <div
            className="inline-grid min-w-full gap-1"
            style={{ gridTemplateColumns: `2.5rem repeat(16, minmax(1.5rem, 1fr))` }}
          >
            <span />
            {Array.from({ length: 16 }, (_, h) => (
              <span key={h} className="text-center text-[10px] text-muted-foreground num">
                {h + 7}
              </span>
            ))}
            {grid.map((row, d) => (
              <Fragment key={d}>
                <span className="flex items-center text-xs font-medium capitalize text-muted-foreground">
                  {dows[d]}
                </span>
                {row.map((v, h) => (
                  <button
                    key={`${d}-${h}`}
                    onClick={() => open({ kind: "heat", dow: d, hour: h + 7 })}
                    aria-label={`${dows[d]} ${h + 7}:00 — ${v}`}
                    className={cn(
                      "pressable aspect-square min-h-6 rounded-md text-[10px] num",
                      v / max > 0.6 && "text-primary-foreground",
                      d === peak.d && h + 7 === peak.h && peak.v > 0 && "ring-2 ring-foreground",
                    )}
                    style={{
                      background: v
                        ? `color-mix(in oklab, var(--primary) ${Math.round((v / max) * 100)}%, var(--card))`
                        : "var(--muted)",
                    }}
                  >
                    {v || ""}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
