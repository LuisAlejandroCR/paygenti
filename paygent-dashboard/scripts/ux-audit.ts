// scripts/ux-audit.ts: Playwright UX audit of the dashboard — screenshots every tab and overlay in
// 8 modes (375/1280 × light/dark × es/en), runs axe (serious/critical), and checks overflow at 375 px,
// targets under 44 px, console errors, dialog focus trap/return and keyboard-reachable filter tiles.
//
// Needs the root `npm ci` (Playwright + @axe-core/playwright live there) and a running dashboard:
//   npm run dev -- --port 5193 --strictPort      then   npm run ux:audit
//   live: UX_BASE=http://localhost:5194 UX_LABEL=live UX_LIVE=1 npm run ux:audit
// Env: UX_BASE, UX_LABEL (output folder), UX_LIVE=1 (PIN gate + empty ledger), UX_PIN, UX_ONLY
// (substring filter on the mode name), UX_STATES=1 (live only: loading, server down, wrong PIN).
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DICTS, type Lang } from "../src/lib/i18n";

const BASE = process.env["UX_BASE"] ?? "http://localhost:5193";
const LABEL = process.env["UX_LABEL"] ?? "mock";
const LIVE = process.env["UX_LIVE"] === "1";
const PIN = process.env["UX_PIN"] ?? "1234";
const ONLY = process.env["UX_ONLY"] ?? "";
const STATES = process.env["UX_STATES"] === "1";
const OUT = join("ux-audit", LABEL);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Theme = "light" | "dark";
interface Mode {
  name: string;
  phone: boolean;
  theme: Theme;
  lang: Lang;
}
interface Shot {
  mode: string;
  name: string;
  axe: string[];
  overflow: string | null;
  small: string[];
}
interface DialogCheck {
  mode: string;
  name: string;
  focusInside: boolean;
  trapped: boolean;
  returned: boolean;
}

const shots: Shot[] = [];
const dialogs: DialogCheck[] = [];
const consoleErrors: string[] = [];
const keyboard: string[] = [];
const notes: string[] = [];

const MODES: Mode[] = [];
for (const phone of [true, false])
  for (const theme of ["light", "dark"] as const)
    for (const lang of ["es", "en"] as const)
      MODES.push({ name: `${phone ? "375" : "1280"}-${theme}-${lang}`, phone, theme, lang });

const settle = (p: Page, ms = 650) => p.waitForTimeout(ms);

async function capture(page: Page, mode: Mode, name: string, full = true) {
  await settle(page);
  const dir = join(OUT, "shots", mode.name);
  mkdirSync(dir, { recursive: true });
  const h = full ? await page.evaluate(() => document.documentElement.scrollHeight) : 0;
  const vp = page.viewportSize() ?? { width: 375, height: 812 };
  await page.screenshot({
    path: join(dir, `${name}.png`),
    fullPage: full,
    ...(full && { clip: { x: 0, y: 0, width: vp.width, height: Math.min(h, 2600) } }),
  });
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const axe = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
    );
  const overflow = mode.phone
    ? await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= w) return null;
        const off = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > w + 1 && r.width > 0;
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        return `scrollWidth ${document.documentElement.scrollWidth} > ${w}: ${off.join(", ")}`;
      })
    : null;
  const small = await page.evaluate(() => {
    const sel =
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox], [role=combobox], [tabindex]:not([tabindex="-1"])';
    const dlg = document.querySelector("[role=dialog][data-state=open], [role=alertdialog]");
    const root: ParentNode = dlg ?? document;
    return [...root.querySelectorAll<HTMLElement>(sel)]
      .filter((el) => {
        if (el.closest(".ag-root-wrapper")) return false; // AG Grid manages its own cells
        if (el.closest("[aria-hidden=true]") || el.closest("[inert]")) return false;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") return false;
        if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") return false;
        return r.width < 44 || r.height < 44;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28);
        return `${Math.round(r.width)}×${Math.round(r.height)} ${el.tagName.toLowerCase()} "${name}"`;
      });
  });
  shots.push({ mode: mode.name, name, axe, overflow, small: [...new Set(small)] });
}

