// web/src/main.tsx: web app entry — routes by location.pathname and mounts into #app.
// "/" is the vendor app (?terminal=rosa-01 by default); "/pay/:saleId" is the customer checkout;
// "/backoffice" is the vendor's back office.
import { render } from "preact";
import { BackOfficeApp } from "./backoffice";
import { Checkout } from "./checkout";
import "./styles.css";
import { VendorApp } from "./vendor";

function App() {
  if (/^\/backoffice\/?$/.test(location.pathname)) return <BackOfficeApp />;
  const pay = /^\/pay\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (pay?.[1]) return <Checkout saleId={pay[1]} />;
  const terminal = new URLSearchParams(location.search).get("terminal") ?? "rosa-01";
  return <VendorApp terminal={terminal} />;
}

const root = document.getElementById("app");
if (root) render(<App />, root);
