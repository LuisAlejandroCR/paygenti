// e2e/backoffice.spec.ts: back office — PIN login wrong/right, refund within the cap and refused
// over it, invoice QR, and the daily ledger showing a paid sale with a working CSV export.
import { readFile } from "node:fs/promises";
import { apiSale, expect, expectNoOverflow, login, test } from "./fixtures";

test("wrong PIN is refused, right PIN enters", async ({ page, tx }) => {
  await login(page, tx, "0000");
  await expect(page.getByText(tx.pinWrong)).toBeVisible();
  await page.locator('input[type="password"]').fill("1234");
  await page.getByRole("button", { name: tx.enter }).click();
  await expect(page.getByRole("link", { name: tx.ledger })).toBeVisible();
  await expectNoOverflow(page);
});

test("header keeps the title and the ledger link on one line each", async ({ page, tx }) => {
  await login(page, tx);
  const link = page.getByRole("link", { name: tx.ledger });
  await expect(link).toBeVisible();
  const title = page.locator("header.bar h1");
  const height = async (el: typeof link) =>
    el.evaluate((e) => {
      const lh = Number.parseFloat(getComputedStyle(e).lineHeight) || e.clientHeight;
      return e.getBoundingClientRect().height / lh;
    });
  expect(await height(title)).toBeLessThan(1.6);
  expect(await link.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("nowrap");
  await expectNoOverflow(page);
});

test("refund within the cap with PIN, refused over the cap", async ({ page, request, tx }) => {
  await apiSale(request, 5000);
  await login(page, tx);
  const form = page.locator("form.panel").filter({ has: page.locator('input[type="password"]') });
  const refundOnce = async (amount: string) => {
    await page.getByRole("button", { name: tx.refund, exact: true }).first().click();
    await form.locator('input[inputmode="decimal"]').fill(amount);
    await form.locator('input[type="password"]').fill("1234");
    await form.getByRole("button", { name: tx.refund, exact: true }).click();
  };
  await refundOnce("1");
  await expect(page.getByRole("status").filter({ hasText: tx.refundOk })).toBeVisible();
  await refundOnce("250");
  await expect(page.getByRole("alert").filter({ hasText: tx.overCap })).toBeVisible();
  await expectNoOverflow(page);
});

test("invoice shows a QR", async ({ page, tx }) => {
  await login(page, tx);
  const form = page.locator("form.panel").filter({ hasText: tx.createInvoice });
  await form.locator("input").nth(0).fill("120");
  await form.locator("input").nth(1).fill("Catering");
  await form.getByRole("button", { name: tx.createInvoice }).click();
  const qr = form.getByRole("img", { name: tx.invoiceQr });
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute("src")).toMatch(/^data:image\//);
  await expectNoOverflow(page);
});

test("invoice QR caption stays readable in dark mode", async ({ page, tx }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page, tx);
  const form = page.locator("form.panel").filter({ hasText: tx.createInvoice });
  await form.locator("input").nth(0).fill("75");
  await form.getByRole("button", { name: tx.createInvoice }).click();
  const caption = form.locator(".qr p");
  await expect(caption).toBeVisible();
  // The QR card is always white; its caption must be dark text, not the dark theme's light --fg.
  const [r = 255, g = 255, b = 255] = (await caption.evaluate((e) => getComputedStyle(e).color))
    .match(/\d+/g)
    ?.map(Number) ?? [255, 255, 255];
  expect(0.299 * r + 0.587 * g + 0.114 * b).toBeLessThan(110);
});

test("ledger shows a paid sale and exports CSV", async ({ page, request, tx }) => {
  const minor = 4011 + Math.floor(Math.random() * 900);
  const amount = (minor / 100).toFixed(2);
  const sale = await apiSale(request, minor);
  expect(sale.status).toBe("paid");
  await login(page, tx);
  await page.getByRole("link", { name: tx.ledger }).click();
  await expect(page).toHaveURL(/\/backoffice\/ledger$/);
  const grid = page.locator(".ledger-grid");
  await expect(grid.getByText(amount).first()).toBeVisible();
  // Refunded and Net stay on screen instead of scrolling off to the right.
  const vw = page.viewportSize()?.width ?? 0;
  for (const id of ["refunded", "net"]) {
    const box = await grid.locator(`.ag-header-cell[col-id="${id}"]`).boundingBox();
    expect(box && box.x + box.width <= vw).toBe(true);
  }
  await expectNoOverflow(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: tx.exportCsv }).click(),
  ]);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain(amount);
  expect(csv.split("\n")[0]).toMatch(/Net|Neto/);
});
