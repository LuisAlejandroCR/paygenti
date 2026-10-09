import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon, RAIL_NAME } from "@/components/icons";
import { usePrefs } from "@/lib/prefs";
import { getNotifications, markRead, SANDBOX } from "@/lib/api";
import { monthName, parseMonth, shiftMonth, monthKey } from "@/lib/stats";
import { TODAY } from "@/lib/mock";
import { useDash } from "./context";
import { cn } from "@/lib/utils";
import type { TKey } from "@/lib/i18n";

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-muted cursor-pointer transition-colors";

export function MonthSwitcher({ className }: { className?: string }) {
  const { search, nav } = useDash();
  const { locale } = usePrefs();
  const max = monthKey(TODAY);
  const d = parseMonth(search.month);
  const mon = d.toLocaleDateString(locale, { month: "long" });
  const btn =
    "inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors disabled:opacity-30 disabled:pointer-events-none";
  return (
    <div
      className={cn(
        "inline-flex h-11 items-center gap-0.5 rounded-full border bg-card pl-1 pr-1",
        className,
      )}
    >
      <button
        className={btn}
        aria-label="Mes anterior"
        onClick={() => nav({ month: shiftMonth(search.month, -1) })}
      >
        <Icon.chevL size={18} />
      </button>
      <Select value={search.month} onValueChange={(v) => nav({ month: v })}>
        <SelectTrigger
          aria-label="Mes"
          className="h-9 min-w-36 justify-center gap-1.5 rounded-full border-0 bg-transparent px-3 shadow-none hover:bg-accent focus:ring-0 cursor-pointer"
        >
          <span className="font-mono text-base font-bold capitalize text-primary">{mon}</span>
          <span className="text-xs font-semibold text-muted-foreground">{d.getFullYear()}</span>
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {Array.from({ length: 12 }, (_, i) => shiftMonth(max, -i)).map((m) => (
            <SelectItem key={m} value={m}>
              {((x) => x[0].toUpperCase() + x.slice(1))(
                parseMonth(m).toLocaleDateString(locale, { month: "long", year: "numeric" }),
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        className={btn}
        aria-label="Mes siguiente"
        disabled={search.month >= max}
        onClick={() => nav({ month: shiftMonth(search.month, 1) })}
      >
        <Icon.chevR size={18} />
      </button>
    </div>
  );
}

export function Header() {
  const { stall, stalls, search, nav } = useDash();
  const p = usePrefs();
  const qc = useQueryClient();
  const { data: notifs = [] } = useQuery({ queryKey: ["notifs"], queryFn: getNotifications });
  const unread = notifs.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-30 bg-background/90 backdrop-blur border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Icon.store />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{p.t("hello")}</p>
            <Select value={stall.id} onValueChange={(v) => nav({ stall: v, rail: undefined })}>
              <SelectTrigger
                className="h-7 border-0 p-0 text-base font-bold shadow-none focus:ring-0 gap-1"
                aria-label="Puesto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stalls.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {SANDBOX ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold uppercase text-warning-foreground">
              {p.t("sandbox")}
            </span>
          ) : (
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold uppercase text-success">
              {p.t("live")}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            className={iconBtn}
            onClick={() => p.set({ privacy: !p.privacy })}
            aria-pressed={p.privacy}
            aria-label={p.t("privacy")}
            title={p.t("privacy")}
          >
            {p.privacy ? <Icon.eyeOff /> : <Icon.eye />}
          </button>
          <Popover>
            <PopoverTrigger
              className={cn(iconBtn, "relative")}
              aria-label={`${p.t("notifications")} (${unread})`}
            >
              <Icon.bell />
              {unread > 0 && (
                <span className="absolute right-2 top-2 size-2.5 rounded-full bg-primary ring-2 ring-background" />
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <p className="px-2 py-1 text-sm font-bold">{p.t("notifications")}</p>
              {notifs.map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    await markRead(n.id);
                    qc.invalidateQueries({ queryKey: ["notifs"] });
                    if (n.text === "notif_spei")
                      nav({ tab: "movimientos", filter: "pending_bank" });
                    if (n.text === "notif_goal") nav({ tab: "perfil", section: "metas" });
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-muted cursor-pointer"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-primary",
                    )}
                    aria-label={n.read ? undefined : "no leído"}
                  />
                  <span className={n.read ? "text-muted-foreground" : "font-medium"}>
                    {p.t(n.text as TKey)}
                  </span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button
            onClick={() => nav({ tab: "perfil" })}
            aria-label={p.t("profile")}
            title={p.t("profile")}
            className={cn(
              "ml-1 inline-flex size-10 items-center justify-center rounded-full border-2 font-mono text-sm font-extrabold cursor-pointer transition-colors",
              search.tab === "perfil"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/30 bg-accent text-primary hover:border-primary",
            )}
          >
            {stall.name.slice(0, 1)}
          </button>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-3 empty:hidden">
        {search.tab !== "perfil" && <MonthSwitcher className="md:hidden" />}
        {search.rail && (
          <button
            onClick={() => nav({ rail: undefined })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-3 text-sm font-semibold text-accent-foreground cursor-pointer"
            aria-label="Quitar filtro (Esc)"
          >
            {p.t("filter_chip", { r: RAIL_NAME[search.rail] })} <Icon.x size={16} />
          </button>
        )}
        <span className="sr-only">{monthName(search.month, p.locale)}</span>
      </div>
    </header>
  );
}
