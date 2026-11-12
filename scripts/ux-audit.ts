// scripts/ux-audit.ts: screen-by-screen UI/UX audit (npm run ux:audit) — builds the web app, starts
// the mock server on port 8792 (or targets UX_BASE_URL), drives every screen and state in 8 modes
// (375/1280 px × light/dark × en/es), saves screenshots and writes ux-shots/report.md + report.ndjson.
//
// Checks per screen and mode: axe-core (serious/critical reported), horizontal overflow, interactive
// targets under 44×44 px and console errors. Only the correct demo PIN (1234) is ever sent, so the
// audit never trips the PIN lockout; it unlocks the terminal once, as the vendor's phone does.
// Knobs: UX_BASE_URL (skip build and spawn), UX_SKIP_BUILD=1, UX_ONLY=vendor,checkout (screen id
// substrings), UX_MODES=375-light-es (mode ids), UX_OUT=ux-shots.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, process.env.UX_OUT ?? "ux-shots");
const PORT = 8792;
const BASE = (process.env.UX_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PIN = "1234";
const TERMINAL = "rosa-01";
const MIN_TARGET = 44;

/** Same env as playwright.config.ts webServer: no secrets, mock PayPal, demo PINs. */
const MOCK_ENV: Record<string, string> = {
  PORT: String(PORT),
  PUBLIC_URL: "",
  PAYPAL_CLIENT_ID: "",
  PAYPAL_CLIENT_SECRET: "",
  PAYPAL_WEBHOOK_ID: "",
  ANTHROPIC_API_KEY: "",
  STT_API_KEY: "",
  STT_MOCK_TRANSCRIPT: "dos de mole y uno de rajas",
  VENDOR_PIN: "",
  DATABASE_URL: "",
};

// ---------- Modes ----------
interface Mode {
  id: string;
  width: number;
  height: number;
  scheme: "light" | "dark";
  locale: "en-US" | "es-MX";
}
const MODES: Mode[] = [];
for (const [width, height] of [
  [375, 812],
  [1280, 800],
] as const)
  for (const scheme of ["light", "dark"] as const)
    for (const locale of ["en-US", "es-MX"] as const)
      MODES.push({ id: `${width}-${scheme}-${locale.slice(0, 2)}`, width, height, scheme, locale });

// ---------- Server lifecycle ----------
let server: ChildProcess | undefined;

function stopServer() {
  if (!server || server.exitCode !== null || server.pid === undefined) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
  server = undefined;
}
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopServer();
    process.exit(130);
  });

async function waitHealthy(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await fetch(`${BASE}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${BASE} did not become healthy`);
}

async function startServer() {
  if (process.env.UX_BASE_URL) return waitHealthy(10_000);
  if (process.env.UX_SKIP_BUILD !== "1") {
    console.log("building web app…");
    const b = spawnSync("npm", ["run", "build"], { cwd: ROOT, shell: true, stdio: "inherit" });
    if (b.status !== 0) throw new Error("npm run build failed");
  }
  console.log(`starting mock server on :${PORT}…`);
  // One node process (tsx as a loader, not its CLI wrapper) so stopping it frees the port.
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...MOCK_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line && !/not set|not in use|demo PIN/.test(line)) console.error(`[server] ${line}`);
  });
  await waitHealthy();
}

// ---------- API helpers (Node side) ----------
interface SaleRef {
  id: string;
  orderId: string;
}

