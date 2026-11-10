// web/src/main.tsx: web app entry — routes by location.pathname and mounts into #app.
// "/" is the vendor app (?terminal=, else the first terminal of the stall picked in the back office, else rosa-01); "/pay/:saleId" is the customer checkout;
// "/backoffice" is the vendor's back office (?stall= picks the paygent; "/backoffice/all" sums them; "/backoffice/ledger" lazy-loads the AG Grid ledger); "/verify" checks a signed sales passport; "/judge" puts vendor and customer side by side;
// "/setup" is stall settings (name, country, currency); "/soundbox" (lazy) is the counter kiosk that announces paid sales. Registers the app-shell service worker in production.
import { type ComponentType, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { applyPrefs } from "./a11y";
import { BackOfficeApp } from "./backoffice";
import { Checkout } from "./checkout";
import { JudgeApp } from "./judge";
import { Onboarding } from "./onboarding";
import { OwnerOverviewApp } from "./owner";
import { currentStall, DEFAULT_STALL } from "./stall";
import "./styles.css";
import { VendorApp } from "./vendor";
import { VerifyApp } from "./verify";

/** Loads the ledger (and AG Grid) only when /backoffice/ledger is opened. */
function LazyLedger() {
  const [Page, setPage] = useState<ComponentType | null>(null);
  useEffect(() => {
    void import("./ledger").then((m) => setPage(() => m.LedgerApp));
  }, []);
  return Page ? <Page /> : null;
}

/** Loads the soundbox kiosk only when /soundbox is opened. */
function LazySoundbox({ terminal }: { terminal: string }) {
  const [Page, setPage] = useState<ComponentType<{ terminal: string }> | null>(null);
  useEffect(() => {
    void import("./soundbox").then((m) => setPage(() => m.SoundboxApp));
  }, []);
  return Page ? <Page terminal={terminal} /> : null;
}

/** "/" without ?terminal after picking another stall in the back office: that stall's register. */
function StallRegister({ stall }: { stall: string }) {
  const [terminal, setTerminal] = useState<string>();
  useEffect(() => {
    fetch("/api/stalls")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stalls"))))
      .then((d: { stalls?: { id: string; terminals: string[] }[] }) =>
        setTerminal(d.stalls?.find((s) => s.id === stall)?.terminals[0] ?? "rosa-01"),
      )
      .catch(() => setTerminal("rosa-01"));
  }, [stall]);
  return terminal ? <VendorApp terminal={terminal} /> : null;
}

function App() {
  if (/^\/backoffice\/ledger\/?$/.test(location.pathname)) return <LazyLedger />;
  if (/^\/backoffice\/?$/.test(location.pathname)) return <BackOfficeApp />;
  if (/^\/backoffice\/all\/?$/.test(location.pathname)) return <OwnerOverviewApp />;
  if (/^\/verify\/?$/.test(location.pathname)) return <VerifyApp />;
  const pay = /^\/pay\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (pay?.[1]) return <Checkout saleId={pay[1]} />;
  const asked = new URLSearchParams(location.search).get("terminal");
  const terminal = asked ?? "rosa-01";
  if (/^\/soundbox\/?$/.test(location.pathname)) return <LazySoundbox terminal={terminal} />;
  if (/^\/judge\/?$/.test(location.pathname)) return <JudgeApp terminal={terminal} />;
  if (/^\/setup\/?$/.test(location.pathname)) return <Onboarding terminal={terminal} />;
  const stall = currentStall();
  if (!asked && stall !== DEFAULT_STALL) return <StallRegister stall={stall} />;
  return <VendorApp terminal={terminal} />;
}

applyPrefs();
const root = document.getElementById("app");
if (root) render(<App />, root);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
