// web/src/soundbox.tsx: /soundbox?terminal=rosa-01 — full-screen kiosk for an old phone on the counter.
// Shows the terminal QR when idle, the open amount, then a big PAID and says it out loud, but only for
// a server-confirmed capture (a fake screenshot makes no sound). Wake Lock, fullscreen, SSE backoff.
import { useEffect, useRef, useState } from "preact/hooks";
import { formatMoney } from "../../shared/money";
import type { Sale, TerminalEvent } from "../../shared/types";
import { announcePaid, unlockAudio } from "./announce";
import { useT } from "./i18n";
import { LangToggle } from "./lang-toggle";
import {
  AnnouncedSales,
  applyEvent,
  backoffMs,
  type SoundboxView,
  sessionStore,
} from "./soundbox-logic";

const EVENTS = ["sale.open", "sale.paid", "sale.failed", "sale.expired", "sale.refunded"] as const;

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
type WakeNavigator = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};

export function SoundboxApp({ terminal }: { terminal: string }) {
  const { t } = useT();
  const [view, setView] = useState<SoundboxView>({ kind: "idle" });
  const [online, setOnline] = useState(false);
  const [stall, setStall] = useState("");
  const [missing, setMissing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const announced = useRef(new AnnouncedSales(sessionStore()));
  const viewRef = useRef(view);
  viewRef.current = view;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Resync on every (re)connect: an open sale may have appeared while offline.
  const sync = () =>
    fetch(`/api/terminals/${terminal}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("terminal"))))
      .then((d: { vendor: { displayName: string }; openSale: Sale | null }) => {
        setStall(d.vendor.displayName);
        if (d.openSale) setView({ kind: "open", sale: d.openSale });
        else if (viewRef.current.kind === "open") setView({ kind: "idle" });
      })
      .catch(() => setMissing(true));

  useEffect(() => {
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      es = new EventSource(`/api/terminals/${terminal}/events`);
      es.onopen = () => {
        attempt = 0;
        setOnline(true);
        void sync();
      };
      es.onerror = () => {
        setOnline(false);
        es?.close();
        if (!stopped) timer = setTimeout(connect, backoffMs(attempt++));
      };
      for (const type of EVENTS) {
        es.addEventListener(type, (e) => {
          const event = JSON.parse((e as MessageEvent<string>).data) as TerminalEvent;
          const next = applyEvent(viewRef.current, event, announced.current);
          setView(next.view);
          if (next.announce && enabledRef.current) announcePaid(next.announce);
        });
      }
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [terminal]);

  // Keep the screen on while visible; re-acquire after the tab comes back.
  useEffect(() => {
    if (!enabled) return;
    let lock: WakeLockSentinelLike | undefined;
    const acquire = () => {
      const wl = (navigator as WakeNavigator).wakeLock;
      if (!wl || document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((l) => {
          lock = l;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);

  const enable = () => {
    unlockAudio();
    setEnabled(true);
  };
  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  if (missing) return <main class="soundbox">{t("soundbox.notFound")}</main>;

  const amount = "sale" in view ? formatMoney(view.sale.total) : "";
  return (
    <main class={`soundbox sb-${view.kind}`} data-state={view.kind}>
      <header class="sb-bar">
        <span class="sb-stall">{stall || t("soundbox.title")}</span>
        <span class={`sb-net ${online ? "on" : "off"}`} role="status">
          {online ? t("app.online") : t("soundbox.offline")}
        </span>
        <LangToggle />
        <button type="button" class="bar-btn" onClick={fullscreen}>
          {t("soundbox.fullscreen")}
        </button>
      </header>
      <section class="sb-body" aria-live="polite">
        {view.kind === "idle" && (
          <>
            <p class="sb-label">{t("soundbox.idle")}</p>
            <img
              class="sb-qr"
              src={`/api/terminals/${terminal}/qr.svg`}
              alt={t("vendor.qrAlt", { terminal })}
            />
          </>
        )}
        {view.kind !== "idle" && (
          <>
            <p class="sb-label">{t(`soundbox.${view.kind}`)}</p>
            <p class="sb-amount">{amount}</p>
          </>
        )}
        <p class="sb-trust">{t("soundbox.trust")}</p>
      </section>
      {!enabled && (
        <button type="button" class="sb-overlay" onClick={enable}>
          <strong>{t("soundbox.enable")}</strong>
          <span>{t("soundbox.enableHint")}</span>
        </button>
      )}
    </main>
  );
}