async function api<T>(path: string, init?: { method?: string; body?: unknown; token?: string }) {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init?.body !== undefined && { "Content-Type": "application/json" }),
      ...(init?.token && { Authorization: `Bearer ${init.token}` }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/** This run's charge token (POST /api/terminals/:id/unlock with the demo PIN), like the vendor's phone. */
let deviceToken = "";
async function unlockDevice() {
  const { token } = await api<{ token: string }>(`/api/terminals/${TERMINAL}/unlock`, {
    body: { pin: PIN },
  });
  deviceToken = token;
}

async function cancelOpen() {
  const d = await api<{ openSale: { id: string } | null }>(`/api/terminals/${TERMINAL}`);
  if (d.openSale)
    await api(`/api/sales/${d.openSale.id}/cancel`, { body: {}, token: deviceToken }).catch(
      () => {},
    );
}

let skus: string[] = [];
async function createSale(cart = true): Promise<SaleRef> {
  await cancelOpen();
  const body =
    cart && skus.length >= 2
      ? {
          lines: [
            { sku: skus[0], qty: 2 },
            { sku: skus[1], qty: 1 },
          ],
        }
      : { amount: 4500 };
  const { sale } = await api<{ sale: SaleRef }>(`/api/terminals/${TERMINAL}/sales`, {
    body,
    token: deviceToken,
  });
  return sale;
}

async function settle(sale: SaleRef, decline = false) {
  await api(`/api/mock/orders/${sale.orderId}/approve`, { body: { decline } });
  await api(`/api/sales/${sale.id}/capture`, { body: {} }).catch(() => {});
}

interface Seed {
  token: string;
  passportHash: string;
}

/** Sales, a supplier, a payout and a signed passport so the back office has real content. */
async function seed(): Promise<Seed> {
  const { vendor } = await api<{ vendor: { catalog: { sku: string }[] } }>(
    `/api/terminals/${TERMINAL}`,
  );
  skus = vendor.catalog.map((c) => c.sku);
  await unlockDevice();
  await settle(await createSale(true));
  await settle(await createSale(false));
  const { token } = await api<{ token: string }>("/api/backoffice/session", {
    body: { pin: PIN },
  });
  const { suppliers } = await api<{ suppliers: { id: string; name: string }[] }>(
    "/api/backoffice/suppliers",
    { token },
  );
  let supplier = suppliers.find((s) => s.name === "Masa Don Pepe");
  if (!supplier) {
    const r = await api<{ supplier: { id: string; name: string } }>("/api/backoffice/suppliers", {
      token,
      body: {
        name: "Masa Don Pepe",
        recipientType: "EMAIL",
        receiver: "masa@example.com",
        pin: PIN,
      },
    });
    supplier = r.supplier;
    await api("/api/backoffice/payouts", {
      token,
      body: {
        supplierId: supplier.id,
        amountMinor: 15000,
        note: "Masa del lunes",
        pin: PIN,
        requestId: randomUUID(),
      },
    }).catch((e: Error) => console.warn(`seed payout: ${e.message}`));
  }
  const passport = await api<{ verifyUrl: string }>("/api/backoffice/passport", {
    token,
    body: {},
  });
  return { token, passportHash: passport.verifyUrl.slice(passport.verifyUrl.indexOf("#") + 1) };
}

// ---------- Screens ----------
interface Ctx {
  page: Page;
  seed: Seed;
  mode: Mode;
}
interface Screen {
  id: string;
  /** Console errors here are part of the scenario (forced 500, unknown terminal). */
  expectErrors?: boolean;
  run: (c: Ctx) => Promise<void>;
}

const online = (page: Page) => page.locator(".status.on").first().waitFor({ timeout: 10_000 });
const go = (page: Page, path: string) => page.goto(`${BASE}${path}`);
const withToken = (page: Page, token: string) =>
  page.addInitScript((tk: string) => sessionStorage.setItem("paygent.bo.token", tk), token);

/** Rewrites GET /api/terminals/rosa-01 so first-run and review states can be audited. */
async function patchTerminal(page: Page, patch: Record<string, unknown>) {
  await page.route(`**/api/terminals/${TERMINAL}`, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { vendor: Record<string, unknown> };
    json.vendor = { ...json.vendor, ...patch };
    await route.fulfill({ response: res, json });
  });
}

