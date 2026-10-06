// e2e/judge.spec.ts: judge mode end to end — keypad charge paid and declined on the mock gateway,
// the vendor header layout, and the /t/rosa-01 sticker route in each of its branches.
import type { Page } from "@playwright/test";
import { apiSale, expect, expectNoOverflow, test } from "./fixtures";

async function charge(page: Page, digits: string) {
  await page.goto("/judge");
  const vendor = page.locator(".judge-panel").first();
  await expect(vendor.locator(".status")).toHaveClass(/on/);
  for (const d of digits) await vendor.getByRole("button", { name: d, exact: true }).click();
  await vendor.locator(".entry button.primary").click();
  await expect(vendor.locator(".waiting")).toBeVisible();
  return vendor;
}

test.describe("judge flow", () => {
  test("pay: vendor sees PAID", async ({ page, tx }) => {
    const vendor = await charge(page, "42");
    await expectNoOverflow(page);
    const customer = page.locator(".judge-panel").nth(1);
    await customer.getByRole("button", { name: tx.payMock }).click();
    await expect(customer.getByText(tx.customerPaid)).toBeVisible();
    await expect(vendor.getByText(tx.vendorPaid, { exact: true })).toBeVisible();
    await vendor.getByRole("button", { name: tx.newSale }).click();
    await expectNoOverflow(page);
  });

  test("decline: vendor sees declined", async ({ page, tx }) => {
    const vendor = await charge(page, "13");
    const customer = page.locator(".judge-panel").nth(1);
    await customer.getByRole("button", { name: tx.declineMock }).click();
    await expect(customer.getByText(tx.customerDeclined, { exact: true })).toBeVisible();
    await expect(vendor.getByText(tx.vendorDeclined, { exact: true })).toBeVisible();
  });

  test("vendor header: status label does not overlap the language toggle", async ({ page, tx }) => {
    for (const path of ["/", "/judge"]) {
      await page.goto(path);
      const bar = page.locator("header.bar").first();
      const status = bar.locator(".status");
      await expect(status).toHaveText(tx.online);
      const s = await status.boundingBox();
      const l = await bar.locator(".lang-toggle").boundingBox();
      expect(s && l && s.x + s.width <= l.x).toBe(true);
      // The label fits inside its own box (it used to spill out of a 10px dot).
      expect(await status.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      await expectNoOverflow(page);
    }
  });
});

test.describe("/t/rosa-01 sticker route", () => {
  test("open sale redirects to checkout", async ({ page, request }) => {
    const res = await request.post("/api/terminals/rosa-01/sales", { data: { amount: 999 } });
    const { sale } = (await res.json()) as { sale: { id: string; orderId: string } };
    await page.goto("/t/rosa-01");
    await expect(page).toHaveURL(new RegExp(`/pay/${sale.id}$`));
    await expectNoOverflow(page);
    // Settle it so later tests start without an open sale.
    await request.post(`/api/mock/orders/${sale.orderId}/approve`, { data: { decline: true } });
    await request.post(`/api/sales/${sale.id}/capture`);
  });

  test("after a paid sale", async ({ page, request, tx }) => {
    await apiSale(request, 1500);
    await page.goto("/t/rosa-01");
    await expect(page.getByText(tx.tPaid)).toBeVisible();
    await expectNoOverflow(page);
  });

  test("after a declined sale", async ({ page, request, tx }) => {
    await apiSale(request, 1600, true);
    await page.goto("/t/rosa-01");
    await expect(page.getByText(tx.tGone)).toBeVisible();
  });

  test("unknown terminal is 404", async ({ request }) => {
    expect((await request.get("/t/nobody-99")).status()).toBe(404);
  });
});