/** Open a dialog by keyboard from its trigger, check focus moves in, stays in, and comes back. */
async function dialog(
  page: Page,
  mode: Mode,
  name: string,
  trigger: Locator,
  inside?: (p: Page) => Promise<void>,
) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dlg = page.locator("[role=dialog][data-state=open], [role=alertdialog]").last();
  await dlg.waitFor({ timeout: 5000 });
  await settle(page, 400);
  const inDialog = () =>
    page.evaluate(() => !!document.activeElement?.closest("[role=dialog], [role=alertdialog]"));
  const focusInside = await inDialog();
  await capture(page, mode, name, false);
  if (inside) await inside(page);
  let trapped = true;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    if (!(await inDialog())) {
      trapped = false;
      break;
    }
  }
  await page.keyboard.press("Escape");
  await page
    .locator("[role=dialog][data-state=open]")
    .first()
    .waitFor({ state: "detached", timeout: 3000 })
    .catch(() => undefined);
  await settle(page, 300);
  const returned = await trigger
    .evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
    .catch(() => false);
  dialogs.push({ mode: mode.name, name, focusInside, trapped, returned });
  // Leave nothing open for the next step.
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator("[role=dialog][data-state=open]").count())) break;
    await page.keyboard.press("Escape");
    await settle(page, 200);
  }
}

async function go(page: Page, query: string) {
  await page.goto(`${BASE}/?${query}`, { waitUntil: "networkidle" });
  await page.locator("main").waitFor();
  await settle(page, 900);
}

async function unlock(page: Page, pin: string) {
  const t = DICTS.es;
  const btn = page.getByRole("button", { name: new RegExp(`${t.unlock}|${DICTS.en.unlock}`) });
  await btn.click();
  await page.locator("[role=dialog]").waitFor();
  await page.keyboard.type(pin, { delay: 60 });
  await settle(page, 900);
}