const SCREENS: Screen[] = [
  {
    id: "vendor-entry",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, "/");
      await online(page);
    },
  },
  {
    id: "vendor-cart",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, "/");
      await online(page);
      const chips = page.locator(".chip");
      await chips.nth(0).click();
      await chips.nth(0).click();
      await chips.nth(1).click();
      await page.locator(".charge-bar").waitFor();
    },
  },
  {
    id: "vendor-waiting",
    run: async ({ page }) => {
      await createSale();
      await go(page, "/");
      await page.locator(".waiting").waitFor();
    },
  },
  {
    id: "vendor-paid",
    run: async ({ page }) => {
      const sale = await createSale();
      await go(page, "/");
      await page.locator(".waiting").waitFor();
      await online(page);
      await settle(sale);
      await page.locator(".flood").waitFor();
    },
  },
  {
    id: "vendor-declined",
    run: async ({ page }) => {
      const sale = await createSale();
      await go(page, "/");
      await page.locator(".waiting").waitFor();
      await online(page);
      await settle(sale, true);
      await page.locator(".result.bad").waitFor();
    },
  },
  {
    id: "vendor-error",
    expectErrors: true,
    run: async ({ page }) => {
      await cancelOpen();
      await page.route(`**/api/terminals/${TERMINAL}/sales`, (r) =>
        r.fulfill({ status: 500, json: { error: "BOOM" } }),
      );
      await go(page, "/");
      await online(page);
      await page.keyboard.press("4");
      await page.keyboard.press("5");
      await page.locator(".entry button.primary").click();
      await page.locator("p.error").waitFor();
    },
  },
  {
    id: "vendor-notfound",
    expectErrors: true,
    run: async ({ page }) => {
      await go(page, "/?terminal=nope-01");
      await page.locator(".result.bad").waitFor();
    },
  },
  {
    id: "vendor-firstrun",
    run: async ({ page }) => {
      await cancelOpen();
      await patchTerminal(page, { onboarded: false });
      await go(page, "/");
      await page.locator(".onboarding select").first().waitFor();
    },
  },
  {
    id: "vendor-review-prices",
    run: async ({ page }) => {
      await cancelOpen();
      await patchTerminal(page, { pricesNeedReview: true });
      await go(page, "/");
      await online(page);
      await page.locator(".review-prices").waitFor();
    },
  },
  {
    id: "vendor-sticker",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, "/");
      await online(page);
      await page.locator("button.link").first().click();
      await page.locator("section.sticker").waitFor();
    },
  },
  {
    id: "checkout-open",
    run: async ({ page }) => {
      const sale = await createSale();
      await go(page, `/pay/${sale.id}`);
      await page.locator(".checkout button.primary").waitFor();
    },
  },
  {
    id: "checkout-paid",
    run: async ({ page }) => {
      const sale = await createSale();
      await settle(sale);
      await go(page, `/pay/${sale.id}`);
      await page.locator(".result.paid").waitFor();
    },
  },
  {
    id: "checkout-declined",
    run: async ({ page }) => {
      const sale = await createSale();
      await settle(sale, true);
      await go(page, `/pay/${sale.id}`);
      await page.locator(".result.bad").waitFor();
    },
  },
  {
    id: "checkout-cancelled",
    run: async ({ page }) => {
      const sale = await createSale();
      await cancelOpen();
      await go(page, `/pay/${sale.id}`);
      await page.locator(".result.bad").waitFor();
    },
  },
  {
    id: "checkout-notfound",
    expectErrors: true,
    run: async ({ page }) => {
      await go(page, "/pay/00000000-0000-4000-8000-000000000000");
      await page.locator("p.error").waitFor();
    },
  },
  {
    id: "t-redirect-none",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, `/t/${TERMINAL}`);
      await page.locator("h1").waitFor();
    },
  },
  {
    id: "t-notfound",
    expectErrors: true,
    run: async ({ page }) => {
      await go(page, "/t/nope-01");
      await page.locator("h1").waitFor();
    },
  },
  {
    id: "judge-idle",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, "/judge");
      await online(page);
    },
  },
  {
    id: "judge-sale",
    run: async ({ page }) => {
      await createSale();
      await go(page, "/judge");
      await page.locator(".judge-panel .waiting").waitFor();
      await page.locator(".judge-panel .checkout button.primary").waitFor();
    },
  },
  {
    id: "soundbox-overlay",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, `/soundbox?terminal=${TERMINAL}`);
      await page.locator(".sb-overlay").waitFor();
    },
  },
  {
    id: "soundbox-idle",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, `/soundbox?terminal=${TERMINAL}`);
      await page.locator(".sb-overlay").click();
      await page.locator(".sb-net.on").waitFor();
    },
  },
  {
    id: "soundbox-open",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, `/soundbox?terminal=${TERMINAL}`);
      await page.locator(".sb-overlay").click();
      await page.locator(".sb-net.on").waitFor();
      await createSale();
      await page.locator(".sb-open").waitFor();
    },
  },
  {
    id: "soundbox-paid",
    run: async ({ page }) => {
      await cancelOpen();
      await go(page, `/soundbox?terminal=${TERMINAL}`);
      await page.locator(".sb-overlay").click();
      await page.locator(".sb-net.on").waitFor();
      const sale = await createSale();
      await page.locator(".sb-open").waitFor();
      await settle(sale);
      await page.locator(".sb-paid").waitFor();
    },
  },
  {
    id: "soundbox-notfound",
    expectErrors: true,
    run: async ({ page }) => {
      await go(page, "/soundbox?terminal=nope-01");
      await page.waitForTimeout(800);
    },
  },
  {
    id: "setup",
    run: async ({ page }) => {
      await go(page, "/setup");
      await page.locator(".onboarding select").first().waitFor();
    },
  },
  {
    id: "backoffice-login",
    run: async ({ page }) => {
      await go(page, "/backoffice");
      await page.locator('input[type="password"]').waitFor();
    },
  },
  {
    id: "backoffice",
    run: async ({ page, seed: s }) => {
      await withToken(page, s.token);
      await go(page, "/backoffice");
      await page.locator(".payouts-panel .supplier-list").waitFor();
      await page.locator(".sale-list li").first().waitFor();
    },
  },
  {
    id: "backoffice-refund",
    run: async ({ page, seed: s }) => {
      await withToken(page, s.token);
      await go(page, "/backoffice");
      await page.locator(".sale-list button.danger").first().click();
      await page.locator(".confirm-panel input[inputmode=decimal]").first().waitFor();
    },
  },
  {
    id: "backoffice-remove-supplier",
    run: async ({ page, seed: s }) => {
      await withToken(page, s.token);
      await go(page, "/backoffice");
      await page.locator(".supplier-list button").first().click();
      await page.locator(".supplier-list .confirm-panel input[type=password]").first().waitFor();
    },
  },
  {
    id: "ledger",
    run: async ({ page, seed: s }) => {
      await withToken(page, s.token);
      await go(page, "/backoffice/ledger");
      await page.locator(".ag-row").first().waitFor();
    },
  },
  {
    id: "ledger-signedout",
    run: async ({ page }) => {
      await go(page, "/backoffice/ledger");
      await page.locator("p.error").waitFor();
    },
  },
  {
    id: "owner-all",
    run: async ({ page, seed: s }) => {
      await withToken(page, s.token);
      await go(page, "/backoffice/all");
      await page.locator('[data-testid="owner-totals"]').waitFor();
      await page.locator('[data-testid="owner-stall-beto"]').waitFor();
    },
  },
  {
    id: "verify-empty",
    run: async ({ page }) => {
      await go(page, "/verify");
      await page.locator("textarea").waitFor();
    },
  },
  {
    id: "verify-valid",
    run: async ({ page, seed: s }) => {
      await go(page, `/verify#${s.passportHash}`);
      await page.locator(".verdict.valid").waitFor();
    },
  },
  {
    id: "verify-malformed",
    run: async ({ page }) => {
      await go(page, "/verify#not-a-passport");
      await page.locator(".verdict.invalid").waitFor();
    },
  },
];

