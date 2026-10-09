// MovGrid.tsx: AG Grid infinite-row table for Movimientos on desktop (date, amount, rail, status,
// type, origin); rows come from the load() callback, selection feeds the bulk action bar.
import { useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import { Icon } from "@/components/icons";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type IDatasource,
  type GridApi,
} from "ag-grid-community";
import { RAIL_NAME } from "@/components/icons";
import { usePrefs } from "@/lib/prefs";
import type { Tx } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--muted)",
  borderColor: "var(--border)",
  rowHoverColor: "var(--accent)",
  selectedRowBackgroundColor: "var(--accent)",
  accentColor: "var(--primary)",
  fontFamily: "var(--font-sans)",
  headerFontWeight: 700,
  rowHeight: 48,
  headerHeight: 44,
});

export default function MovGrid({
  load,
  onRow,
  onSelect,
  onError,
  gridRef,
}: {
  load: (
    start: number,
    end: number,
    sort?: { colId: string; sort: string },
  ) => Promise<{ rows: Tx[]; total: number }>;
  onRow: (t: Tx) => void;
  onSelect: (ids: string[]) => void;
  onError: () => void;
  gridRef: React.MutableRefObject<GridApi | null>;
}) {
  const { t, money, locale } = usePrefs();
  const loadRef = useRef(load);
  loadRef.current = load;

  const cols = useMemo<ColDef<Tx>[]>(
    () => [
      {
        field: "date",
        headerName: t("date"),
        flex: 1.3,
        sortable: true,
        valueFormatter: (p) =>
          p.value
            ? new Date(p.value).toLocaleString(locale, {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
      },
      {
        field: "amount",
        headerName: `${t("amount")} · ${t("local_filter")}`,
        flex: 1.1,
        sortable: true,
        cellClass: "num font-semibold",
        valueFormatter: (p) => (p.data ? money(p.data.amount, p.data.currency) : ""),
      },
      { field: "currency", headerName: t("currency"), width: 100 },
      {
        field: "rail",
        headerName: `${t("rail")} · ${t("local_filter")}`,
        flex: 1,
        sortable: true,
        valueFormatter: (p) => (p.value ? RAIL_NAME[p.value as Tx["rail"]] : ""),
      },
      {
        field: "status",
        headerName: t("status"),
        flex: 1,
        sortable: true,
        cellRenderer: (p: { value?: Tx["status"] }) =>
          p.value ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.value === "COMPLETED" ? "bg-success-soft text-success" : p.value === "pending_bank" ? "bg-warning-soft text-warning-foreground" : p.value === "denied" ? "bg-danger-soft text-destructive" : "bg-muted text-muted-foreground"}`}
            >
              {t(p.value)}
            </span>
          ) : (
            <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted" />
          ),
      },
      {
        field: "type",
        headerName: t("type"),
        width: 110,
        valueFormatter: (p) => (p.value ? t(p.value) : ""),
      },
      {
        field: "origin",
        headerName: t("origin"),
        flex: 1,
        cellRenderer: (p: { value?: Tx["origin"] }) =>
          p.value === "autodeclarado" ? (
            <span className="hatch-soft rounded-full border border-declared/40 px-2 py-0.5 text-xs font-semibold text-declared">
              {t("declared")}
            </span>
          ) : p.value ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold">
              <Icon.check size={12} />
              {t("verified")}
            </span>
          ) : null,
      },
    ],
    [t, money, locale],
  );

  const datasource = useMemo<IDatasource>(
    () => ({
      getRows: async (p) => {
        try {
          const s = p.sortModel[0];
          const { rows, total } = await loadRef.current(
            p.startRow,
            p.endRow,
            s ? { colId: s.colId, sort: s.sort } : undefined,
          );
          p.successCallback(rows, total);
          if (total === 0) p.api?.showNoRowsOverlay?.();
        } catch {
          p.failCallback();
          onError();
        }
      },
    }),
    // `load` is read through loadRef, but a new `load` (filters changed) must rebuild the datasource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, onError],
  );

  return (
    <div className="h-[600px] overflow-hidden rounded-2xl border">
      <AgGridReact<Tx>
        theme={theme}
        rowModelType="infinite"
        cacheBlockSize={100}
        datasource={datasource}
        columnDefs={cols}
        getRowId={(p) => p.data.id}
        rowSelection={{ mode: "multiRow", headerCheckbox: false }}
        onGridReady={(e) => {
          gridRef.current = e.api;
        }}
        onRowClicked={(e) => {
          if (e.data && !(e.event?.target as HTMLElement)?.closest(".ag-selection-checkbox"))
            onRow(e.data);
        }}
        onSelectionChanged={(e) => onSelect(e.api.getSelectedRows().map((r) => r.id))}
        overlayNoRowsTemplate={`<span>${t("empty")}</span>`}
      />
    </div>
  );
}
