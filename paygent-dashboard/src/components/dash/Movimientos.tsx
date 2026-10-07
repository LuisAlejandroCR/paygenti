// Movimientos.tsx: activity tab — month KPI tiles (verified in, self-declared, pending, out) that
// double as filters, an in/out daily strip, search + filter pills, AG Grid on desktop and a
// swipeable card list on mobile (confirm pending / refund with PIN).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridApi } from "ag-grid-community";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon, RAIL_COLOR, RAIL_NAME, RailIcon, EmptyIllustration } from "@/components/icons";
import { getTransactions } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import {
  daysIn,
  downloadBlob,
  inMonth,
  isSale,
  parseMonth,
  split,
  toCsv,
  toStall,
} from "@/lib/stats";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Rail, Tx } from "@/lib/types";
import { useDash } from "./context";
import { BigButton, Money, OriginBadge, Panel, StatusChip, Tap } from "./shared";
import { cn } from "@/lib/utils";

const MovGrid = lazy(() => import("./MovGrid"));

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function Movimientos() {
  const { stall, search, nav, open } = useDash();
  const { t, locale } = usePrefs();
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [text, setText] = useState(search.q ?? "");
  const q = useDebounced(text);
  useEffect(() => { if ((search.q ?? "") !== q) nav({ q: q || undefined }); }, [q]); // eslint-disable-line
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const gridRef = useRef<GridApi | null>(null);

  const start = parseMonth(search.month);
  const end = new Date(start.getFullYear(), start.getMonth(), daysIn(search.month), 23, 59, 59);
  const status = search.filter === "pending_bank" ? "P" : undefined;

  // cache the server window, then apply local filters (rail, origin, text, non-date sort)
  const windowCache = useRef<{ key: string; p: Promise<Tx[]> } | null>(null);
  const fetchWindow = useCallback(() => {
    const key = `${stall.id}|${search.month}|${status}|${nonce}`;
    if (windowCache.current?.key !== key) {
      const p = (async () => {
        const out: Tx[] = [];
        for (let page = 1; ; page++) {
          const r = await getTransactions({
            stallId: stall.id,
            start: start.toISOString(),
            end: end.toISOString(),
            status,
            page,
            pageSize: 500,
          });
          out.push(...r.rows);
          if (out.length >= r.total || !r.rows.length) break;
        }
        return out;
      })();
      windowCache.current = { key, p };
    }
    return windowCache.current.p;
  }, [stall.id, search.month, status, nonce]); // eslint-disable-line

  const applyLocal = useCallback(
    (rows: Tx[], sort?: { colId: string; sort: string }) => {
      let r = rows;
      if (search.rail) r = r.filter((x) => x.rail === search.rail);
      if (search.filter === "verificado" || search.filter === "autodeclarado")
        r = r.filter((x) => x.origin === search.filter && x.status !== "pending_bank");
      if (search.q) {
        const s = search.q.toLowerCase();
        r = r.filter((x) =>
          `${x.amount} ${RAIL_NAME[x.rail]} ${t(x.status)} ${t(x.type)} ${x.item} ${x.currency}`
            .toLowerCase()
            .includes(s),
        );
      }
      if (sort && sort.colId !== "date") {
        const k = sort.colId as keyof Tx;
        r = [...r].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (sort.sort === "asc" ? 1 : -1));
      } else if (sort?.sort === "asc") r = [...r].reverse();
      return r;
    },
    [search.rail, search.filter, search.q, t],
  );

  const load = useCallback(
    async (s: number, e: number, sort?: { colId: string; sort: string }) => {
      setError(false);
      const rows = applyLocal(await fetchWindow(), sort);
      return { rows: rows.slice(s, e), total: rows.length };
    },
    [fetchWindow, applyLocal],
  );

  // mobile list state
  const [list, setList] = useState<Tx[] | null>(null);
  const refresh = useCallback(() => {
    setList(null);
    load(0, 200)
      .then((r) => setList(r.rows))
      .catch(() => setError(true));
  }, [load]);
  useEffect(() => { if (mobile) refresh(); else gridRef.current?.purgeInfiniteCache(); }, [load, mobile]); // eslint-disable-line

  const reload = () => {
    setNonce((n) => n + 1);
    qc.invalidateQueries({ queryKey: ["txs"] });
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (search.filter)
    chips.push({
      label: t(
        search.filter === "verificado"
          ? "verified"
          : search.filter === "autodeclarado"
            ? "declared"
            : "pending",
      ),
      clear: () => nav({ filter: undefined }),
    });
  if (search.rail)
    chips.push({ label: RAIL_NAME[search.rail], clear: () => nav({ rail: undefined }) });
  if (search.q) chips.push({ label: `"${search.q}"`, clear: () => setText("") });

  const pendingSel = selected; // confirm flow validates which are pending
  const exportSel = async () => {
    const all = await fetchWindow();
    downloadBlob(
      toCsv(
        all
          .filter((x) => selected.includes(x.id))
          .map(({ date, amount, currency, rail, status, type, origin }) => ({
            date,
            amount,
            currency,
            rail,
            status,
            type,
            origin,
          })),
      ),
      "movimientos.csv",
    );
  };

  const Filters = (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold">{t("origin")}</p>
        <div className="flex flex-wrap gap-2">
          {(["verificado", "autodeclarado", "pending_bank"] as const).map((f) => (
            <button
              key={f}
              onClick={() => nav({ filter: search.filter === f ? undefined : f })}
              aria-pressed={search.filter === f}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-semibold cursor-pointer transition-colors",
                search.filter === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card",
              )}
            >
              {t(f === "verificado" ? "verified" : f === "autodeclarado" ? "declared" : "pending")}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">
          {t("rail")}{" "}
          <span className="text-xs font-normal text-muted-foreground">· {t("local_filter")}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {stall.rails.map((r: Rail) => (
            <button
              key={r}
              onClick={() => nav({ rail: search.rail === r ? undefined : r })}
              aria-pressed={search.rail === r}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold cursor-pointer",
                search.rail === r ? "border-primary bg-primary text-primary-foreground" : "bg-card",
              )}
            >
              <RailIcon rail={r} size={16} /> {RAIL_NAME[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <MonthKpis />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <span className="sr-only">{t("search")}</span>
          <Icon.search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={18}
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("search")}
            className="h-12 w-full rounded-2xl border bg-card pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          onClick={() => setFiltersOpen(true)}
          className="inline-flex h-12 items-center gap-2 rounded-2xl border bg-card px-4 text-sm font-semibold cursor-pointer md:hidden"
        >
          <Icon.filter size={18} />
          {t("filters")}
        </button>
        <div className="hidden md:block">{Filters}</div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.label}
              onClick={c.clear}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent px-3 text-xs font-semibold text-accent-foreground cursor-pointer"
            >
              {c.label}
              <Icon.x size={14} />
            </button>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="sticky top-32 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-foreground p-2 pl-4 text-background shadow-lift">
          <span className="text-sm font-semibold">{t("selected", { n: selected.length })}</span>
          <button
            onClick={exportSel}
            className="ml-auto min-h-11 rounded-xl px-3 text-sm font-semibold hover:bg-background/10 cursor-pointer"
          >
            {t("a_export")}
          </button>
          <button
            onClick={() => open({ kind: "flow", flow: "confirmar", ids: pendingSel })}
            className="min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground cursor-pointer"
          >
            {t("confirm_pending")}
          </button>
        </div>
      )}

      {error ? (
        <div className="tile flex flex-col items-center gap-3 p-8 text-center" role="alert">
          <Icon.alert size={32} className="text-destructive" />
          <p className="font-semibold">{t("error")}</p>
          <BigButton
            className="w-auto"
            onClick={() => {
              setError(false);
              reload();
            }}
          >
            <Icon.refresh size={18} />
            {t("retry")}
          </BigButton>
        </div>
      ) : mobile ? (
        <MobileList
          list={list}
          onRefresh={() => {
            reload();
            refresh();
          }}
          onOpen={(id) => open({ kind: "tx", id })}
          onRefund={(id) => open({ kind: "flow", flow: "reembolso", txId: id })}
          onConfirm={(id) => open({ kind: "flow", flow: "confirmar", ids: [id] })}
          locale={locale}
        />
      ) : mounted ? (
        <Suspense fallback={<Skeleton className="h-[600px] rounded-2xl" />}>
          <MovGrid
            key={`${stall.id}-${search.month}-${status}-${nonce}`}
            load={load}
            gridRef={gridRef}
            onRow={(x) => open({ kind: "tx", id: x.id })}
            onSelect={setSelected}
            onError={() => setError(true)}
          />
        </Suspense>
      ) : (
        <Skeleton className="h-[600px] rounded-2xl" />
      )}

      <Panel open={filtersOpen} onOpenChange={setFiltersOpen} title={t("filters")}>
        {Filters}
        <BigButton className="mt-6" onClick={() => setFiltersOpen(false)}>
          {t("done")}
        </BigButton>
      </Panel>
    </div>
  );
}

