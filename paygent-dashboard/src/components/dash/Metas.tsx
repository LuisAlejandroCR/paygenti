import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/icons";
import { getGoals } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { useDash } from "./context";
import { Money, Tap } from "./shared";

export function Ring({ pct, size = 88 }: { pct: number; size?: number }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} role="img" aria-label={`${Math.round(pct)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--muted)" strokeWidth="8" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--primary)" strokeWidth="8" fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, pct / 100))} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="transition-all duration-700" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="num fill-foreground text-sm font-bold">{Math.round(pct)}%</text>
    </svg>
  );
}

export function Metas() {
  const { stall, open } = useDash();
  const { t, locale } = usePrefs();
  const { data, isLoading } = useQuery({ queryKey: ["goals", stall.id], queryFn: () => getGoals(stall.id) });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {isLoading && Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
      {data?.map((g) => {
        const I = Icon[g.icon];
        return (
          <Tap key={g.id} label={g.name} onClick={() => open({ kind: "goal", id: g.id })} className="tile flex items-center gap-4 p-5">
            <Ring pct={(g.saved / g.target) * 100} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-bold"><I size={18} className="text-primary" />{g.name}</p>
              <p className="mt-1 text-sm"><Money value={g.saved} currency={stall.currency} compact className="font-semibold" /> <span className="text-muted-foreground">/ </span><Money value={g.target} currency={stall.currency} compact className="text-muted-foreground" /></p>
              <p className="mt-1 text-xs text-muted-foreground">{t("goal_due", { d: new Date(g.deadline).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) })}</p>
            </div>
          </Tap>
        );
      })}
      <Tap onClick={() => open({ kind: "goal" })} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-accent/40 p-5 text-accent-foreground">
        <Icon.piggy size={44} />
        <span className="flex items-center gap-1 font-bold"><Icon.plus size={18} />{t("create_goal")}</span>
      </Tap>
      <Tap onClick={() => open({ kind: "flow", flow: "importar" })} className="tile flex min-h-40 flex-col items-center justify-center gap-2 p-5 sm:col-span-2 lg:col-span-3 hatch-soft">
        <Icon.upload size={36} className="text-declared" />
        <span className="font-bold">{t("import_title")}</span>
        <span className="text-xs text-muted-foreground">CSV · OFX — {t("declared")}</span>
      </Tap>
    </div>
  );
}
