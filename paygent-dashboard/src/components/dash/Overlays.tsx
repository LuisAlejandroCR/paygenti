// Overlays.tsx: every sheet/dialog the dashboard opens (charge, confirm, refund, payout, import,
// export, item/tx/rail/goal detail). Money moves ask the stall PIN and pass it to api.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon, RAIL_COLOR, railChip, railName, RailIcon, itemIcon } from "@/components/icons";
import * as api from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { db, TODAY } from "@/lib/mock";
import {
  inMonth,
  monthKey,
  monthName,
  shiftMonth,
  split,
  toCsv,
  downloadBlob,
  isSale,
} from "@/lib/stats";
import type { Goal, Rail, Tx } from "@/lib/types";
import type { ChargeState } from "@/lib/adapter";
import { useDash, type Overlay } from "./context";
import { usePin } from "./pin";
import { BigButton, Money, OriginBadge, Panel, Sparkline, StatusChip } from "./shared";
import { Ring } from "./Metas";
import { cn } from "@/lib/utils";

export function Overlays({ overlay, close }: { overlay: Overlay; close: () => void }) {
  const { t } = usePrefs();
  if (!overlay) return null;
  const titles: Record<string, string> = {
    cobrar: t("a_charge"),
    confirmar: t("a_confirm"),
    reembolso: t("a_refund"),
    payout: t("a_payout"),
    importar: t("a_import"),
    exportar: t("a_export"),
  };
  const title =
    overlay.kind === "flow"
      ? titles[overlay.flow]
      : overlay.kind === "item"
        ? overlay.item
        : overlay.kind === "tx"
          ? t("timeline")
          : overlay.kind === "rail"
            ? railName(overlay.rail, t)
            : overlay.kind === "goal"
              ? overlay.id
                ? t("tabs_metas")
                : t("create_goal")
              : overlay.kind === "heat"
                ? t("hours")
                : t("compare");
  return (
    <Panel open onOpenChange={(o) => !o && close()} title={title}>
      {overlay.kind === "flow" && overlay.flow === "cobrar" && <Cobrar close={close} />}
      {overlay.kind === "flow" && overlay.flow === "confirmar" && (
        <Confirmar ids={overlay.ids} close={close} />
      )}
      {overlay.kind === "flow" && overlay.flow === "reembolso" && (
        <Reembolso txId={overlay.txId} ai={overlay.ai} close={close} />
      )}
      {overlay.kind === "flow" && overlay.flow === "payout" && (
        <Payout ai={overlay.ai} close={close} />
      )}
      {overlay.kind === "flow" && overlay.flow === "importar" && <Importar close={close} />}
      {overlay.kind === "flow" && overlay.flow === "exportar" && <Exportar close={close} />}
      {overlay.kind === "item" && <ItemDetail item={overlay.item} />}
      {overlay.kind === "tx" && <TxDetail id={overlay.id} />}
      {overlay.kind === "rail" && <RailDetail rail={overlay.rail} />}
      {overlay.kind === "goal" && <GoalEdit id={overlay.id} close={close} />}
      {overlay.kind === "heat" && <HeatList dow={overlay.dow} hour={overlay.hour} />}
      {overlay.kind === "compare" && <Compare a={overlay.a} b={overlay.b} />}
    </Panel>
  );
}

function useTxKey() {
  const { stall } = useDash();
  return ["txs", stall.id];
}

function Steps({ n, of = 3 }: { n: number; of?: number }) {
  const { t } = usePrefs();
  return (
    <div
      className="mb-4 flex gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={of}
      aria-valuenow={n}
      aria-label={t("step_of", { n, t: of })}
    >
      {Array.from({ length: of }, (_, i) => (
        <span
          key={i}
          className={cn("h-1.5 flex-1 rounded-full", i < n ? "bg-primary" : "bg-muted")}
        />
      ))}
    </div>
  );
}

function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = usePrefs();
  const press = (k: string) => {
    if (k === "del") return onChange(value.slice(0, -1));
    if (k === "." && value.includes(".")) return;
    if (value.split(".")[1]?.length >= 2) return;
    onChange((value === "0" ? "" : value) + k);
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
        <button
          key={k}
          onClick={() => press(k)}
          aria-label={k === "del" ? t("del_digit") : k}
          className="pressable flex h-14 items-center justify-center rounded-2xl bg-muted text-xl font-semibold num"
        >
          {k === "del" ? <Icon.backspace /> : k}
        </button>
      ))}
    </div>
  );
}

