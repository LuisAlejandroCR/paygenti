// Metas.tsx: profile > savings goals — wine summary band (total saved vs target, ring), one tile
// per goal with progress bar, amount left and weekly pace to the deadline, plus create and
// statement-import tiles. Live mode has a single server goal (PUT /savings-goal) with no deadline.
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/icons";
import { getGoals, LIVE } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { TODAY } from "@/lib/mock";
import { useDash } from "./context";
import { Money, Tap } from "./shared";

export function Ring({ pct, size = 88, onWine }: { pct: number; size?: number; onWine?: boolean }) {
  const r = (size - 10) / 2,
    c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label={`${Math.round(pct)}%`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={
          onWine
            ? "color-mix(in oklab, var(--primary-foreground) 20%, transparent)"
            : "var(--muted)"
        }
        strokeWidth="8"
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={onWine ? "var(--primary-foreground)" : "var(--primary)"}
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, pct / 100))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-700"
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className={`num text-sm font-bold ${onWine ? "fill-primary-foreground" : "fill-foreground"}`}
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

export function Metas() {
  const { stall, open } = useDash();
  const { t, locale } = usePrefs();
  const c = stall.currency;
  const { data, isLoading } = useQuery({
    queryKey: ["goals", stall.id],
    queryFn: () => getGoals(stall.id),
  });
  const saved = data?.reduce((a, g) => a + g.saved, 0) ?? 0;
  const target = data?.reduce((a, g) => a + g.target, 0) ?? 0;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-5 rounded-3xl bg-primary p-5 text-primary-foreground shadow-lift">
        <Ring pct={target ? (saved / target) * 100 : 0} size={96} onWine />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
            {t("goals_total")}
          </p>
          <Money
            value={saved}
            currency={c}
            className="mt-1 block text-4xl font-extrabold tracking-tight"
          />
          <p className="mt-1 text-sm opacity-85">
            {t("target")} <Money value={target} currency={c} compact /> · {t("remaining")}{" "}
            <Money value={Math.max(0, target - saved)} currency={c} compact />
          </p>
          {LIVE && <p className="mt-1 text-xs opacity-75">{t("one_goal")}</p>}
        </div>
        <Tap
          onClick={() => open({ kind: "goal" })}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary-foreground px-4 text-sm font-semibold text-primary hover:shadow-none"
        >
          <Icon.plus size={16} />
          {t("create_goal")}
        </Tap>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading &&
          Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        {data?.map((g) => {
          const I = Icon[g.icon];
          const pct = g.target ? (g.saved / g.target) * 100 : 0;
          const left = Math.max(0, g.target - g.saved);
          const weeks = g.deadline
            ? Math.max(
                1,
                Math.ceil((new Date(g.deadline).getTime() - TODAY.getTime()) / (7 * 86400000)),
              )
            : 0;
          return (
            <Tap
              key={g.id}
              label={g.name}
              onClick={() => open({ kind: "goal", id: g.id })}
              className="tile flex flex-col gap-3 p-4"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <I size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.deadline
                      ? t("goal_due", {
                          d: new Date(g.deadline).toLocaleDateString(locale, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }),
                        })
                      : t("saved_of", { p: Math.round(pct) })}
                  </p>
                </div>
                <span className="num text-lg font-bold text-primary">{Math.round(pct)}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">{t("save")}</p>
                  <Money value={g.saved} currency={c} compact className="font-bold" />
                </div>
                <div>
                  <p className="text-muted-foreground">{t("remaining")}</p>
                  <Money value={left} currency={c} compact className="font-bold" />
                </div>
                <div>
                  <p className="text-muted-foreground">{t("per_week")}</p>
                  {weeks ? (
                    <Money value={left / weeks} currency={c} compact className="font-bold" />
                  ) : (
                    <span className="num font-bold">—</span>
                  )}
                </div>
              </div>
            </Tap>
          );
        })}
        <Tap
          onClick={() => open({ kind: "flow", flow: "importar" })}
          className="tile hatch-soft flex min-h-44 flex-col items-center justify-center gap-2 p-5 text-center"
        >
          <Icon.upload size={32} className="text-declared" />
          <span className="font-bold">{t("import_title")}</span>
          <span className="text-xs text-muted-foreground">
            CSV · OFX — {t("declared")}, {t("not_verified")}
          </span>
        </Tap>
      </div>
    </div>
  );
}