// ---------- Checks ----------
interface SmallTarget {
  desc: string;
  w: number;
  h: number;
  kind: "control" | "inline-link" | "ag-grid";
}
interface Result {
  screen: string;
  mode: string;
  axe: { id: string; impact: string; help: string; targets: string[] }[];
  overflow: { scrollWidth: number; clientWidth: number; offenders: string[] } | null;
  small: SmallTarget[];
  console: string[];
  expectedConsole: boolean;
  failure?: string;
  shot: string;
}

/**
 * Runs in the page. Kept as plain JavaScript source: tsx/esbuild would wrap named helpers inside a
 * page.evaluate callback with a __name() call that does not exist in the browser.
 */
const INSPECT_SRC = String.raw`(min) => {
  const describe = (el) => {
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).join(".") : "";
    const label = el.getAttribute("aria-label") ?? el.labels?.[0]?.textContent ??
      (el.placeholder || el.textContent || "");
    const type = el.getAttribute("type");
    return el.tagName.toLowerCase() + (type ? "[type=" + type + "]" : "") + cls + ' "' +
      label.trim().replace(/\s+/g, " ").slice(0, 40) + '"';
  };
  const de = document.documentElement;
  let overflow = null;
  if (de.scrollWidth > de.clientWidth) {
    const offenders = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 1 && r.width > 0 && offenders.length < 6)
        offenders.push(describe(el) + " right=" + Math.round(r.right));
    }
    overflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders };
  }
  const small = [];
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
    '[role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.closest('[aria-hidden="true"], .sr-only')) continue;
    if (r.width >= min && r.height >= min) continue;
    const parentText = el.parentElement?.textContent?.trim().length ?? 0;
    const ownText = el.textContent?.trim().length ?? 0;
    const kind = el.closest(".ag-root-wrapper") ? "ag-grid"
      : el.tagName === "A" && cs.display === "inline" && parentText > ownText + 10 ? "inline-link"
      : "control";
    small.push({ desc: describe(el), w: Math.round(r.width), h: Math.round(r.height), kind });
  }
  return { overflow, small };
}`;