function MobileList({
  list,
  onRefresh,
  onOpen,
  onRefund,
  onConfirm,
  locale,
}: {
  list: Tx[] | null;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onRefund: (id: string) => void;
  onConfirm: (id: string) => void;
  locale: string;
}) {
  const { t } = usePrefs();
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  if (!list)
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  if (!list.length)
    return (
      <div className="tile flex flex-col items-center gap-2 p-10">
        <EmptyIllustration />
        <p className="font-semibold">{t("empty")}</p>
      </div>
    );
  return (
    <div
      onTouchStart={(e) => {
        if (window.scrollY <= 0) startY.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (startY.current != null)
          setPull(Math.max(0, Math.min(80, e.touches[0].clientY - startY.current)));
      }}
      onTouchEnd={() => {
        if (pull > 60) onRefresh();
        setPull(0);
        startY.current = null;
      }}
    >
      {pull > 0 && (
        <div
          className="flex justify-center py-2 text-xs text-muted-foreground"
          style={{ height: pull }}
        >
          <Icon.refresh className={pull > 60 ? "text-primary" : ""} /> {t("pull")}
        </div>
      )}
      <ul className="space-y-2">
        {list.map((x) => (
          <SwipeCard
            key={x.id}
            tx={x}
            locale={locale}
            onOpen={() => onOpen(x.id)}
            onRefund={() => onRefund(x.id)}
            onConfirm={() => onConfirm(x.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function SwipeCard({
  tx,
  locale,
  onOpen,
  onRefund,
  onConfirm,
}: {
  tx: Tx;
  locale: string;
  onOpen: () => void;
  onRefund: () => void;
  onConfirm: () => void;
}) {
  const { t } = usePrefs();
  const [dx, setDx] = useState(0);
  const sx = useRef<number | null>(null);
  const time = useMemo(
    () =>
      new Date(tx.date).toLocaleString(locale, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [tx.date, locale],
  );
  return (
    <li className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 flex">
        {tx.status === "pending_bank" && (
          <button
            onClick={onConfirm}
            className="w-24 bg-success text-xs font-bold text-background cursor-pointer"
          >
            {t("confirm")}
          </button>
        )}
        {tx.status === "COMPLETED" && tx.type === "venta" && (
          <button
            onClick={onRefund}
            className="w-24 bg-destructive text-xs font-bold text-destructive-foreground cursor-pointer"
          >
            {t("a_refund")}
          </button>
        )}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => (dx ? setDx(0) : onOpen())}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
        onTouchStart={(e) => {
          sx.current = e.touches[0].clientX;
        }}
        onTouchMove={(e) => {
          if (sx.current != null)
            setDx(Math.min(0, Math.max(-96, e.touches[0].clientX - sx.current)));
        }}
        onTouchEnd={() => {
          setDx(dx < -48 ? -96 : 0);
          sx.current = null;
        }}
        style={{ transform: `translateX(${dx}px)` }}
        className="tile relative flex min-h-20 items-center gap-3 p-3 transition-transform cursor-pointer"
      >
        <span
          className="flex size-11 items-center justify-center rounded-xl text-primary-foreground"
          style={{ background: RAIL_COLOR[tx.rail] }}
        >
          <RailIcon rail={tx.rail} />
        </span>
        <div className="min-w-0 flex-1">
          <Money
            value={tx.type === "venta" ? tx.amount : -tx.amount}
            currency={tx.currency}
            className="block text-lg font-bold"
          />
          <p className="text-xs text-muted-foreground">
            {RAIL_NAME[tx.rail]} · {time}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusChip status={tx.status} />
          {tx.origin === "autodeclarado" && <OriginBadge origin={tx.origin} small />}
        </div>
      </div>
    </li>
  );
}

/** Month KPI tiles: each one is a filter toggle; verified, self-declared and pending stay apart. */
function MonthKpis() {
  const { txs, stall, search, nav, open } = useDash();
  const { t, money } = usePrefs();
  const c = stall.currency;
  const m = useMemo(() => inMonth(txs, search.month), [txs, search.month]);
  const sp = split(m, c);
  const outs = m.filter(
    (x) => (x.type === "reembolso" || x.type === "payout") && x.status === "COMPLETED",
  );
  const out = outs.reduce((a, x) => a + toStall(x, c), 0);
  const n = daysIn(search.month);
  const flow = useMemo(() => {
    const rows = Array.from({ length: n }, (_, i) => ({ day: i + 1, inV: 0, out: 0 }));
    for (const x of m) {
      const d = rows[new Date(x.date).getDate() - 1];
      if (!d) continue;
      if (
        x.type === "venta" &&
        isSale(x) &&
        x.status !== "pending_bank" &&
        x.origin === "verificado"
      )
        d.inV += toStall(x, c);
      else if (x.type !== "venta" && x.status === "COMPLETED") d.out += toStall(x, c);
    }
    return rows;
  }, [m, c, n]);
  const fMax = Math.max(1, ...flow.map((f) => Math.max(f.inV, f.out)));
  const tiles = [
    {
      k: "verificado" as const,
      label: t("money_in"),
      v: sp.verified,
      icon: <Icon.check size={16} />,
      cls: "text-verified",
    },
    {
      k: "autodeclarado" as const,
      label: t("declared"),
      v: sp.declared,
      icon: <span className="hatch size-3.5 rounded-sm border border-declared" />,
      cls: "text-declared",
    },
    {
      k: "pending_bank" as const,
      label: t("pending"),
      v: sp.pending,
      n: sp.pendingCount,
      icon: <Icon.clock size={16} />,
      cls: "text-warning-foreground",
    },
  ];
  return (
    <section className="grid gap-3 lg:grid-cols-[3fr_2fr]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((x) => {
          const on = search.filter === x.k;
          return (
            <Tap
              key={x.k}
              label={x.label}
              onClick={() => nav({ filter: on ? undefined : x.k })}
              className={cn("tile p-3 sm:p-4", on && "ring-2 ring-primary")}
            >
              <span className={cn("flex items-center gap-1.5 text-xs font-semibold", x.cls)}>
                {x.icon}
                {x.label}
              </span>
              <Money
                value={x.v}
                currency={c}
                compact
                className="mt-1 block text-lg font-bold sm:text-xl"
              />
              <span className="text-[11px] text-muted-foreground">
                {x.n !== undefined ? t("count", { n: x.n }) : on ? t("filters") : " "}
              </span>
            </Tap>
          );
        })}
        <Tap
          label={t("money_out")}
          onClick={() => open({ kind: "flow", flow: "payout" })}
          className="tile p-3 sm:p-4"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <Icon.refund size={16} />
            {t("money_out")}
          </span>
          <Money
            value={-out}
            currency={c}
            compact
            className="mt-1 block text-lg font-bold sm:text-xl"
          />
          <span className="text-[11px] text-muted-foreground">{t("out_hint")}</span>
        </Tap>
      </div>
      <div
        className="tile p-3 sm:p-4"
        role="img"
        aria-label={`${t("flow_daily")}: ${money(sp.verified, c)} / ${money(out, c)}`}
      >
        <p className="mb-2 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
          {t("flow_daily")}
          <span className="ml-auto flex items-center gap-1">
            <span className="size-2 rounded-sm bg-verified" />
            {t("verified")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-destructive/70" />
            {t("money_out")}
          </span>
        </p>
        <div className="flex h-20 items-center gap-[2px]">
          {flow.map((f) => (
            <div
              key={f.day}
              className="flex h-full flex-1 flex-col"
              title={`${f.day}: +${money(f.inV, c)} / -${money(f.out, c)}`}
            >
              <div className="flex flex-1 items-end">
                <span
                  className="w-full rounded-t-sm bg-verified"
                  style={{ height: `${(f.inV / fMax) * 100}%` }}
                />
              </div>
              <div className="h-px bg-border" />
              <div className="flex flex-1 items-start">
                <span
                  className="w-full rounded-b-sm bg-destructive/70"
                  style={{ height: `${(f.out / fMax) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
