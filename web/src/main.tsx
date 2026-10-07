// web/src/main.tsx: web app entry — routes by location.pathname and mounts into #app.
// "/" is the vendor app (?terminal=rosa-01 by default); "/pay/:saleId" is the customer checkout;
// "/backoffice" is the vendor's back office ("/backoffice/ledger" lazy-loads the AG Grid ledger); "/verify" checks a signed sales passport; "/judge" puts vendor and customer side by side;
// "/setup" is stall settings (name, country, currency); "/soundbox" (lazy) is the counter kiosk that announces paid sales. Registers the app-shell service worker in production.
import { type ComponentType, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { applyPrefs } from "./a11y";
import { BackOfficeApp } from "./backoffice";
import { Checkout } from "./checkout";
import { JudgeApp } from "./judge";
import { Onboarding } from "./onboarding";
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

function App() {
  if (/^\/backoffice\/ledger\/?$/.test(location.pathname)) return <LazyLedger />;
  if (/^\/backoffice\/?$/.test(location.pathname)) return <BackOfficeApp />;
  if (/^\/verify\/?$/.test(location.pathname)) return <VerifyApp />;
  const pay = /^\/pay\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (pay?.[1]) return <Checkout saleId={pay[1]} />;
  const terminal = new URLSearchParams(location.search).get("terminal") ?? "rosa-01";
  if (/^\/soundbox\/?$/.test(location.pathname)) return <LazySoundbox terminal={terminal} />;
  if (/^\/judge\/?$/.test(location.pathname)) return <JudgeApp terminal={terminal} />;
  if (/^\/setup\/?$/.test(location.pathname)) return <Onboarding terminal={terminal} />;
  return <VendorApp terminal={terminal} />;
}

applyPrefs();
const root = document.getElementById("app");
if (root) render(<App />, root);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
