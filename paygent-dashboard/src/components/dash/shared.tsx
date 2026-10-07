import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { usePrefs, haptic } from "@/lib/prefs";
import { Icon } from "@/components/icons";
import type { Currency, Origin, TxStatus } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadBlob, toCsv } from "@/lib/stats";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

/** Animated number that respects reduced motion. */
export function Money({
  value,
  currency,
  compact,
  className,
}: {
  value: number;
  currency: Currency;
  compact?: boolean;
  className?: string;
}) {
  const { money } = usePrefs();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const start = performance.now(),
      a = from.current,
      b = value;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 500);
      setShown(a + (b - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={cn("num", className)}>{money(shown, currency, { compact })}</span>;
}

/** Div that behaves like a button: pointer, keyboard (Enter/Space), press scale. */
export function Tap({
  onClick,
  className,
  children,
  label,
  onContextMenu,
}: {
  onClick: () => void;
  className?: string;
  children: ReactNode;
  label?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onKeyDown={onKey}
      onContextMenu={onContextMenu}
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn("pressable", className)}
    >
      {children}
    </div>
  );
}

export function OriginBadge({ origin, small }: { origin: Origin; small?: boolean }) {
  const { t } = usePrefs();
  if (origin === "verificado")
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-accent text-accent-foreground font-medium",
          small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        )}
      >
        <Icon.check size={12} /> {t("verified")}
      </span>
    );
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-declared/40 text-declared font-medium hatch-soft",
        small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
      )}
    >
      {t("not_verified")}
    </span>
  );
}

export function SeriesSwatch({ kind }: { kind: "verified" | "declared" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3 rounded-sm",
        kind === "verified" ? "bg-verified" : "hatch border border-declared",
      )}
    />
  );
}

const STATUS_STYLE: Record<TxStatus, string> = {
  COMPLETED: "bg-success-soft text-success",
  pending_bank: "bg-warning-soft text-warning-foreground",
  refunded: "bg-muted text-muted-foreground",
  denied: "bg-danger-soft text-destructive",
};
export function StatusChip({ status }: { status: TxStatus }) {
  const { t } = usePrefs();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        STATUS_STYLE[status],
      )}
    >
      {status === "COMPLETED" ? (
        <Icon.check size={12} />
      ) : status === "pending_bank" ? (
        <Icon.clock size={12} />
      ) : status === "refunded" ? (
        <Icon.refund size={12} />
      ) : (
        <Icon.x size={12} />
      )}
      {t(status)}
    </span>
  );
}

export function Delta({ pct, label }: { pct: number; label: string }) {
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold num",
        up ? "bg-success-soft text-success" : "bg-danger-soft text-destructive",
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}% {label}
    </span>
  );
}

/** Wrapper for every chart: title, "ver como tabla" toggle, PNG/CSV export, hidden data table. */
export function ChartCard({
  title,
  summary,
  rows,
  children,
  action,
  className,
}: {
  title: string;
  summary: string;
  rows: Record<string, string | number>[];
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { t } = usePrefs();
  const [table, setTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const exportPng = () => {
    const svg = ref.current?.querySelector(
      "svg.recharts-surface, svg[data-chart]",
    ) as SVGSVGElement | null;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const { width, height } = svg.getBoundingClientRect();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = width * 2;
      c.height = height * 2;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => b && downloadBlob(b, `${title}.png`, "image/png"));
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  };
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <section className={cn("tile p-4 sm:p-5", className)} aria-label={summary}>
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <div className="ml-auto flex items-center gap-1">
          {action}
          <button
            onClick={() => setTable((v) => !v)}
            className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted cursor-pointer"
            aria-label={table ? t("view_chart") : t("view_table")}
            title={table ? t("view_chart") : t("view_table")}
          >
            {table ? <Icon.chart /> : <Icon.table />}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted cursor-pointer"
              aria-label={t("export")}
            >
              <Icon.download />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPng}>PNG</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadBlob(toCsv(rows), `${title}.csv`)}>
                CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div ref={ref} className={table ? "hidden" : ""}>
        {children}
      </div>
      <div className={table ? "max-h-72 overflow-auto" : "sr-only"}>
        <table className="w-full text-sm">
          <caption className="sr-only">{summary}</caption>
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k} className="border-b py-1.5 text-left font-semibold">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {keys.map((k) => (
                  <td key={k} className="border-b py-1.5 num">
                    {r[k]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Bottom sheet on mobile, side panel on desktop. */
export function Panel({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn(
          "overflow-y-auto bg-background",
          mobile ? "max-h-[92vh] rounded-t-3xl" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader>
          <SheetTitle className="text-lg">{title}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(1, ...data);
  const pts = data
    .map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${30 - (v / max) * 26}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn("h-8 w-full", className)}
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function BigButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline";
  className?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => {
        haptic();
        onClick?.();
      }}
      className={cn(
        "pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary"
          ? "bg-primary text-primary-foreground"
          : "border-2 border-border bg-card text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
