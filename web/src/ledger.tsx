// web/src/ledger.tsx: the daily ledger at /backoffice/ledger — an AG Grid Community table of the
// day's sales with sorting, filters, quick search, status/reconciliation pills, a pinned total row
// recomputed over the filtered rows, line-item detail on row click, CSV export and SSE live updates.
// Payouts to suppliers are a separate section under the grid, so the grid's sales totals stay exact.

import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  type ColDef,
  ColumnApiModule,
  CsvExportModule,
  createGrid,
  type GridApi,
  ModuleRegistry,
  NumberFilterModule,
  PinnedRowModule,
  QuickFilterModule,
  RowApiModule,
  RowStyleModule,
  TextFilterModule,
  themeQuartz,
} from "ag-grid-community";
import { useEffect, useRef, useState } from "preact/hooks";
import { decimalsOf } from "../../shared/currency";
import { type Currency, formatMoney, type Money, money } from "../../shared/money";
import type { Payout } from "../../shared/types";
import { type Key, useT } from "./i18n";
import { LangToggle } from "./lang-toggle";
import { hiddenColumns, OPTIONAL_COLUMNS } from "./ledger-columns";
import { boUrl, tokenKey } from "./stall";

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ColumnApiModule,
  ClientSideRowModelApiModule,
  RowApiModule,
  TextFilterModule,
  NumberFilterModule,
  QuickFilterModule,
  PinnedRowModule,
  CsvExportModule,
  CellStyleModule,
  RowStyleModule,
]);

export const TOKEN_KEY = tokenKey();

interface Line {
  sku: string;
  name: string;
  qty: number;
  unitPrice: Money;
  subtotal: Money;
}
interface Row {
  id: string;
  method: "paypal" | "cash" | "pix" | "spei" | "breb";
  status: string;
  terminalId: string;
  captureId: string | null;
  createdAt: string;
  paidAt: string | null;
  total: Money;
  paid: Money;
  refunded: Money;
  net: Money;
  items: string;
  lines: Line[];
  reconciliation: string;
  /** Only on the pinned total row. */
  isTotal?: boolean;
}
interface Ledger {
  day: string;
  terminals: string[];
  rows: Row[];
  totals?: { paid: Money };
  payouts?: Payout[];
  paidOut?: Money;
}

/** Grid colors come from the app's CSS tokens, so light/dark follow styles.css. */
const theme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  accentColor: "var(--action)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--foreground)",
  chromeBackgroundColor: "var(--background)",
  rowHoverColor: "var(--muted)",
  borderRadius: "0.5rem",
  wrapperBorderRadius: "1rem",
  fontFamily: "inherit",
  headerFontFamily: "var(--font-display)",
});

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Grid cells hold major units for the number filter (display only; money math stays in minor units). */
const minor = (m: Money | undefined) => (m ? m.minor / 10 ** decimalsOf(m.currency) : 0);
const toMinorUnits = (v: number, c: Currency) => Math.round(v * 10 ** decimalsOf(c));

function pill(text: string, tone: string): HTMLElement {
  const el = document.createElement("span");
  el.className = `ledger-pill tone-${tone}`;
  el.textContent = text;
  return el;
}

const STATUS_TONE: Record<string, string> = {
  paid: "ok",
  refunded: "warn",
  open: "info",
  approved: "info",
  failed: "bad",
  expired: "muted",
  pending_bank: "info",
  vendor_confirmed: "warn",
};
const REC_TONE: Record<string, string> = {
  matched: "ok",
  cash: "ok",
  partial_refund: "warn",
  refunded: "warn",
  pending: "info",
  missing_capture: "bad",
  void: "muted",
  vendor_confirmed: "warn",
};