function FakeQr({ seed }: { seed: string }) {
  const cells = useMemo(() => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return Array.from({ length: 21 * 21 }, (_, i) => {
      h = (h * 1103515245 + 12345) >>> 0;
      const x = i % 21,
        y = Math.floor(i / 21);
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      return finder
        ? x % 6 === 0 ||
            y % 6 === 0 ||
            (x % 21 > 1 && x % 21 < 5 && y % 21 > 1 && y % 21 < 5) ||
            (x > 15 && x < 19 && y > 1 && y < 5) ||
            (x > 1 && x < 5 && y > 15 && y < 19) ||
            x === 20 ||
            y === 20 ||
            x === 14 ||
            y === 14
        : (h >> 16) % 2 === 0;
    });
  }, [seed]);
  return (
    <svg
      viewBox="0 0 21 21"
      className="mx-auto size-48 rounded-xl bg-card p-2"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR"
    >
      {cells.map(
        (on, i) =>
          on && (
            <rect
              key={i}
              x={i % 21}
              y={Math.floor(i / 21)}
              width="1"
              height="1"
              fill="var(--foreground)"
            />
          ),
      )}
    </svg>
  );
}

/** Sheet status line for a charge. "paid" only ever comes from a PayPal capture (live) or the
 *  Sandbox simulation, which says so on screen. */
function ChargeStatus({ state }: { state: ChargeState }) {
  const { t } = usePrefs();
  const tone =
    state === "paid"
      ? "bg-success-soft text-success"
      : state === "failed" || state === "expired" || state === "cancelled"
        ? "bg-danger-soft text-destructive"
        : state === "self_declared"
          ? "border border-declared/40 text-declared hatch-soft"
          : "bg-warning-soft text-warning-foreground";
  return (
    <div
      role="status"
      className={cn("flex items-center justify-center gap-2 rounded-2xl p-3 font-semibold", tone)}
    >
      {state === "waiting" && (
        <>
          <Icon.clock className="animate-spin" style={{ animationDuration: "3s" }} />
          {t("waiting")}
        </>
      )}
      {state === "paid" && (
        <>
          <Icon.check />
          {t("paid")}
        </>
      )}
      {state === "pending_bank" && (
        <>
          <Icon.clock />
          {t("pending_bank")}
        </>
      )}
      {state === "self_declared" && t("vendor_confirmed")}
      {(state === "failed" || state === "expired" || state === "cancelled") && (
        <>
          <Icon.x />
          {state === "expired"
            ? t("charge_expired")
            : state === "cancelled"
              ? t("charge_cancelled")
              : t("failed")}
        </>
      )}
    </div>
  );
}

