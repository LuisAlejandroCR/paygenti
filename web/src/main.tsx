// web/src/main.tsx: web app entry — routes by location.pathname and mounts into #app.
// "/" is the vendor app (?terminal=rosa-01 by default); "/pay/:saleId" is the customer checkout;
// "/backoffice" is the vendor's back office ("/backoffice/ledger" lazy-loads the AG Grid ledger); "/judge" puts vendor and customer side by side.
import { type ComponentType, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BackOfficeApp } from "./backoffice";
import { Checkout } from "./checkout";
import { JudgeApp } from "./judge";
import "./styles.css";
import { VendorApp } from "./vendor";

/** Loads the ledger (and AG Grid) only when /backoffice/ledger is opened. */
function LazyLedger() {
  const [Page, setPage] = useState<ComponentType | null>(null);
  useEffect(() => {
    void import("./ledger").then((m) => setPage(() => m.LedgerApp));
  }, []);
  return Page ? <Page /> : null;
}

function App() {
  if (/^\/backoffice\/ledger\/?$/.test(location.pathname)) return <LazyLedger />;
  if (/^\/backoffice\/?$/.test(location.pathname)) return <BackOfficeApp />;
  const pay = /^\/pay\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (pay?.[1]) return <Checkout saleId={pay[1]} />;
  const terminal = new URLSearchParams(location.search).get("terminal") ?? "rosa-01";
  if (/^\/judge\/?$/.test(location.pathname)) return <JudgeApp terminal={terminal} />;
  return <VendorApp terminal={terminal} />;
}

const root = document.getElementById("app");
if (root) render(<App />, root);