export function LedgerApp() {
  const { t, locale } = useT();
  const [token] = useState(readToken);
  // "" = the vendor's today, decided by the server in the policy time zone (not the browser's).
  const [day, setDay] = useState("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const grid = useRef<GridApi<Row> | null>(null);
  const dayRef = useRef(day);
  const currencyRef = useRef<Currency>("MXN");
  dayRef.current = day;

  async function load(d = dayRef.current) {
    if (!token) return;
    const res = await fetch(boUrl(d ? `/ledger?date=${d}` : "/ledger"), {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    if (!res) return setError(t("bo.offline"));
    if (res.status === 401) return setError(t("bo.sessionRequired"));
    if (!res.ok) return setError(t("bo.error", { code: res.status }));
    setError("");
    const data = (await res.json()) as Ledger;
    if (d === dayRef.current) {
      if (!d) setDay(data.day);
      currencyRef.current = data.totals?.paid.currency ?? data.rows[0]?.paid.currency ?? "MXN";
      setLedger(data);
      setUpdated(new Date());
    }
  }

  // Build the grid once per locale (headers and pills are translated at creation).
  useEffect(() => {
    if (!host.current || !token) return;
    const tr = (k: string) => t(k as Key);
    const moneyCol = (field: "paid" | "refunded" | "net", key: Key): ColDef<Row> => ({
      colId: field,
      headerName: t(key),
      valueGetter: (p) => minor(p.data?.[field]),
      valueFormatter: (p) =>
        formatMoney(
          money(toMinorUnits(Number(p.value) || 0, currencyRef.current), currencyRef.current),
        ),
      filter: "agNumberColumnFilter",
      type: "rightAligned",
      flex: 1,
      minWidth: 72,
      cellClass: (p) => (field === "net" && (p.value as number) < 0 ? "neg" : undefined),
    });
    const columnDefs: ColDef<Row>[] = [
      {
        colId: "time",
        headerName: t("ledger.col.time"),
        valueGetter: (p) => p.data?.paidAt ?? p.data?.createdAt ?? "",
        valueFormatter: (p) =>
          p.data?.isTotal
            ? t("ledger.total")
            : new Date(p.value as string).toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", {
                hour: "2-digit",
                minute: "2-digit",
              }),
        sort: "desc",
        width: 100,
      },
      { field: "terminalId", headerName: t("ledger.col.terminal"), width: 120 },
      {
        colId: "method",
        headerName: t("ledger.col.method"),
        valueGetter: (p) => (p.data?.isTotal ? "" : tr(`ledger.method.${p.data?.method}`)),
        width: 110,
      },
      {
        colId: "status",
        headerName: t("ledger.col.status"),
        valueGetter: (p) => (p.data?.isTotal ? "" : tr(`ledger.status.${p.data?.status}`)),
        cellRenderer: (p: { data?: Row; value: string }) =>
          p.data && !p.data.isTotal ? pill(p.value, STATUS_TONE[p.data.status] ?? "muted") : "",
        width: 120,
      },
      { field: "items", headerName: t("ledger.col.items"), flex: 2, minWidth: 96 },
      moneyCol("paid", "ledger.col.paid"),
      moneyCol("refunded", "ledger.col.refunded"),
      moneyCol("net", "ledger.col.net"),
      {
        colId: "reconciliation",
        headerName: t("ledger.col.reconciliation"),
        valueGetter: (p) => (p.data?.isTotal ? "" : tr(`ledger.rec.${p.data?.reconciliation}`)),
        cellRenderer: (p: { data?: Row; value: string }) =>
          p.data && !p.data.isTotal
            ? pill(p.value, REC_TONE[p.data.reconciliation] ?? "muted")
            : "",
        width: 160,
      },
      { field: "captureId", headerName: t("ledger.col.captureId"), width: 170, hide: false },
    ];
    const api = createGrid<Row>(host.current, {
      theme,
      columnDefs,
      defaultColDef: { sortable: true, filter: true, resizable: true },
      rowData: ledger?.rows ?? [],
      getRowId: (p) => p.data.id,
      quickFilterText: search,
      overlayNoRowsTemplate: `<span>${t("ledger.empty")}</span>`,
      getRowClass: (p) => (p.data?.isTotal ? "ledger-total" : undefined),
      onRowClicked: (e) => {
        if (e.data && !e.data.isTotal) setSelected(e.data);
      },
      onGridSizeChanged: (e) => fitColumns(e.api, e.clientWidth),
      onFirstDataRendered: (e) => fitColumns(e.api, host.current?.clientWidth ?? 1200),
      onModelUpdated: (e) =>
        pinTotals(e.api, (amount) => t("ledger.cashTotal", { amount }), currencyRef.current),
    });
    grid.current = api;
    fitColumns(api, host.current.clientWidth);
    return () => {
      api.destroy();
      grid.current = null;
    };
  }, [locale, token]);

  // Delta-update rows by id: AG Grid keeps sort, filters and scroll on live refresh.
  useEffect(() => {
    grid.current?.setGridOption("rowData", ledger?.rows ?? []);
    if (selected) setSelected(ledger?.rows.find((r) => r.id === selected.id) ?? null);
  }, [ledger]);

  useEffect(() => {
    grid.current?.setGridOption("quickFilterText", search);
  }, [search]);

  useEffect(() => {
    void load(day);
  }, [day, token]);

  // Live: every terminal's SSE stream; a paid, refunded, failed or new sale refetches the day.
  const terminals = (ledger?.terminals.length ? ledger.terminals : ["rosa-01"]).join(",");
  useEffect(() => {
    if (!token) return;
    const sources = terminals.split(",").map((id) => {
      const es = new EventSource(`/api/terminals/${encodeURIComponent(id)}/events`);
      for (const type of ["sale.open", "sale.paid", "sale.refunded", "sale.failed", "sale.expired"])
        es.addEventListener(type, () => void load());
      return es;
    });
    return () => {
      for (const es of sources) es.close();
    };
  }, [terminals, token]);

  function exportCsv() {
    grid.current?.exportDataAsCsv({
      fileName: `ledger-${day}.csv`,
      columnKeys: [
        "time",
        "terminalId",
        "method",
        "status",
        "items",
        "paid",
        "refunded",
        "net",
        "reconciliation",
        "captureId",
      ],
    });
  }

  if (!token)
    return (
      <main class="backoffice">
        <h1>
          {t("ledger.title")} <LangToggle />
        </h1>
        <p class="error">{t("bo.sessionRequired")}</p>
        <a href="/backoffice">{t("ledger.back")}</a>
      </main>
    );

  const tm = (m: Money) => formatMoney(m);
  return (
    <main class="backoffice ledger">
      <header class="bar">
        <h1 class="stall">{t("ledger.title")}</h1>
        <nav class="bar-actions">
          <LangToggle />
          <a class="bar-btn" href="/backoffice">
            {t("ledger.back")}
          </a>
        </nav>
      </header>
      <div class="ledger-tools">
        <label>
          {t("ledger.date")}
          <input type="date" value={day} onInput={(e) => setDay(e.currentTarget.value)} />
        </label>
        <input
          type="search"
          placeholder={t("ledger.search")}
          aria-label={t("ledger.search")}
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <button type="button" class="secondary" onClick={exportCsv}>
          {t("ledger.export")}
        </button>
        <span class="ledger-live" aria-live="polite">
          <span class="dot" /> {t("ledger.live")}
          {updated &&
            ` · ${t("ledger.updated", { time: updated.toLocaleTimeString(locale === "es" ? "es-MX" : "en-US") })}`}
        </span>
      </div>
      {error && <p class="error">{error}</p>}
      <div ref={host} class="ledger-grid" />
      <section class="panel ledger-payouts" aria-labelledby="ledger-payouts-title">
        <h2 id="ledger-payouts-title">{t("ledger.payouts")}</h2>
        {!ledger?.payouts?.length ? (
          <p class="muted">{t("ledger.payoutsEmpty")}</p>
        ) : (
          <table class="ledger-lines">
            <thead>
              <tr>
                <th>{t("ledger.col.time")}</th>
                <th>{t("pay.supplier")}</th>
                <th>{t("ledger.col.status")}</th>
                <th>{t("pay.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.payouts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {new Date(p.createdAt).toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{p.supplierName}</td>
                  <td>{t(`pay.status.${p.status}` as Key)}</td>
                  <td>−{tm(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            {ledger.paidOut && (
              <tfoot>
                <tr class="ledger-payouts-total">
                  <td colSpan={4}>{t("ledger.payoutsTotal", { amount: tm(ledger.paidOut) })}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </section>
      <section class="panel">
        <h2>{t("ledger.detail")}</h2>
        {!selected ? (
          <p class="muted">{t("ledger.detailHint")}</p>
        ) : (
          <table class="ledger-lines">
            <thead>
              <tr>
                <th>{t("ledger.col.items")}</th>
                <th>{t("ledger.line.qty")}</th>
                <th>{t("ledger.line.unit")}</th>
                <th>{t("ledger.line.subtotal")}</th>
              </tr>
            </thead>
            <tbody>
              {selected.lines.map((l) => (
                <tr key={l.sku}>
                  <td>{l.name}</td>
                  <td>{l.qty}</td>
                  <td>{tm(l.unitPrice)}</td>
                  <td>{tm(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>{t("ledger.total")}</td>
                <td>{tm(selected.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </main>
  );
}

/** Shows only the columns that fit, so phones keep Items, Paid, Refunded and Net on screen. */
function fitColumns(api: GridApi<Row>, width: number) {
  const hide = new Set(hiddenColumns(width));
  api.setColumnsVisible(
    OPTIONAL_COLUMNS.filter((c) => !hide.has(c)),
    true,
  );
  api.setColumnsVisible([...hide], false);
}

/** Pinned bottom row: sums over the rows that survive the current filters and quick search. */
function pinTotals(api: GridApi<Row>, cashLabel: (amount: string) => string, currency: Currency) {
  let paid = 0;
  let refunded = 0;
  let cash = 0;
  api.forEachNodeAfterFilter((n) => {
    if (!n.data) return;
    paid += n.data.paid.minor;
    refunded += n.data.refunded.minor;
    if (n.data.method === "cash") cash += n.data.paid.minor;
  });
  const m = (v: number) => money(v, currency);
  const total: Row = {
    id: "__total",
    isTotal: true,
    method: "paypal",
    status: "",
    terminalId: "",
    captureId: null,
    createdAt: "",
    paidAt: null,
    total: m(paid),
    paid: m(paid),
    refunded: m(refunded),
    net: m(paid - refunded),
    items: cash > 0 ? cashLabel(formatMoney(m(cash))) : "",
    lines: [],
    reconciliation: "",
  };
  const current = api.getGridOption("pinnedBottomRowData")?.[0];
  if (
    current &&
    current.paid.minor === paid &&
    current.refunded.minor === refunded &&
    current.items === total.items
  )
    return;
  api.setGridOption("pinnedBottomRowData", [total]);
}
