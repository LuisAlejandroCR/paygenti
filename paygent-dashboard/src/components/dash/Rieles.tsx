import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { RAIL_COLOR, RAIL_NAME, RailIcon } from "@/components/icons";
import { getRails, setRailEnabled } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import type { RailInfo } from "@/lib/types";
import type { TKey } from "@/lib/i18n";
import { useDash } from "./context";
import { usePin } from "./pin";
import { Sparkline, Tap } from "./shared";
import { cn } from "@/lib/utils";

export function Rieles() {
  const { stall, open } = useDash();
  const { t } = usePrefs();
  const pin = usePin();
  const qc = useQueryClient();
  const key = ["rails", stall.id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => getRails(stall.id) });

  const mut = useMutation({
    mutationFn: ({ rail, enabled }: { rail: string; enabled: boolean }) => setRailEnabled(stall.id, rail, enabled),
    onMutate: async ({ rail, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RailInfo[]>(key);
      qc.setQueryData<RailInfo[]>(key, (old) => old?.map((r) => (r.rail === rail ? { ...r, enabled } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { qc.setQueryData(key, ctx?.prev); toast.error(t("failed")); },
    onSuccess: () => toast.success(t("done")),
  });

  if (isLoading || !data) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((r) => {
        const disabled = !!r.reason;
        return (
          <Tap key={r.rail} label={RAIL_NAME[r.rail]} onClick={() => open({ kind: "rail", rail: r.rail })}
            className={cn("tile p-5", (disabled || !r.enabled) && "opacity-60 grayscale")}>
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl text-primary-foreground" style={{ background: RAIL_COLOR[r.rail] }}><RailIcon rail={r.rail} size={22} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">{RAIL_NAME[r.rail]}</p>
                <p className="text-xs text-muted-foreground">{disabled ? t(r.reason as TKey) : r.enabled ? t("on") : t("off")}</p>
              </div>
              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex min-h-11 items-center">
                <Switch checked={r.enabled && !disabled} disabled={disabled} aria-label={`${RAIL_NAME[r.rail]} ${r.enabled ? t("on") : t("off")}`}
                  onCheckedChange={async (v) => { if (await pin(`${RAIL_NAME[r.rail]}: ${v ? t("on") : t("off")}`)) mut.mutate({ rail: r.rail, enabled: v }); }} />
              </div>
            </div>
            {!disabled && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">{t("conversion")}</p><p className="num text-xl font-bold">{r.conversion}%</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("avg_confirm")}</p><p className="num text-xl font-bold">{r.avgConfirmMin < 1 ? `${Math.round(r.avgConfirmMin * 60)}s` : r.avgConfirmMin < 60 ? `${r.avgConfirmMin}m` : `${r.avgConfirmMin / 60}h`}</p></div>
                </div>
                <Sparkline data={r.trend} className="mt-3 text-primary" />
              </>
            )}
          </Tap>
        );
      })}
    </div>
  );
}