async function inspect(page: Page) {
  return (await page.evaluate(`(${INSPECT_SRC})(${MIN_TARGET})`)) as Pick<
    Result,
    "overflow" | "small"
  >;
}

async function runScreen(context: BrowserContext, screen: Screen, mode: Mode, s: Seed) {
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
  const dir = join(OUT, screen.id);
  mkdirSync(dir, { recursive: true });
  const shot = join(dir, `${mode.id}.png`);
  const result: Result = {
    screen: screen.id,
    mode: mode.id,
    axe: [],
    overflow: null,
    small: [],
    console: consoleErrors,
    expectedConsole: !!screen.expectErrors,
    shot: `${screen.id}/${mode.id}.png`,
  };
  try {
    await screen.run({ page, seed: s, mode });
    // Let entry animations and late fetches settle so colors and layout are final.
    await page.waitForTimeout(700);
    await page.evaluate(() => document.fonts?.ready);
  } catch (err) {
    result.failure = (err as Error).message.split("\n")[0]?.slice(0, 300);
  }
  try {
    await page.screenshot({ path: shot, fullPage: true });
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    result.axe = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact ?? "",
        help: v.help,
        targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 6),
      }));
    Object.assign(result, await inspect(page));
  } catch (err) {
    result.failure ??= (err as Error).message.split("\n")[0]?.slice(0, 300);
  }
  await page.close();
  return result;
}

// ---------- Report ----------
function report(results: Result[], started: number) {
  // NDJSON (one result per line): machine-readable and outside what biome formats or lints.
  writeFileSync(
    join(OUT, "report.ndjson"),
    `${results.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  const unexpected = (r: Result) =>
    r.expectedConsole ? [] : r.console.filter((c) => !/status of 4\d\d/.test(c));
  const totals = {
    runs: results.length,
    failures: results.filter((r) => r.failure).length,
    axe: results.reduce((n, r) => n + r.axe.length, 0),
    overflow375: results.filter((r) => r.overflow && r.mode.startsWith("375")).length,
    overflowAll: results.filter((r) => r.overflow).length,
    small: results.reduce((n, r) => n + r.small.filter((x) => x.kind === "control").length, 0),
    smallInline: results.reduce(
      (n, r) => n + r.small.filter((x) => x.kind === "inline-link").length,
      0,
    ),
    smallGrid: results.reduce((n, r) => n + r.small.filter((x) => x.kind === "ag-grid").length, 0),
    console: results.reduce((n, r) => n + unexpected(r).length, 0),
    consoleExpected: results.reduce((n, r) => n + r.console.length - unexpected(r).length, 0),
  };
  const screens = [...new Set(results.map((r) => r.screen))];
  const lines: string[] = [
    "<!-- ux-shots/report.md: lo genera scripts/ux-audit.ts (npm run ux:audit) y no se versiona.",
    "     Resumen de la auditoría pantalla por pantalla; las capturas están en <pantalla>/<modo>.png.",
    "     No confundir con docs/*.md: esto es salida de una corrida, se reescribe en cada auditoría. -->",
    "",
    "# UX audit report",
    "",
    `Generated ${new Date().toISOString()} against ${BASE} in ${Math.round((Date.now() - started) / 1000)} s.`,
    "",
    "| Metric | Count |",
    "| --- | --- |",
    `| Screen × mode runs | ${totals.runs} |`,
    `| Scenario failures | ${totals.failures} |`,
    `| axe serious/critical violations | ${totals.axe} |`,
    `| Horizontal overflow at 375 px | ${totals.overflow375} |`,
    `| Horizontal overflow (any width) | ${totals.overflowAll} |`,
    `| Targets < ${MIN_TARGET}×${MIN_TARGET} (controls) | ${totals.small} |`,
    `| Targets < ${MIN_TARGET}×${MIN_TARGET} (inline links, WCAG 2.5.8 exception) | ${totals.smallInline} |`,
    `| Targets < ${MIN_TARGET}×${MIN_TARGET} (inside AG Grid) | ${totals.smallGrid} |`,
    `| Console errors (unexpected) | ${totals.console} |`,
    `| Console errors (expected: handled 4xx or forced error) | ${totals.consoleExpected} |`,
    "",
    "## Per screen",
    "",
    "| Screen | Failures | axe | Overflow modes | Small controls (unique) | Console (unexpected) |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const id of screens) {
    const rs = results.filter((r) => r.screen === id);
    const smallUnique = new Set(
      rs.flatMap((r) => r.small.filter((x) => x.kind === "control").map((x) => x.desc)),
    );
    lines.push(
      `| ${id} | ${rs.filter((r) => r.failure).length} | ${rs.reduce((n, r) => n + r.axe.length, 0)} | ${
        rs
          .filter((r) => r.overflow)
          .map((r) => r.mode)
          .join(", ") || "—"
      } | ${smallUnique.size} | ${rs.reduce((n, r) => n + unexpected(r).length, 0)} |`,
    );
  }
  lines.push("", "## Details", "");
  for (const id of screens) {
    const rs = results.filter((r) => r.screen === id);
    const out: string[] = [];
    for (const r of rs) {
      if (r.failure) out.push(`- **${r.mode}** scenario failed: ${r.failure}`);
      for (const v of r.axe)
        out.push(
          `- **${r.mode}** axe \`${v.id}\` (${v.impact}): ${v.help} — ${v.targets.join("; ")}`,
        );
      if (r.overflow)
        out.push(
          `- **${r.mode}** overflow ${r.overflow.scrollWidth} > ${r.overflow.clientWidth}: ${r.overflow.offenders.join("; ")}`,
        );
      for (const c of unexpected(r)) out.push(`- **${r.mode}** console: ${c}`);
    }
    const small = new Map<string, { kind: string; sizes: Set<string>; modes: Set<string> }>();
    for (const r of rs)
      for (const x of r.small) {
        const e = small.get(x.desc) ?? { kind: x.kind, sizes: new Set(), modes: new Set() };
        e.sizes.add(`${x.w}×${x.h}`);
        e.modes.add(r.mode);
        small.set(x.desc, e);
      }
    for (const [desc, e] of small)
      out.push(
        `- small ${e.kind}: \`${desc}\` ${[...e.sizes].join(", ")} (${e.modes.size} mode${e.modes.size === 1 ? "" : "s"})`,
      );
    if (out.length) lines.push(`### ${id}`, "", ...out, "");
  }
  writeFileSync(join(OUT, "report.md"), `${lines.join("\n")}\n`);
  return totals;
}

