import { Fragment, useMemo, useState } from "react";
import { Area, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePrefs } from "@/lib/prefs";
import { daily, heatmap, inMonth, monthKey, split } from "@/lib/stats";
import { TODAY } from "@/lib/mock";
import { useDash } from "./context";
import { ChartCard, Money, SeriesSwatch } from "./shared";
import { HatchDefs, useMonthStats } from "./Resumen";
import { cn } from "@/lib/utils";

export function Ventas() {
  const { txs, stall, search, open } = useDash();
  const { t, locale, money } = usePrefs();
  const c = stall.currency;
  const s = useMonthStats();
  const mtx = useMemo(() => inMonth(txs, search.month), [txs, search.month]);
  const upto = search.month === monthKey(TODAY) ? TODAY.getDate() : undefined;
  const days = useMemo(() => daily(txs, search.month, c, upto), [txs, search.month, c, upto]);
  const grid = useMemo(() => heatmap(mtx), [mtx]);
  const max = Math.max(1, ...grid.flat());
  const count = days.reduce((a, d) => a + d.count, 0);
  const sp = split(mtx, c);
  const best = days.reduce((b, d) => (d.verified + d.declared > b.verified + b.declared ? d : b), days[0]);
  const dows = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 5 + i).toLocaleDateString(locale, { weekday: "short" }));

  const [sel, setSel] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = sel ? days.filter((d) => d.day >= sel[0] && d.day <= sel[1]) : days;

  const vCount = mtx.filter((x) => x.type === "venta" && x.status === "COMPLETED" && x.origin === "verificado").length;
  const dCount = mtx.filter((x) => x.type === "venta" && x.status === "COMPLETED" && x.origin === "autodeclarado").length;
  const kpis = [
    { label: t("avg_ticket"), v: sp.verified / Math.max(1, vCount), d: sp.declared / Math.max(1, dCount) },
    { label: t("per_day"), v: sp.verified / days.length, d: sp.declared / days.length },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid grid-cols-3 gap-3 lg:col-span-3">
        {kpis.map((k) => (
          <div key={k.label} className="tile p-4">
            <p className="text-xs font-semibold text-muted-foreground">{k.label}</p>
            <Money value={k.v} currency={c} compact className="mt-1 block text-lg font-bold sm:text-2xl" />
            <Money value={k.d} currency={c} compact className="text-xs text-declared" />
          </div>
        ))}
        <div className="tile p-4">
          <p className="text-xs font-semibold text-muted-foreground">{t("best_day")}</p>
          <p className="mt-1 text-lg font-bold sm:text-2xl num">{best?.day ?? "—"}</p>
          {best && <Money value={best.verified} currency={c} compact className="text-xs text-muted-foreground" />}
        </div>
      </div>

      <ChartCard title={t("daily")} className="lg:col-span-3"
        summary={`${t("daily")}: ${days.length} días, ${t("verified")} ${money(sp.verified, c)}, ${t("declared")} ${money(sp.declared, c)}`}
        rows={days.map((d) => ({ dia: d.day, verificado: Math.round(d.verified), autodeclarado: Math.round(d.declared), promedio7: Math.round(d.avg7) }))}
        action={sel && <button onClick={() => setSel(null)} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-muted cursor-pointer">{t("reset_zoom")}</button>}>
        <div className="h-64 select-none" style={{ touchAction: "pan-y" }}>
          <ResponsiveContainer>
            <ComposedChart data={shown}
              onMouseDown={(e) => e?.activeLabel != null && setDrag(Number(e.activeLabel))}
              onMouseMove={(e) => e?.activeLabel != null && setHover(Number(e.activeLabel))}
              onMouseUp={() => { if (drag != null && hover != null && drag !== hover) setSel([Math.min(drag, hover), Math.max(drag, hover)]); setDrag(null); }}>
              <HatchDefs />
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis hide />
              <Tooltip formatter={(v: number, n: string) => [money(v, c, { compact: true }), n === "verified" ? t("verified") : n === "declared" ? t("declared") : t("avg7")]}
                labelFormatter={(l) => `Día ${l}`} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12 }} />
              <Area dataKey="declared" type="monotone" stroke="var(--declared)" fill="url(#hatch)" fillOpacity={0.5} />
              <Line dataKey="verified" type="monotone" stroke="var(--verified)" strokeWidth={2.5} dot={false} />
              <Line dataKey="avg7" type="monotone" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
              {drag != null && hover != null && <ReferenceArea x1={drag} x2={hover} fill="var(--primary)" fillOpacity={0.1} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><SeriesSwatch kind="verified" />{t("verified")}</span>
          <span className="flex items-center gap-1.5"><SeriesSwatch kind="declared" />{t("declared")}</span>
          <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-muted-foreground" />{t("avg7")}</span>
        </div>
      </ChartCard>

      <ChartCard title={t("heatmap")} className="lg:col-span-3" summary={`${t("heatmap")}`}
        rows={grid.map((r, i) => ({ dia: dows[i], ...Object.fromEntries(r.map((v, h) => [`${h + 7}h`, v])) }))}>
        <div className="overflow-x-auto">
          <div className="inline-grid min-w-full gap-1" style={{ gridTemplateColumns: `3rem repeat(16, minmax(1.75rem, 1fr))` }}>
            <span />
            {Array.from({ length: 16 }, (_, h) => <span key={h} className="text-center text-[10px] text-muted-foreground num">{h + 7}</span>)}
            {grid.map((row, d) => (
              <Fragment key={d}>
                <span className="flex items-center text-xs font-medium capitalize text-muted-foreground">{dows[d]}</span>
                {row.map((v, h) => (
                  <button key={`${d}-${h}`} onClick={() => open({ kind: "heat", dow: d, hour: h + 7 })}
                    aria-label={`${dows[d]} ${h + 7}:00 — ${v}`}
                    className={cn("pressable aspect-square min-h-7 rounded-md border border-border/50 text-[10px] num", v / max > 0.6 && "text-primary-foreground")}
                    style={{ background: v ? `color-mix(in oklab, var(--primary) ${Math.round((v / max) * 100)}%, var(--card))` : "var(--muted)" }}>
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
