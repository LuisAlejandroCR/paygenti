// e2e/a11y.spec.ts: WCAG 2.2 AA gate — runs axe-core on every web screen (and the key sale states)
// in light, dark and high-contrast; any serious or critical violation fails. Also checks 200% text,
// the "+5 min" timer button, keyboard-only charging and the voice-mode toggle.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { apiSale, expect, expectNoOverflow, login, test } from "./fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, label: string) {
  // Wait for entry animations to settle so contrast is measured on final colors.
  await page.waitForTimeout(700);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  expect(bad, `axe violations on ${label}`).toEqual([]);
}

async function cancelOpen(request: APIRequestContext) {
  await request.get("/api/terminals/rosa-01").then(async (r) => {
    const d = (await r.json()) as { openSale: { id: string } | null };
    if (d.openSale) await request.post(`/api/sales/${d.openSale.id}/cancel`);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`axe: every screen passes in ${scheme}`, async ({ page, request, tx }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await cancelOpen(request);
    await page.goto("/");
    await expect(page.getByText(tx.online)).toBeVisible();
    await audit(page, "vendor entry");

    await page.goto("/setup");
    await audit(page, "setup");
    await page.goto("/judge");
    await audit(page, "judge");
    await page.goto("/soundbox");
    await audit(page, "soundbox");
    await page.goto("/verify");
    await audit(page, "verify");

    const created = await request.post("/api/terminals/rosa-01/sales", { data: { amount: 2500 } });
    const { sale } = (await created.json()) as { sale: { id: string } };
    await page.goto(`/pay/${sale.id}`);
    await expect(page.getByRole("button", { name: tx.payMock })).toBeVisible();
    await audit(page, "checkout");
    await page.goto("/");
    await expect(page.locator(".waiting")).toBeVisible();
    await audit(page, "vendor waiting");
    await request.post(`/api/sales/${sale.id}/cancel`);

    await apiSale(request, 1800);
    await page.goto("/backoffice");
    await audit(page, "backoffice login");
    await login(page, tx);
    await expect(page.getByRole("button", { name: tx.createInvoice })).toBeVisible();
    await audit(page, "backoffice");
    await page.goto("/backoffice/ledger");
    await expect(page.getByRole("button", { name: tx.exportCsv })).toBeVisible();
    await audit(page, "ledger");
  });
}

test("axe: high-contrast theme passes", async ({ page, request }) => {
  await cancelOpen(request);
  await page.addInitScript(() => localStorage.setItem("paygent.contrast", "high"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await audit(page, "vendor high contrast");
  await page.goto("/verify");
  await audit(page, "verify high contrast");
});

test("text scales to 200% without horizontal scroll", async ({ page, request }) => {
  await cancelOpen(request);
  await page.goto("/");
  await page.addStyleTag({ content: "html{font-size:200% !important}" });
  await expectNoOverflow(page);
  await page.goto("/backoffice");
  await page.addStyleTag({ content: "html{font-size:200% !important}" });
  await expectNoOverflow(page);
});

test("keyboard only: type an amount, charge, add five minutes, cancel", async ({
  page,
  request,
}) => {
  await cancelOpen(request);
  await page.goto("/");
  await expect(page.locator(".keypad")).toBeVisible();
  await page.keyboard.press("4");
  await page.keyboard.press("2");
  await expect(page.locator("output.amount")).toContainText("42");
  await page.keyboard.press("Enter");
  const timer = page.locator(".timer span");
  await expect(timer).toBeVisible();
  const more = page.getByRole("button", { name: /\+5 min/ });
  await more.focus();
  await expect(more).toBeFocused();
  const before = await timer.textContent();
  await page.keyboard.press("Enter");
  await expect(timer).not.toHaveText(before ?? "");
  expect(Number((await timer.textContent())?.split(":")[0])).toBeGreaterThanOrEqual(8);
  await page.keyboard.press("Escape");
  await expect(page.locator(".keypad")).toBeVisible();
});

test("voice mode toggles and persists", async ({ page, request }) => {
  await cancelOpen(request);
  await page.goto("/");
  const toggle = page.locator("button.voice-mode-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("button.voice-mode-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator("button.voice-mode-toggle").click();
});
