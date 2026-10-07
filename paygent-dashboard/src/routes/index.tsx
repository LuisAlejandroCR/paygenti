import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/icons";
import { PrefsProvider, usePrefs, haptic } from "@/lib/prefs";
import { getAllForStall } from "@/lib/api";
import { STALLS, TODAY } from "@/lib/mock";
import { monthKey } from "@/lib/stats";
import type { Rail } from "@/lib/types";
import { DashCtx, type Overlay, type Search, type Section, type Tab } from "@/components/dash/context";
import { PinProvider } from "@/components/dash/pin";
import { Header, MonthSwitcher } from "@/components/dash/Header";
import { Resumen } from "@/components/dash/Resumen";
import { Ventas } from "@/components/dash/Ventas";
import { Movimientos } from "@/components/dash/Movimientos";
import { Perfil } from "@/components/dash/Perfil";
import { Overlays } from "@/components/dash/Overlays";
import { cn } from "@/lib/utils";
import type { TKey } from "@/lib/i18n";

const TABS: Tab[] = ["resumen", "ventas", "movimientos", "perfil"];
const SECTIONS: Section[] = ["rieles", "metas", "prefs"];
const RAILS: Rail[] = ["paypal", "card", "applepay", "googlepay", "pix", "spei", "oxxo"];

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    // old links ?tab=rieles / ?tab=metas land on the profile section
    tab: TABS.includes(s["tab"] as Tab) ? (s["tab"] as Tab) : SECTIONS.includes(s["tab"] as Section) ? "perfil" : undefined,
    section: SECTIONS.includes(s["section"] as Section) ? (s["section"] as Section) : SECTIONS.includes(s["tab"] as Section) ? (s["tab"] as Section) : undefined,
    month: typeof s["month"] === "string" && /^\d{4}-\d{2}$/.test(s["month"]) ? s["month"] : undefined,
    stall: typeof s["stall"] === "string" ? s["stall"] : undefined,
    rail: RAILS.includes(s["rail"] as Rail) ? (s["rail"] as Rail) : undefined,
    filter: ["verificado", "autodeclarado", "pending_bank"].includes(s["filter"] as string) ? (s["filter"] as Search["filter"]) : undefined,
    q: typeof s["q"] === "string" ? s["q"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Paygent — Tus ventas del puesto, claras" },
      { name: "description", content: "Panel de pagos para vendedores ambulantes: ventas verificadas y autodeclaradas, rieles, movimientos y metas." },
      { property: "og:title", content: "Paygent — Tus ventas del puesto, claras" },
      { property: "og:description", content: "Ventas verificadas y autodeclaradas, rieles de pago, movimientos y metas de ahorro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <PrefsProvider>
      <PinProvider>
        <Dashboard />
        <Toaster position="top-center" />
      </PinProvider>
    </PrefsProvider>
  ),
});

const TAB_ICON: Record<Tab, keyof typeof Icon> = { resumen: "home", ventas: "chart", movimientos: "list", perfil: "user" };

function Dashboard() {
  const raw = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const { t } = usePrefs();
  const search = { ...raw, tab: raw.tab ?? "resumen", month: raw.month ?? monthKey(TODAY), stall: raw.stall ?? STALLS[0].id } as const;
  const stall = STALLS.find((s) => s.id === search.stall) ?? STALLS[0];
  const [overlay, setOverlay] = useState<Overlay>(null);

  // remember last stall per device
  useEffect(() => {
    if (!raw.stall) { const s = localStorage.getItem("paygent-stall"); if (s && s !== stall.id && STALLS.some((x) => x.id === s)) navigate({ search: (p) => ({ ...p, stall: s }), replace: true }); }
  }, []); // eslint-disable-line
  useEffect(() => { localStorage.setItem("paygent-stall", stall.id); }, [stall.id]);

  const nav = (s: Partial<Search>) => navigate({ search: (p) => ({ ...p, ...s }) });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && raw.rail && !overlay) nav({ rail: undefined }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); 

  const { data: allTxs, isLoading } = useQuery({ queryKey: ["txs", stall.id], queryFn: () => getAllForStall(stall.id) });
  const txs = useMemo(() => (allTxs ?? []).filter((x) => !search.rail || x.rail === search.rail), [allTxs, search.rail]);

  const ctx = { search, stall, stalls: STALLS, txs, allTxs: allTxs ?? [], nav, open: setOverlay };

  return (
    <DashCtx.Provider value={ctx}>
      <div className="min-h-screen pb-24 md:pb-10">
        <Header />
        <nav className="mx-auto hidden max-w-6xl items-end justify-between gap-4 border-b px-4 pt-3 md:flex" aria-label="Secciones">
          <div role="tablist" className="flex gap-1">
            {TABS.map((tb) => {
              const I = Icon[TAB_ICON[tb]];
              const on = search.tab === tb;
              return (
                <button key={tb} role="tab" aria-selected={on} onClick={() => nav({ tab: tb })}
                  className={cn("relative inline-flex min-h-12 items-center gap-2 rounded-t-xl px-4 text-sm font-semibold transition-colors cursor-pointer",
                    on ? "text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                  <I size={18} />{t(`tabs_${tb}` as TKey)}
                  <span className={cn("absolute inset-x-3 -bottom-px h-[3px] rounded-full transition-all", on ? "bg-primary" : "bg-transparent")} />
                </button>
              );
            })}
          </div>
          {search.tab !== "perfil" && <MonthSwitcher className="mb-2" />}
        </nav>
        <main className="mx-auto max-w-6xl px-4 pt-4" role="tabpanel">
          {isLoading ? (
            <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-56 rounded-2xl lg:col-span-2" /><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl lg:col-span-2" /></div>
          ) : (
            <>
              {search.tab === "resumen" && <Resumen />}
              {search.tab === "ventas" && <Ventas />}
              {search.tab === "movimientos" && <Movimientos />}
              {search.tab === "perfil" && <Perfil />}
            </>
          )}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden" aria-label="Secciones">
          <div className="grid grid-cols-4" role="tablist">
            {TABS.map((tb) => {
              const I = Icon[TAB_ICON[tb]];
              const on = search.tab === tb;
              return (
                <button key={tb} role="tab" aria-selected={on} onClick={() => { haptic(); nav({ tab: tb }); }}
                  className={cn("flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold cursor-pointer", on ? "text-primary" : "text-muted-foreground")}>
                  <I size={22} />{t(`tabs_${tb}` as TKey)}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
      <Overlays overlay={overlay} close={() => setOverlay(null)} />
    </DashCtx.Provider>
  );
}