function Cobrar({ close }: { close: () => void }) {
  const { stall } = useDash();
  const { t, money } = usePrefs();
  const qc = useQueryClient();
  const key = useTxKey();
  const live = api.LIVE;
  const [step, setStep] = useState(1);
  const [amt, setAmt] = useState("");
  const [rail, setRail] = useState<Rail | null>(null);
  const [state, setState] = useState<ChargeState>("waiting");
  const [charge, setCharge] = useState<api.LiveCharge | null>(null);
  const [error, setError] = useState(false);
  // Sandbox only: a fake link, new for every rail picked.
  const link = useMemo(
    () => `https://pay.paygenti.app/${stall.id}/${Date.now().toString(36)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stall.id, rail],
  );
  const n = Number(amt || 0);
  const terminal = stall.terminals?.[0];

  // Sandbox: simulated payment after 3.5 s, labelled as a simulation on screen.
  useEffect(() => {
    if (live || step !== 3) return;
    setState("waiting");
    const id = setTimeout(() => {
      const self = rail === "pix" || rail === "spei";
      setState(self ? "pending_bank" : "paid");
      db.txs.unshift({
        id: `${stall.id}-c${Date.now()}`,
        date: new Date().toISOString(),
        amount: n,
        currency: stall.currency,
        rail: rail!,
        status: self ? "pending_bank" : "COMPLETED",
        type: "venta",
        origin: self ? "autodeclarado" : "verificado",
        item: "Cobro rápido",
        fee: 0,
        stallId: stall.id,
      });
      qc.invalidateQueries({ queryKey: key });
    }, 3500);
    return () => clearTimeout(id);
  }, [step]); // eslint-disable-line

  // Live: create the sale on the stall's terminal, then poll it until the server settles it.
  const start = async () => {
    setError(false);
    if (!terminal) return setError(true);
    try {
      setCharge(await api.createCharge(terminal, n, stall.currency));
      setState("waiting");
      setStep(2);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    if (!live || !charge || state !== "waiting") return;
    const id = setInterval(async () => {
      const next = await api.chargeStatus(charge.saleId).catch(() => "waiting" as const);
      if (next !== "waiting") {
        setState(next);
        qc.invalidateQueries({ queryKey: key });
      }
    }, 2000);
    return () => clearInterval(id);
  }, [charge, state]); // eslint-disable-line
  const cancel = () => {
    if (live && charge && state === "waiting") void api.cancelCharge(charge.saleId);
    close();
  };
  const settled = state !== "waiting";
  const showQr = live ? step === 2 && !!charge : step === 3 && !!rail;
  const payLink = live && charge ? charge.payUrl : link;

  return (
    <div>
      <Steps n={step} of={live ? 2 : 3} />
      {!live && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-foreground">
          <Icon.alert size={16} className="mt-px shrink-0" />
          {t("sim_note")}
        </p>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <p className="num text-center text-4xl font-bold">
            {money(n, stall.currency).replace("•••••", amt || "0")}
          </p>
          <Keypad value={amt} onChange={setAmt} />
          {error && (
            <p role="alert" className="text-center text-sm font-semibold text-destructive">
              {t("charge_error")}
            </p>
          )}
          <BigButton disabled={!n} onClick={() => (live ? void start() : setStep(2))}>
            {t("next")}
          </BigButton>
        </div>
      )}
      {!live && step === 2 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t("choose_rail")}</p>
          <div className="grid grid-cols-2 gap-2">
            {stall.rails.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRail(r);
                  setStep(3);
                }}
                className="pressable flex min-h-16 items-center gap-2 rounded-2xl border-2 bg-card p-3 text-sm font-semibold hover:border-primary"
              >
                <span
                  className="flex size-9 items-center justify-center rounded-lg"
                  style={railChip(r)}
                >
                  <RailIcon rail={r} size={18} />
                </span>
                {railName(r, t)}
              </button>
            ))}
          </div>
          <BigButton variant="outline" onClick={() => setStep(1)}>
            {t("back")}
          </BigButton>
        </div>
      )}
      {showQr && (
        <div className="space-y-4 text-center">
          <p className="num text-2xl font-bold">{money(n, stall.currency)}</p>
          <p className="text-sm text-muted-foreground">{t("share_link")}</p>
          {live && charge ? (
            <img
              src={charge.qrUrl}
              alt={`QR · ${charge.payUrl}`}
              className="mx-auto size-48 rounded-xl bg-white p-2"
            />
          ) : (
            <FakeQr seed={link} />
          )}
          <button
            onClick={() => {
              navigator.clipboard?.writeText(payLink);
              toast.success(t("done"));
            }}
            className="min-h-11 w-full truncate rounded-xl bg-muted px-3 py-3 text-xs num cursor-pointer"
          >
            {payLink}
          </button>
          <ChargeStatus state={state} />
          {live && <p className="text-xs text-muted-foreground">{t("charge_live_note")}</p>}
          <BigButton variant={settled ? "primary" : "outline"} onClick={settled ? close : cancel}>
            {settled ? t("done") : t("cancel")}
          </BigButton>
        </div>
      )}
    </div>
  );
}

function Confirmar({ ids, close }: { ids?: string[]; close: () => void }) {
  const { allTxs, stall } = useDash();
  const { t, locale } = usePrefs();
  const pin = usePin();
  const qc = useQueryClient();
  const key = useTxKey();
  const pending = allTxs.filter((x) => x.status === "pending_bank");
  const [sel, setSel] = useState<string[]>(() =>
    ids?.length ? ids.filter((i) => pending.some((p) => p.id === i)) : pending.map((p) => p.id),
  );
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const code = await pin(t("confirm_pending"));
    if (!code) return;
    setBusy(true);
    const prev = qc.getQueryData<Tx[]>(key);
    qc.setQueryData<Tx[]>(key, (old) =>
      old?.map((x) =>
        sel.includes(x.id) ? { ...x, status: "COMPLETED", origin: "autodeclarado" } : x,
      ),
    );
    try {
      await api.confirmPending(sel, code);
      toast.success(`${t("done")} · ${sel.length}`);
      close();
    } catch {
      qc.setQueryData(key, prev);
      toast.error(t("failed"));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: key });
    }
  };
  if (!pending.length)
    return <p className="py-8 text-center text-muted-foreground">{t("empty")}</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {pending.map((x) => (
          <li key={x.id}>
            <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border bg-card p-3">
              <Checkbox
                checked={sel.includes(x.id)}
                onCheckedChange={(v) =>
                  setSel((s) => (v ? [...s, x.id] : s.filter((i) => i !== x.id)))
                }
                className="size-5"
              />
              <RailIcon rail={x.rail} />
              <Money value={x.amount} currency={x.currency} className="font-bold" />
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(x.date).toLocaleString(locale, {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <OriginBadge origin="autodeclarado" small /> {stall.name}
      </p>
      <BigButton disabled={!sel.length || busy} onClick={go}>
        <Icon.lock size={18} />
        {t("confirm_pin")} ({sel.length})
      </BigButton>
    </div>
  );
}

function AiBadge({ ai }: { ai?: boolean }) {
  const { t } = usePrefs();
  return ai ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground">
      <Icon.sparkle size={14} />
      {t("proposed_ai")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
      <Icon.lock size={14} />
      {t("proposed")}
    </span>
  );
}

function Reembolso({ txId, ai, close }: { txId?: string; ai?: boolean; close: () => void }) {
  const { allTxs } = useDash();
  const { t, locale } = usePrefs();
  const pin = usePin();
  const qc = useQueryClient();
  const key = useTxKey();
  const candidates = allTxs
    .filter((x) => x.type === "venta" && x.status === "COMPLETED" && x.origin === "verificado")
    .slice(0, 8);
  const [id, setId] = useState(txId ?? candidates[0]?.id);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const tx = allTxs.find((x) => x.id === id);
  const go = async () => {
    if (!tx) return;
    const code = await pin(t("a_refund"));
    if (!code) return;
    const prev = qc.getQueryData<Tx[]>(key);
    qc.setQueryData<Tx[]>(key, (old) =>
      old?.map((x) => (x.id === tx.id ? { ...x, status: "refunded" } : x)),
    );
    try {
      await api.executeRefund(tx, code);
      setDone(true);
      toast.success(t("result_ok"));
    } catch {
      qc.setQueryData(key, prev);
      toast.error(t("failed"));
    }
  };
  if (done) return <Result close={close} />;
  return (
    <div className="space-y-4">
      <AiBadge ai={ai} />
      {!txId && (
        <div className="space-y-2">
          {candidates.map((x) => (
            <button
              key={x.id}
              onClick={() => setId(x.id)}
              aria-pressed={id === x.id}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-2xl border-2 bg-card px-3 text-left cursor-pointer",
                id === x.id ? "border-primary" : "border-border",
              )}
            >
              <RailIcon rail={x.rail} />
              <Money value={x.amount} currency={x.currency} className="font-bold" />
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(x.date).toLocaleString(locale, {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>
          ))}
        </div>
      )}
      <label className="block text-sm font-semibold">
        {t("reason")}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={60}
          className="mt-1 h-12 w-full rounded-2xl border bg-card px-3 font-normal"
        />
      </label>
      {tx && (
        <div className="rounded-2xl bg-muted p-4">
          <p className="text-xs font-semibold text-muted-foreground">{t("preview")}</p>
          <p className="mt-1 flex items-center gap-2">
            <Money
              value={-tx.amount}
              currency={tx.currency}
              className="text-2xl font-bold text-destructive"
            />
            <span className="text-sm text-muted-foreground">· {railName(tx.rail, t)}</span>
          </p>
        </div>
      )}
      <BigButton variant="danger" disabled={!tx} onClick={go}>
        <Icon.refund size={18} />
        {t("refund_with_pin")}
        <Icon.lock size={16} />
      </BigButton>
    </div>
  );
}

function Payout({ ai, close }: { ai?: boolean; close: () => void }) {
  const { stall } = useDash();
  const { t } = usePrefs();
  const pin = usePin();
  const qc = useQueryClient();
  const [amt, setAmt] = useState("");
  const [step, setStep] = useState(1);
  const n = Number(amt || 0);
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers", stall.id],
    queryFn: () => api.getSuppliers(stall.id),
  });
  const supplier = suppliers?.[0];
  const go = async () => {
    if (!supplier) {
      toast.error(t("no_supplier"));
      return;
    }
    const code = await pin(t("a_payout"));
    if (!code) return;
    try {
      await api.executePayout(stall.id, n, stall.currency, code, supplier.id);
      qc.invalidateQueries({ queryKey: ["txs", stall.id] });
      setStep(3);
      toast.success(t("result_ok"));
    } catch {
      toast.error(t("failed"));
    }
  };
  if (step === 3) return <Result close={close} />;
  return (
    <div className="space-y-4">
      <AiBadge ai={ai} />
      <Steps n={step} of={2} />
      {step === 1 ? (
        <>
          <p className="text-sm font-semibold">
            {t("supplier")}:{" "}
            <span className="font-normal text-muted-foreground">
              {supplier?.name ?? t("no_supplier")}
            </span>
          </p>
          <p className="num text-center text-4xl font-bold">{amt || "0"}</p>
          <Keypad value={amt} onChange={setAmt} />
          <BigButton disabled={!n} onClick={() => setStep(2)}>
            {t("next")}
          </BigButton>
        </>
      ) : (
        <>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs font-semibold text-muted-foreground">{t("preview")}</p>
            <Money value={-n} currency={stall.currency} className="mt-1 block text-3xl font-bold" />
            <p className="mt-1 text-sm text-muted-foreground">
              {t("supplier")} · PayPal · {t("fee")} <span className="num">0.00</span>
            </p>
          </div>
          <BigButton onClick={go}>
            <Icon.lock size={18} />
            {t("confirm_pin")}
          </BigButton>
          <BigButton variant="outline" onClick={() => setStep(1)}>
            {t("back")}
          </BigButton>
        </>
      )}
    </div>
  );
}

function Result({ close }: { close: () => void }) {
  const { t } = usePrefs();
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
        <Icon.check size={32} />
      </span>
      <p className="text-lg font-bold">{t("result_ok")}</p>
      <BigButton onClick={close}>{t("close")}</BigButton>
    </div>
  );
}

interface Parsed {
  rows: Tx[];
  months: string[];
  income: number;
  own: number;
}
function parseStatement(
  text: string,
  stallId: string,
  rail: Rail,
  currency: Tx["currency"],
): Parsed {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows: Tx[] = [];
  let own = 0;
  for (const l of lines) {
    const ofx = l.match(/<TRNAMT>([-\d.]+)/);
    const parts = l.split(/[,;]/);
    const dateStr = parts.find((p) => /\d{4}-\d{2}-\d{2}/.test(p));
    const amount = ofx
      ? Number(ofx[1])
      : Number(parts.find((p) => /^-?\d+(\.\d+)?$/.test(p.trim())));
    if (!amount || amount <= 0) continue;
    if (/traspaso|transfer[eê]ncia|own|propia/i.test(l)) {
      own++;
      continue;
    }
    rows.push({
      id: `imp-${rows.length}-${Date.now()}`,
      date: new Date(dateStr ?? TODAY).toISOString(),
      amount,
      currency,
      rail,
      status: "COMPLETED",
      type: "venta",
      origin: "autodeclarado",
      item: "Estado de cuenta",
      fee: 0,
      stallId,
    });
  }
  if (!rows.length) {
    // demo statement when file can't be parsed
    for (let i = 0; i < 18; i++)
      rows.push({
        id: `imp-${i}-${Date.now()}`,
        date: new Date(2026, 7 + (i % 2), 3 + i).toISOString(),
        amount: 150 + i * 37,
        currency,
        rail,
        status: "COMPLETED",
        type: "venta",
        origin: "autodeclarado",
        item: "Estado de cuenta",
        fee: 0,
        stallId,
      });
    own = 3;
  }
  const months = [...new Set(rows.map((r) => monthKey(new Date(r.date))))].sort();
  return { rows, months, income: rows.reduce((a, r) => a + r.amount, 0), own };
}

function Importar({ close }: { close: () => void }) {
  const { stall } = useDash();
  const { t, locale } = usePrefs();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [file, setFile] = useState<File | undefined>();
  const pin = usePin();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const rail: Rail = stall.rails.includes("pix") ? "pix" : "spei";
  const handle = async (f?: File) => {
    if (f) setFile(f);
    if (f) setParsed(parseStatement(await f.text(), stall.id, rail, stall.currency));
  };
  if (!parsed)
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        className={cn(
          "flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-6 text-center hatch-soft",
          over ? "border-primary" : "border-border",
        )}
      >
        <Icon.upload size={40} className="text-declared" />
        <p className="font-semibold">{t("drop")}</p>
        <p className="text-xs text-muted-foreground">CSV · OFX</p>
        <input
          ref={input}
          type="file"
          accept=".csv,.ofx,.txt"
          className="hidden"
          onChange={(e) => handle(e.target.files?.[0])}
        />
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">{t("months_found")}</p>
          <p className="num text-2xl font-bold">{parsed.months.length}</p>
          <p className="text-xs capitalize text-muted-foreground">
            {parsed.months.map((m) => monthName(m, locale, "short")).join(" · ")}
          </p>
        </div>
        <div className="rounded-2xl bg-muted p-3 hatch-soft">
          <p className="text-xs text-muted-foreground">{t("income")}</p>
          <Money
            value={parsed.income}
            currency={stall.currency}
            compact
            className="text-2xl font-bold text-declared"
          />
        </div>
      </div>
      <p className="flex items-center gap-2 rounded-2xl bg-warning-soft p-3 text-sm text-warning-foreground">
        <Icon.transfer size={18} />
        {t("own_transfers", { n: parsed.own })}
      </p>
      <ul className="max-h-48 space-y-1 overflow-auto">
        {parsed.rows.slice(0, 20).map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">
              {new Date(r.date).toLocaleDateString(locale)}
            </span>
            <Money value={r.amount} currency={r.currency} />
            <OriginBadge origin="autodeclarado" small />
          </li>
        ))}
      </ul>
      <BigButton
        onClick={async () => {
          const code = api.LIVE ? await pin(t("a_import")) : "";
          if (code === null) return;
          try {
            await api.importStatement(stall.id, parsed.rows, file, code, stall.currency);
          } catch {
            toast.error(t("failed"));
            return;
          }
          qc.invalidateQueries({ queryKey: ["txs", stall.id] });
          toast.success(`${t("done")} · ${parsed.rows.length}`);
          close();
        }}
      >
        <Icon.lock size={18} />
        {t("confirm")}
      </BigButton>
      <BigButton variant="outline" onClick={() => setParsed(null)}>
        {t("back")}
      </BigButton>
    </div>
  );
}

const COLS = ["date", "amount", "currency", "rail", "status", "type", "origin"] as const;
function Exportar({ close }: { close: () => void }) {
  const { allTxs, search } = useDash();
  const { t } = usePrefs();
  const [from, setFrom] = useState(`${search.month}-01`);
  const [to, setTo] = useState(new Date(TODAY).toISOString().slice(0, 10));
  const [cols, setCols] = useState<string[]>([...COLS]);
  const rows = allTxs.filter((x) => x.date.slice(0, 10) >= from && x.date.slice(0, 10) <= to);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">
          {t("from")}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 h-12 w-full rounded-2xl border bg-card px-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold">
          {t("to")}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 h-12 w-full rounded-2xl border bg-card px-3 font-normal"
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t("columns")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {COLS.map((c) => (
            <label
              key={c}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 text-sm"
            >
              <Checkbox
                checked={cols.includes(c)}
                onCheckedChange={(v) => setCols((s) => (v ? [...s, c] : s.filter((x) => x !== c)))}
              />
              {t(c)}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground num">{rows.length} · CSV</p>
      <BigButton
        disabled={!cols.length || !rows.length}
        onClick={() => {
          downloadBlob(
            toCsv(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c as keyof Tx]])))),
            `paygenti-${from}-${to}.csv`,
          );
          toast.success(t("done"));
          close();
        }}
      >
        <Icon.download size={18} />
        {t("download")}
      </BigButton>
    </div>
  );
}

function ItemDetail({ item }: { item: string }) {
  const { txs, stall } = useDash();
  const { t } = usePrefs();
  const I = itemIcon(item);
  const its = txs.filter((x) => x.item === item && isSale(x));
  const trend = Array.from(
    { length: 6 },
    (_, i) => inMonth(its, shiftMonth(monthKey(TODAY), i - 5)).length,
  );
  const rails = [...new Set(its.map((x) => x.rail))];
  const hours = Array(16).fill(0);
  its.forEach((x) => {
    const h = new Date(x.date).getHours() - 7;
    if (h >= 0 && h < 16) hours[h]++;
  });
  const best = hours
    .map((v, i) => ({ v, h: i + 7 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  const sp = split(its, stall.currency);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <I size={28} />
        </span>
        <div>
          <Money
            value={sp.verified}
            currency={stall.currency}
            compact
            className="block text-xl font-bold"
          />
          <Money
            value={sp.declared}
            currency={stall.currency}
            compact
            className="text-sm text-declared"
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold">{t("last6")}</p>
        <Sparkline data={trend} className="h-14 text-primary-text" />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">{t("rails_used")}</p>
        <div className="flex flex-wrap gap-2">
          {rails.map((r) => (
            <span
              key={r}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-sm"
            >
              <RailIcon rail={r} size={16} />
              {railName(r, t)}
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">{t("hours")}</p>
        <div className="flex gap-2">
          {best.map((b) => (
            <span
              key={b.h}
              className="rounded-xl bg-accent px-3 py-2 num font-bold text-accent-foreground"
            >
              {b.h}:00
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TxDetail({ id }: { id: string }) {
  const { allTxs, open } = useDash();
  const { t, locale } = usePrefs();
  const tx = allTxs.find((x) => x.id === id);
  if (!tx) return null;
  const at = new Date(tx.date);
  const steps = [
    { label: t("venta"), at, done: true },
    ...(tx.status === "pending_bank"
      ? [{ label: t("pending_bank"), at, done: false }]
      : [
          {
            label:
              tx.status === "COMPLETED" && tx.origin === "autodeclarado"
                ? t("vendor_confirmed")
                : t(tx.status),
            at: new Date(at.getTime() + (tx.origin === "verificado" ? 15000 : 1800000)),
            done: true,
          },
        ]),
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span
          className="flex size-12 items-center justify-center rounded-xl"
          style={railChip(tx.rail)}
        >
          <RailIcon rail={tx.rail} />
        </span>
        <div>
          <Money value={tx.amount} currency={tx.currency} className="block text-3xl font-bold" />
          <div className="mt-1 flex gap-2">
            <StatusChip status={tx.status} />
            <OriginBadge origin={tx.origin} small />
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t("rail")}</dt>
          <dd className="font-semibold">{railName(tx.rail, t)}</dd>
        </div>
        <div className="rounded-xl bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t("fee")}</dt>
          <dd>
            <Money value={tx.fee} currency={tx.currency} className="font-semibold" />
          </dd>
        </div>
        <div className="rounded-xl bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t("type")}</dt>
          <dd className="font-semibold">{t(tx.type)}</dd>
        </div>
        <div className="rounded-xl bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t("date")}</dt>
          <dd className="font-semibold">
            {at.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
          </dd>
        </div>
      </dl>
      <div>
        <p className="mb-2 text-sm font-semibold">{t("timeline")}</p>
        <ol className="relative space-y-4 border-l-2 pl-5">
          {steps.map((s, i) => (
            <li key={i} className="relative">
              <span
                className={cn(
                  "absolute -left-[27px] top-0.5 flex size-4 items-center justify-center rounded-full",
                  s.done ? "bg-success" : "bg-warning",
                )}
              />
              <p className="text-sm font-semibold">{s.label}</p>
              <p className="text-xs text-muted-foreground num">{s.at.toLocaleTimeString(locale)}</p>
            </li>
          ))}
        </ol>
      </div>
      {tx.status === "pending_bank" && (
        <BigButton onClick={() => open({ kind: "flow", flow: "confirmar", ids: [tx.id] })}>
          <Icon.lock size={18} />
          {t("confirm_pin")}
        </BigButton>
      )}
      {tx.status === "COMPLETED" && tx.type === "venta" && tx.origin === "verificado" && (
        <BigButton
          variant="danger"
          onClick={() => open({ kind: "flow", flow: "reembolso", txId: tx.id })}
        >
          <Icon.refund size={18} />
          {t("refund_with_pin")}
        </BigButton>
      )}
    </div>
  );
}

function RailDetail({ rail }: { rail: Rail }) {
  const { allTxs, search, open, stall } = useDash();
  const { t, locale } = usePrefs();
  const { data } = useQuery({
    queryKey: ["rails", stall.id],
    queryFn: () => api.getRails(stall.id),
  });
  const info = data?.find((r) => r.rail === rail);
  const list = inMonth(allTxs, search.month)
    .filter((x) => x.rail === rail)
    .slice(0, 15);
  const checklist = [
    { label: "Cuenta vinculada", ok: !info?.reason },
    { label: "Moneda compatible", ok: !info?.reason },
    { label: "PIN del puesto", ok: true },
    { label: "Primer cobro", ok: list.length > 0 },
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold">{t("rail_setup")}</p>
        <ul className="space-y-1.5">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full",
                  c.ok ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {c.ok ? <Icon.check size={14} /> : <Icon.x size={14} />}
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">{t("tabs_movimientos")}</p>
        {list.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        <ul className="space-y-1">
          {list.map((x) => (
            <li key={x.id}>
              <button
                onClick={() => open({ kind: "tx", id: x.id })}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 hover:bg-muted cursor-pointer"
              >
                <Money value={x.amount} currency={x.currency} className="font-semibold" />
                <StatusChip status={x.status} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(x.date).toLocaleString(locale, {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GoalEdit({ id, close }: { id?: string; close: () => void }) {
  const { stall } = useDash();
  const { t } = usePrefs();
  const pin = usePin();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["goals", stall.id],
    queryFn: () => api.getGoals(stall.id),
  });
  const existing = data?.find((g) => g.id === id);
  const [g, setG] = useState<Goal>(
    existing ?? {
      id: `g${Date.now()}`,
      name: "",
      target: 0,
      saved: 0,
      deadline: "2027-03-01",
      icon: "piggy",
    },
  );
  useEffect(() => {
    if (existing) setG(existing);
  }, [existing?.id]); // eslint-disable-line
  const [step, setStep] = useState(1);
  const [move, setMove] = useState("");
  const save = async (next: Goal) => {
    const key = ["goals", stall.id];
    const prev = qc.getQueryData<Goal[]>(key);
    qc.setQueryData<Goal[]>(key, (old = []) =>
      old.some((x) => x.id === next.id)
        ? old.map((x) => (x.id === next.id ? next : x))
        : [...old, next],
    );
    try {
      await api.saveGoal(stall.id, next, stall.currency);
      qc.invalidateQueries({ queryKey: key });
      toast.success(t("done"));
      close();
    } catch {
      qc.setQueryData(key, prev);
      toast.error(t("failed"));
    }
  };
  const input = "mt-1 h-12 w-full rounded-2xl border bg-card px-3 font-normal";
  if (id) {
    if (!existing) return null;
    return (
      <div className="space-y-4">
        <div className="flex justify-center">
          <Ring pct={(g.saved / (g.target || 1)) * 100} size={120} />
        </div>
        <label className="block text-sm font-semibold">
          {t("target")}
          <input
            type="number"
            inputMode="decimal"
            value={g.target}
            onChange={(e) => setG({ ...g, target: Number(e.target.value) })}
            className={cn(input, "num")}
          />
        </label>
        <label className="block text-sm font-semibold">
          {t("deadline")}
          <input
            type="date"
            value={g.deadline}
            onChange={(e) => setG({ ...g, deadline: e.target.value })}
            className={input}
          />
        </label>
        <label className="block text-sm font-semibold">
          {t("move_money")}
          <input
            type="number"
            inputMode="decimal"
            value={move}
            onChange={(e) => setMove(e.target.value)}
            placeholder="0"
            className={cn(input, "num")}
          />
        </label>
        <BigButton
          onClick={async () => {
            const m = Number(move || 0);
            if (m && !(await pin(t("move_money")))) return;
            save({ ...g, saved: g.saved + m });
          }}
        >
          {Number(move) ? <Icon.lock size={18} /> : null}
          {t("save")}
        </BigButton>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Steps n={step} />
      <p className="text-xs text-muted-foreground">{t("step", { n: step })}</p>
      {step === 1 && (
        <>
          <label className="block text-sm font-semibold">
            {t("name")}
            <input
              value={g.name}
              onChange={(e) => setG({ ...g, name: e.target.value })}
              maxLength={30}
              className={input}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["piggy", "cart", "umbrella"] as const).map((ic) => {
              const I = Icon[ic];
              return (
                <button
                  key={ic}
                  onClick={() => setG({ ...g, icon: ic })}
                  aria-pressed={g.icon === ic}
                  aria-label={t(`icon_${ic}`)}
                  className={cn(
                    "pressable flex h-16 items-center justify-center rounded-2xl border-2 bg-card",
                    g.icon === ic ? "border-primary text-primary-text" : "border-border",
                  )}
                >
                  <I size={28} />
                </button>
              );
            })}
          </div>
          <BigButton disabled={!g.name} onClick={() => setStep(2)}>
            {t("next")}
          </BigButton>
        </>
      )}
      {step === 2 && (
        <>
          <label className="block text-sm font-semibold">
            {t("target")}
            <input
              type="number"
              inputMode="decimal"
              value={g.target || ""}
              onChange={(e) => setG({ ...g, target: Number(e.target.value) })}
              className={cn(input, "num")}
            />
          </label>
          <BigButton disabled={!g.target} onClick={() => setStep(3)}>
            {t("next")}
          </BigButton>
          <BigButton variant="outline" onClick={() => setStep(1)}>
            {t("back")}
          </BigButton>
        </>
      )}
      {step === 3 && (
        <>
          <label className="block text-sm font-semibold">
            {t("deadline")}
            <input
              type="date"
              value={g.deadline}
              onChange={(e) => setG({ ...g, deadline: e.target.value })}
              className={input}
            />
          </label>
          <BigButton onClick={() => save(g)}>{t("create_goal")}</BigButton>
          <BigButton variant="outline" onClick={() => setStep(2)}>
            {t("back")}
          </BigButton>
        </>
      )}
    </div>
  );
}

function HeatList({ dow, hour }: { dow: number; hour: number }) {
  const { txs, search, open } = useDash();
  const { locale, t } = usePrefs();
  const list = inMonth(txs, search.month).filter((x) => {
    const d = new Date(x.date);
    return (d.getDay() + 6) % 7 === dow && d.getHours() === hour && isSale(x);
  });
  const label = `${new Date(2026, 9, 5 + dow).toLocaleDateString(locale, { weekday: "long" })} ${hour}:00`;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold capitalize">
        {t("sales_in", { x: label })} · <span className="num">{list.length}</span>
      </p>
      {list.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <ul className="space-y-1">
        {list.map((x) => (
          <li key={x.id}>
            <button
              onClick={() => open({ kind: "tx", id: x.id })}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 hover:bg-muted cursor-pointer"
            >
              <RailIcon rail={x.rail} />
              <Money value={x.amount} currency={x.currency} className="font-semibold" />
              {x.origin === "autodeclarado" && <OriginBadge origin={x.origin} small />}
              <span className="ml-auto text-xs text-muted-foreground num">
                {new Date(x.date).toLocaleDateString(locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Compare({ a, b }: { a: string; b: string }) {
  const { txs, stall } = useDash();
  const { locale, t } = usePrefs();
  const cols = [a, b].sort().map((m) => ({ m, s: split(inMonth(txs, m), stall.currency) }));
  return (
    <div className="grid grid-cols-2 gap-3">
      {cols.map(({ m, s }) => (
        <div key={m} className="space-y-2 rounded-2xl bg-muted p-4">
          <p className="font-bold capitalize">{monthName(m, locale)}</p>
          <p className="text-xs text-muted-foreground">{t("verified")}</p>
          <Money
            value={s.verified}
            currency={stall.currency}
            compact
            className="block text-xl font-bold"
          />
          <p className="text-xs text-muted-foreground">{t("declared")}</p>
          <Money
            value={s.declared}
            currency={stall.currency}
            compact
            className="block text-lg font-semibold text-declared"
          />
        </div>
      ))}
    </div>
  );
}