// ---------- Main ----------
async function main() {
  const started = Date.now();
  const only = process.env.UX_ONLY?.split(",").filter(Boolean);
  const modeFilter = process.env.UX_MODES?.split(",").filter(Boolean);
  const screens = only ? SCREENS.filter((s) => only.some((o) => s.id.includes(o))) : SCREENS;
  const modes = modeFilter ? MODES.filter((m) => modeFilter.includes(m.id)) : MODES;
  if (!only && !modeFilter) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  await startServer();
  const s = await seed();
  let browser: Browser | undefined;
  const results: Result[] = [];
  try {
    browser = await chromium.launch();
    for (const mode of modes) {
      const context = await browser.newContext({
        viewport: { width: mode.width, height: mode.height },
        colorScheme: mode.scheme,
        locale: mode.locale,
        reducedMotion: "reduce",
        ...(mode.width < 768 && { isMobile: true, hasTouch: true }),
      });
      // The vendor screens open already unlocked, as on a phone that entered the stall PIN once.
      await context.addInitScript(
        ([key, tk]: string[]) => localStorage.setItem(key, tk),
        [`paygent.device.${TERMINAL}`, deviceToken],
      );
      for (const screen of screens) {
        const r = await runScreen(context, screen, mode, s);
        results.push(r);
        const flags = [
          r.failure && `FAIL ${r.failure}`,
          r.axe.length && `axe ${r.axe.length}`,
          r.overflow && "overflow",
          r.small.length && `small ${r.small.length}`,
        ].filter(Boolean);
        console.log(`${mode.id.padEnd(14)} ${screen.id.padEnd(28)} ${flags.join(" · ") || "ok"}`);
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    await cancelOpen().catch(() => {});
    stopServer();
  }
  const totals = report(results, started);
  console.log(`\nreport: ${join(OUT, "report.md")}`);
  console.log(JSON.stringify(totals));
}

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
