// Perfil.tsx: profile screen — stall card on top, then settings sections (payment rails, savings goals, preferences).
// Rails and goals used to be top-level tabs; they now live here as sections picked by ?section=.
import { Icon } from "@/components/icons";
import { usePrefs } from "@/lib/prefs";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDash, type Section } from "./context";
import { Rieles } from "./Rieles";
import { Metas } from "./Metas";

const SECTIONS: {
  id: Section;
  icon: keyof typeof Icon;
  label: "s_rails" | "s_goals" | "s_prefs";
}[] = [
  { id: "rieles", icon: "rails", label: "s_rails" },
  { id: "metas", icon: "target", label: "s_goals" },
  { id: "prefs", icon: "sparkle", label: "s_prefs" },
];

export function Perfil() {
  const { stall, stalls, search, nav } = useDash();
  const p = usePrefs();
  const section = search.section ?? "rieles";

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <section className="tile overflow-hidden">
          <div className="bg-primary px-5 pb-10 pt-5 text-primary-foreground">
            <p className="text-xs font-semibold uppercase tracking-[0.14em]">{p.t("profile")}</p>
          </div>
          <div className="-mt-8 px-5 pb-5">
            <div className="flex size-16 items-center justify-center rounded-2xl border-4 border-card bg-accent font-mono text-2xl font-extrabold text-primary-text">
              {stall.name.slice(0, 1)}
            </div>
            <h2 className="mt-2 text-lg font-bold">{stall.name}</h2>
            <p className="text-sm text-muted-foreground">
              {stall.currency} · {p.t("rails_count", { n: stall.rails.length })}
            </p>
            {stalls.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {stalls.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => nav({ stall: s.id, rail: undefined })}
                    aria-pressed={s.id === stall.id}
                    className={cn(
                      "min-h-11 rounded-full border px-3 text-xs font-semibold cursor-pointer",
                      s.id === stall.id
                        ? "border-primary bg-accent text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <nav className="tile p-2" aria-label={p.t("settings")}>
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {p.t("settings")}
          </p>
          {SECTIONS.map((s) => {
            const I = Icon[s.icon];
            const on = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => nav({ section: s.id })}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold cursor-pointer",
                  on ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <I size={18} className="text-primary-text" />
                {p.t(s.label)}
                <Icon.chevR size={16} className="ml-auto text-muted-foreground" />
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0">
        <h2 className="mb-3 text-lg font-bold">
          {p.t(SECTIONS.find((s) => s.id === section)!.label)}
        </h2>
        {section === "rieles" && <Rieles />}
        {section === "metas" && <Metas />}
        {section === "prefs" && (
          <div className="tile divide-y">
            <Row icon={p.dark ? "sun" : "moon"} label={p.t("dark")}>
              <Toggle on={p.dark} onClick={() => p.set({ dark: !p.dark })} label={p.t("dark")} />
            </Row>
            <Row icon="text" label={p.t("large")}>
              <Toggle
                on={p.large}
                onClick={() => p.set({ large: !p.large })}
                label={p.t("large")}
              />
            </Row>
            <Row icon={p.privacy ? "eyeOff" : "eye"} label={p.t("privacy")}>
              <Toggle
                on={p.privacy}
                onClick={() => p.set({ privacy: !p.privacy })}
                label={p.t("privacy")}
              />
            </Row>
            <Row icon="globe" label={p.t("lang")}>
              <div className="flex gap-1">
                {(["es", "pt", "en"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => p.set({ lang: l })}
                    aria-pressed={p.lang === l}
                    className={cn(
                      "min-h-10 min-w-11 rounded-lg text-sm font-semibold uppercase cursor-pointer",
                      p.lang === l ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Row>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: keyof typeof Icon;
  label: string;
  children: React.ReactNode;
}) {
  const I = Icon[icon];
  return (
    <div className="flex min-h-16 items-center gap-3 px-4">
      <I size={20} className="text-primary-text" />
      <span className="flex-1 text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative h-7 w-12 rounded-full transition-colors cursor-pointer",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-card shadow transition-all",
          on ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}
