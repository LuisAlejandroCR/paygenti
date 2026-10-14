// Rieles.tsx: profile > payment methods — month share strip per rail (verified vs self-declared),
// one tile per rail with amounts, sales count, a 14-day sparkline and the PIN-gated on/off switch.
// Conversion and confirm time are mock metrics; live mode hides them (no server endpoint).
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon, RAIL_COLOR, railChip, RAIL_NAME, RailIcon } from "@/components/icons";
import { getRails, LIVE, setRailEnabled } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { inMonth, isSale, toStall } from "@/lib/stats";
import { TODAY } from "@/lib/mock";
import type { Rail, RailInfo } from "@/lib/types";
import type { TKey } from "@/lib/i18n";
import { useDash } from "./context";
import { usePin } from "./pin";
import { Money, Sparkline, Tap } from "./shared";
import { cn } from "@/lib/utils";

function useRailStats() {
  const { allTxs, stall, search } = useDash();
  return useMemo(() => {
    const m = inMonth(allTxs, search.month);
    const by = new Map<
      Rail,
      { verified: number; declared: number; count: number; days: number[] }
    >();
    const day0 = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - 13).getTime();
    for (const x of allTxs) {
      if (x.type !== "venta" || !isSale(x) || x.status === "pending_bank") continue;
      const e = by.get(x.rail) ?? {
        verified: 0,
        declared: 0,
        count: 0,
        days: Array<number>(14).fill(0),
      };
      const i = Math.floor((new Date(x.date).getTime() - day0) / 86400000);
      if (i >= 0 && i < 14) e.days[i] = (e.days[i] ?? 0) + 1;
      if (m.includes(x)) {
        e[x.origin === "verificado" ? "verified" : "declared"] += toStall(x, stall.currency);
        e.count++;
      }
      by.set(x.rail, e);
    }
    const totV = [...by.values()].reduce((a, e) => a + e.verified, 0) || 1;
    const totD = [...by.values()].reduce((a, e) => a + e.declared, 0) || 1;
    return { by, totV, totD };
  }, [allTxs, stall.currency, search.month]);
}

export function Rieles() {
  const { stall, open, search, nav } = useDash();
  const { t } = usePrefs();
  const pin = usePin();
  const qc = useQueryClient();
  const key = ["rails", stall.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getRails(stall.id, stall.currency),
  });
  const st = useRailStats();

  const mut = useMutation({
    mutationFn: ({ rail, enabled }: { rail: string; enabled: boolean }) =>
      setRailEnabled(stall.id, rail, enabled),
    onMutate: async ({ rail, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RailInfo[]>(key);
      qc.setQueryData<RailInfo[]>(key, (old) =>
        old?.map((r) => (r.rail === rail ? { ...r, enabled } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      toast.error(t("failed"));
    },
    onSuccess: () => toast.success(t("done")),
  });

  if (isLoading || !data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    );
  const active = data.filter((r) => !r.reason);
  const strip = (k: "verified" | "declared", tot: number) => (
    <div className="flex h-3 overflow-hidden rounded-full bg-primary-foreground/15">
      {active.map((r) => {
        const v = st.by.get(r.rail)?.[k] ?? 0;
        return v ? (
          <span
            key={r.rail}
            className={k === "declared" ? "hatch-on-wine" : ""}
            style={{
              width: `${(v / tot) * 100}%`,
              background: k === "verified" ? RAIL_COLOR[r.rail] : undefined,
            }}
          />
        ) : null;
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl bg-primary p-5 text-primary-foreground shadow-lift">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p className="num text-4xl font-extrabold">{active.filter((r) => r.enabled).length}</p>
          <p className="text-sm opacity-85">
            {t("rails_count", { n: active.filter((r) => r.enabled).length })} · {t("share")}
          </p>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
            <Icon.check size={14} />
            {t("verified")}
          </div>
          {strip("verified", st.totV)}
          <div className="flex items-center gap-2 pt-1 text-[11px] font-semibold uppercase tracking-wide">
            <span className="hatch-on-wine size-3 rounded-sm" />
            {t("declared")}
          </div>
          {strip("declared", st.totD)}
        </div>
        {LIVE && <p className="mt-3 text-xs opacity-90">{t("live_rails")}</p>}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((r) => {
          const disabled = !!r.reason;
          const s = st.by.get(r.rail);
          const on = search.rail === r.rail;
          return (
            <div
              key={r.rail}
              className={cn(
                "tile pressable relative flex flex-col p-4",
                (disabled || !r.enabled) && "border-dashed bg-muted/40 [&_[data-chip]]:grayscale",
                on && "ring-2 ring-primary",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  data-chip
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                  style={railChip(r.rail)}
                >
                  <RailIcon rail={r.rail} size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Stretched button: the whole tile opens the detail without nesting controls */}
                  <button
                    type="button"
                    data-detail
                    onClick={() => open({ kind: "rail", rail: r.rail })}
                    className="block max-w-full truncate text-left font-bold cursor-pointer after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
                  >
                    {RAIL_NAME[r.rail]}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {disabled ? t(r.reason as TKey) : r.enabled ? t("on") : t("off")}
                  </p>
                </div>
                <div className="relative z-10 flex min-h-11 items-center">
                  <Switch
                    checked={r.enabled && !disabled}
                    disabled={disabled || LIVE}
                    aria-label={`${RAIL_NAME[r.rail]} ${r.enabled ? t("on") : t("off")}`}
                    onCheckedChange={async (v) => {
                      if (await pin(`${RAIL_NAME[r.rail]}: ${v ? t("on") : t("off")}`))
                        mut.mutate({ rail: r.rail, enabled: v });
                    }}
                  />
                </div>
              </div>
              {!disabled && (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-muted/60 p-2">
                      <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                        <Icon.check size={12} />
                        {t("verified")}
                      </p>
                      <Money
                        value={s?.verified ?? 0}
                        currency={stall.currency}
                        compact
                        className="text-lg font-bold"
                      />
                    </div>
                    <div className="hatch-soft rounded-xl p-2">
                      <p className="text-[11px] font-semibold text-declared">{t("declared")}</p>
                      <Money
                        value={s?.declared ?? 0}
                        currency={stall.currency}
                        compact
                        className="text-lg font-bold text-declared"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <Sparkline data={s?.days ?? []} className="text-primary-text" />
                    </div>
                    <p className="num shrink-0 text-xs text-muted-foreground">
                      {t("count", { n: s?.count ?? 0 })}
                    </p>
                  </div>
                  {r.conversion >= 0 && (
                    <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>
                        {t("conversion")} <b className="num text-foreground">{r.conversion}%</b>
                      </span>
                      <span>
                        {t("avg_confirm")}{" "}
                        <b className="num text-foreground">
                          {r.avgConfirmMin < 1
                            ? `${Math.round(r.avgConfirmMin * 60)}s`
                            : r.avgConfirmMin < 60
                              ? `${r.avgConfirmMin}m`
                              : `${r.avgConfirmMin / 60}h`}
                        </b>
                      </span>
                      <span>· {t("stats_mock")}</span>
                    </p>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      nav({ rail: on ? undefined : r.rail });
                    }}
                    aria-pressed={on}
                    className="relative z-10 mt-3 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full border px-3 text-xs font-semibold hover:border-primary hover:text-primary-text cursor-pointer"
                  >
                    <Icon.filter size={14} />
                    {on ? t("all") : t("filter_chip", { r: RAIL_NAME[r.rail] })}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
