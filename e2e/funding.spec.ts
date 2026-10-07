// e2e/funding.spec.ts: the checkout's funding-source list follows the sale's currency — read from
// the `data-funding` debug attribute on /pay/:saleId, never from PayPal's own buttons. MXN (Rosa's
// default) excludes Venmo and Pay Later; after switching the vendor to USD, Venmo and Pay Later are
// candidates. Mock mode keeps its two buttons. Restores Rosa (MX, MXN) afterwards.
import type { APIRequestContext } from "@playwright/test";
import { expect, expectNoOverflow, test } from "./fixtures";

const ROSA = { displayName: "Rosa — Tamales y atole", country: "MX", currency: "MXN" };

async function setVendor(request: APIRequestContext, data: typeof ROSA) {
  const s = await request.post("/api/backoffice/session", { data: { pin: "1234" } });
  const { token } = (await s.json()) as { token: string };
  const res = await request.put("/api/backoffice/vendor", {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
}

async function openSale(request: APIRequestContext, amountMinor: number): Promise<string> {
  const res = await request.post("/api/terminals/rosa-01/sales", { data: { amount: amountMinor } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { sale: { id: string } }).sale.id;
}

test.afterEach(async ({ request }) => {
  await setVendor(request, ROSA);
  const t = await request.get("/api/terminals/rosa-01");
  const open = ((await t.json()) as { openSale: { id: string } | null }).openSale;
  if (open) await request.post(`/api/sales/${open.id}/cancel`);
});

test("MXN sale: PayPal and card only, mock buttons unchanged", async ({ page, request, tx }) => {
  const id = await openSale(request, 9500);
  await page.goto(`/pay/${id}`);
  const main = page.locator("main.checkout");
  await expect(main).toHaveAttribute("data-funding", "paypal card");
  await expect(page.getByRole("button", { name: tx.payMock })).toBeVisible();
  await expect(page.getByRole("button", { name: tx.declineMock })).toBeVisible();
  await expectNoOverflow(page);
});

test("USD sale: Venmo and Pay Later join, in order", async ({ page, request, tx }) => {
  await setVendor(request, { ...ROSA, country: "US", currency: "USD" });
  const id = await openSale(request, 1250);
  await page.goto(`/pay/${id}`);
  const main = page.locator("main.checkout");
  await expect(main.locator(".lines .total")).toHaveText("$12.50 USD");
  await expect(main).toHaveAttribute("data-funding", "paypal venmo paylater card");
  await expect(page.getByRole("button", { name: tx.payMock })).toBeVisible();
  await expectNoOverflow(page);
});