async function runMode(browser: Browser, mode: Mode) {
  const t = DICTS[mode.lang];
  const ctx = await browser.newContext({
    viewport: mode.phone ? { width: 375, height: 812 } : { width: 1280, height: 800 },
    isMobile: mode.phone,
    hasTouch: mode.phone,
    locale: mode.lang === "es" ? "es-MX" : "en-US",
    colorScheme: mode.theme,
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(
    ([dark, lang]) => {
      try {
        if (!localStorage.getItem("paygent-prefs"))
          localStorage.setItem("paygent-prefs", JSON.stringify({ dark, lang }));
      } catch {
        /* ignore */
      }
    },
    [mode.theme === "dark", mode.lang] as const,
  );
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${mode.name}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${mode.name}: pageerror ${e.message}`));
  const step = async (label: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      notes.push(`${mode.name} ${label}: ${(e as Error).message.split("\n")[0]}`);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  };

  if (LIVE) {
    await go(page, "tab=resumen");
    await capture(page, mode, "live-locked");
    if (process.env["UX_LOCKOUT"] === "1") {
      // Locks this client on the server for minutes: run it last, then restart the server.
      await unlock(page, "0000");
      for (let i = 0; i < 5; i++) {
        await page.keyboard.type("0000", { delay: 40 });
        await settle(page, 700);
      }
      await capture(page, mode, "live-pin-locked", false);
      await ctx.close();
      return;
    }
    if (STATES) {
      await step("wrong pin", async () => {
        await unlock(page, "0000");
        await capture(page, mode, "live-pin-wrong", false);
        await page.keyboard.press("Escape");
      });
    }
    await unlock(page, PIN);
  }

  // ---- Resumen ----
  await go(page, "tab=resumen");
  await capture(page, mode, "resumen");
  await step("notifications", () =>
    dialog(page, mode, "notifications", page.getByRole("button", { name: t.notifications })),
  );
  await step("delta", () =>
    dialog(page, mode, "delta-popover", page.getByRole("button", { name: t.daybyday })),
  );
  const pill = (label: string) =>
    page.locator("main").getByRole("button", { name: label, exact: true }).first();
  await step("cobrar", () =>
    dialog(page, mode, "flow-cobrar", pill(t.a_charge), async (p) => {
      if (LIVE) return;
      for (const k of ["8", "5"]) await p.getByRole("button", { name: k, exact: true }).click();
      await capture(p, mode, "flow-cobrar-amount", false);
      await p.getByRole("button", { name: t.next }).click();
      await capture(p, mode, "flow-cobrar-rail", false);
      await p.locator("[role=dialog] .grid button").first().click();
      await capture(p, mode, "flow-cobrar-qr", false);
    }),
  );
  await step("confirmar", () => dialog(page, mode, "flow-confirmar", pill(t.a_confirm)));
  await step("reembolso", () =>
    dialog(page, mode, "flow-reembolso", pill(t.a_refund), async (p) => {
      const go = p.getByRole("button", { name: new RegExp(t.refund_with_pin) });
      if (!(await go.isEnabled().catch(() => false))) return;
      await go.click();
      await p.locator("[role=dialog]").last().waitFor();
      await capture(p, mode, "pin", false);
      await p.keyboard.type("0000", { delay: 50 });
      await settle(p, 700);
      await capture(p, mode, "pin-wrong", false);
      await p.keyboard.press("Escape");
      await settle(p, 300);
    }),
  );
  await step("payout", () =>
    dialog(page, mode, "flow-payout", pill(t.a_payout), async (p) => {
      for (const k of ["1", "5", "0"])
        await p.getByRole("button", { name: k, exact: true }).click();
      await p.getByRole("button", { name: t.next }).click();
      await capture(p, mode, "flow-payout-confirm", false);
    }),
  );
  await step("importar", () =>
    dialog(page, mode, "flow-importar", pill(t.a_import), async (p) => {
      const csv = "fecha,monto,concepto\n2026-09-03,450,deposito\n2026-09-05,120,traspaso propia\n";
      await p.locator("[role=dialog] input[type=file]").setInputFiles({
        name: "estado.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      await capture(p, mode, "flow-importar-parsed", false);
    }),
  );
  await step("exportar", () => dialog(page, mode, "flow-exportar", pill(t.a_export)));
  await step("item", async () => {
    const item = page.locator("main section").filter({ hasText: t.top_items }).getByRole("button");
    if (await item.count()) await dialog(page, mode, "item", item.first());
  });

  // ---- Ventas ----
  await go(page, "tab=ventas");
  await capture(page, mode, "ventas");
  await step("heat", async () => {
    const cell = page.locator('main button[aria-label*=":00 — "]').filter({ hasText: /\d/ });
    if (await cell.count()) await dialog(page, mode, "heat", cell.first());
  });

  // ---- Movimientos ----
  await go(page, "tab=movimientos");
  await settle(page, 900);
  await capture(page, mode, "movimientos");
  await step("kpi keyboard", async () => {
    await page.locator("body").focus();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reached = -1;
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      if (label === t.money_in) {
        reached = i + 1;
        break;
      }
    }
    if (reached < 0) {
      keyboard.push(`${mode.name}: KPI tile "${t.money_in}" not reached in 60 tabs`);
      return;
    }
    const pressed = await page.evaluate(() => document.activeElement?.getAttribute("aria-pressed"));
    await page.keyboard.press("Enter");
    await settle(page, 500);
    const url = page.url();
    keyboard.push(
      `${mode.name}: KPI tile reached after ${reached} tabs; aria-pressed=${pressed}; Enter → ${
        url.includes("filter=verificado") ? "filter applied" : "NO filter"
      }`,
    );
    await capture(page, mode, "movimientos-filtered");
  });
  await go(page, "tab=movimientos");
  await settle(page, 900);
  await step("tx", async () => {
    if (mode.phone) {
      const card = page.locator("main ul li [role=button]");
      if (await card.count()) await dialog(page, mode, "tx", card.first());
    } else {
      const row = page.locator(".ag-center-cols-container .ag-row").first();
      if (await row.count()) {
        await row.click();
        await page.locator("[role=dialog]").waitFor();
        await capture(page, mode, "tx", false);
        await page.keyboard.press("Escape");
      }
    }
  });
  if (mode.phone)
    await step("filters", () =>
      dialog(
        page,
        mode,
        "filters",
        page.getByRole("button", { name: new RegExp(`^${t.filters}`) }).first(),
      ),
    );

  // ---- Perfil ----
  await go(page, "tab=perfil&section=rieles");
  await capture(page, mode, "perfil-rieles");
  await step("rail", async () => {
    const tile = page.locator("main [role=button].tile");
    if (await tile.count()) await dialog(page, mode, "rail", tile.first());
  });
  await go(page, "tab=perfil&section=metas");
  await capture(page, mode, "perfil-metas");
  await step("goal-new", () =>
    dialog(page, mode, "goal-new", page.getByRole("button", { name: t.create_goal }).first()),
  );
  await step("goal-edit", async () => {
    const g = page.locator("main [role=button].tile").first();
    if (await g.count()) await dialog(page, mode, "goal-edit", g);
  });
  await go(page, "tab=perfil&section=prefs");
  await capture(page, mode, "perfil-prefs");

  if (LIVE && STATES) {
    // Loading: hold every API answer for a while and shoot the skeletons.
    await step("loading", async () => {
      const p2 = await ctx.newPage();
      await p2.route("**/api/**", async (r) => {
        await new Promise((res) => setTimeout(res, 4000));
        await r.continue().catch(() => undefined);
      });
      await p2.goto(`${BASE}/?tab=resumen`);
      await p2.waitForTimeout(1500);
      await capture(p2, mode, "live-loading");
      await p2.close();
    });
    // Server down: every API call fails at the network level.
    await step("server down", async () => {
      const p3 = await ctx.newPage();
      await p3.route("**/api/**", (r) => r.abort("connectionrefused"));
      await p3.goto(`${BASE}/?tab=resumen`);
      await p3.waitForTimeout(2500);
      await capture(p3, mode, "live-server-down");
      await p3.close();
    });
  }
  await ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const modes = MODES.filter((m) => m.name.includes(ONLY));
  const queue = [...modes];
  await Promise.all(
    Array.from({ length: LIVE ? 1 : 3 }, async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        const t0 = Date.now();
        await runMode(browser, m).catch((e) => notes.push(`${m.name} FAILED: ${e.message}`));
        console.log(`${m.name} done in ${Math.round((Date.now() - t0) / 1000)} s`);
      }
    }),
  );
  await browser.close();

  const axeCount = shots.reduce((a, s) => a + s.axe.length, 0);
  const overflow = shots.filter((s) => s.overflow);
  const small = shots.reduce((a, s) => a + s.small.length, 0);
  const badDialogs = dialogs.filter((d) => !d.focusInside || !d.trapped || !d.returned);
  const lines = [
    `# UX audit: ${LABEL} (${BASE})`,
    `screens ${shots.length} · axe serious/critical ${axeCount} · overflow@375 ${overflow.length} · targets<44 ${small} · console errors ${consoleErrors.length} · dialog focus issues ${badDialogs.length}/${dialogs.length}`,
    "",
    "## axe",
    ...shots.flatMap((s) => s.axe.map((a) => `- ${s.mode} ${s.name}: ${a}`)),
    "",
    "## overflow at 375",
    ...overflow.map((s) => `- ${s.mode} ${s.name}: ${s.overflow}`),
    "",
    "## small targets (grouped: digits → #, count of screens × elements)",
    ...Object.entries(
      shots
        .flatMap((s) => s.small)
        .map((x) => x.replace(/\d+(?=[^×]*"$)/g, "#").replace(/"[^"]*\$[^"]*"/, '"<money>"'))
        .reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- ${k} ×${n}`),
    "",
    "## dialogs",
    ...dialogs.map(
      (d) =>
        `- ${d.mode} ${d.name}: focusInside=${d.focusInside} trapped=${d.trapped} returned=${d.returned}`,
    ),
    "",
    "## keyboard",
    ...keyboard.map((k) => `- ${k}`),
    "",
    "## console errors",
    ...[...new Set(consoleErrors)].map((c) => `- ${c}`),
    "",
    "## notes",
    ...notes.map((n) => `- ${n}`),
  ];
  writeFileSync(join(OUT, "report.txt"), lines.join("\n"));
  writeFileSync(
    join(OUT, "report.json"),
    JSON.stringify({ shots, dialogs, consoleErrors, keyboard, notes }, null, 2),
  );
  console.log(lines.slice(0, 2).join("\n"));
}

void main();
