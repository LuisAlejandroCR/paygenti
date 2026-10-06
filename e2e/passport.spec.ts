// e2e/passport.spec.ts: sales passport — generate it in the back office after a paid mock sale,
// open the public verify link (VALID), then edit a number in the payload (INVALID); no overflow.
import { apiSale, expect, expectNoOverflow, login, test } from "./fixtures";

test("passport verifies, and a tampered number does not", async ({ page, request, tx }) => {
  await apiSale(request, 3100);
  await login(page, tx);
  const panel = page.locator("form.passport-panel");
  await panel.getByRole("button", { name: tx.passportGenerate }).click();
  const link = panel.getByRole("link", { name: tx.passportOpen });
  await expect(link).toBeVisible();
  await expect(panel.locator(".qr img")).toBeVisible();
  await expectNoOverflow(page);
  const href = (await link.getAttribute("href")) ?? "";
  expect(href).toMatch(/\/verify#[A-Za-z0-9_-]+$/);

  const url = new URL(href);
  await page.goto(`${url.pathname}${url.hash}`);
  const verdict = page.locator(".verdict");
  await expect(verdict).toHaveText(tx.valid);
  await expect(verdict).toHaveAttribute("data-valid", "true");
  await expectNoOverflow(page);

  const payload = JSON.parse(Buffer.from(url.hash.slice(1), "base64url").toString("utf8"));
  payload.report.verified.net += 100;
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");
  await page.goto("/");
  await page.goto(`/verify#${forged}`);
  await expect(verdict).toHaveText(tx.invalid);
  await expect(verdict).toHaveAttribute("data-valid", "false");
  await expectNoOverflow(page);
});
