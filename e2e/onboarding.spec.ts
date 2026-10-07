// e2e/onboarding.spec.ts: stall settings / onboarding — Colombia defaults to USD with an explanation,
// a USD charge shows the currency once on PAID, Mexico switches back to MXN. Restores Rosa (MX, MXN)
// afterwards because the suite shares one in-memory server.
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, expectNoOverflow, type Lang, test } from "./fixtures";

const ROSA = { displayName: "Rosa — Tamales y atole", country: "MX", currency: "MXN" };
const T = {
  en: {
    search: "Search country",
    pin: "PIN",
    save: "Save",
    saved: /You now charge in/,
    unsupported: /PayPal cannot charge in COP/,
  },
  es: {
    search: "Buscar país",
    pin: "PIN",
    save: "Guardar",
    saved: /Ahora cobras en/,
    unsupported: /PayPal no cobra en COP/,
  },
} as const;

async function restore(request: APIRequestContext) {
  const s = await request.post("/api/backoffice/session", { data: { pin: "1234" } });
  const { token } = (await s.json()) as { token: string };
  const res = await request.put("/api/backoffice/vendor", {
    data: ROSA,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
}

async function pickCountry(page: Page, lang: Lang, query: string, code: string) {
  const t = T[lang];
  await page.getByLabel(t.search).fill(query);
  await page.locator("form select").nth(0).selectOption(code);
}

async function save(page: Page, lang: Lang) {
  const t = T[lang];
  const pin = page.getByLabel(t.pin);
  if (await pin.isVisible()) await pin.fill("1234");
  await page.getByRole("button", { name: t.save, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: t.saved })).toBeVisible();
}

test.afterEach(async ({ request }) => restore(request));

test("Colombia defaults to USD with an explanation; PAID shows USD once", async ({
  page,
  lang,
  tx,
}) => {
  const t = T[lang];
  await page.goto("/setup?terminal=rosa-01");
  await expect(page.locator("form select").nth(1)).toBeVisible();
  await pickCountry(page, lang, "Colom", "CO");
  await expect(page.locator("form select").nth(1)).toHaveValue("USD");
  await expect(page.getByText(t.unsupported)).toBeVisible();
  await expectNoOverflow(page);
  await save(page, lang);
  await expectNoOverflow(page);

  await page.goto("/judge");
  const vendor = page.locator(".judge-panel").first();
  await expect(vendor.locator(".status")).toHaveClass(/on/);
  for (const d of "12") await vendor.getByRole("button", { name: d, exact: true }).click();
  await vendor.locator(".entry button.primary").click();
  await expect(vendor.locator(".waiting .total")).toHaveText("$12.00 USD");
  await page.locator(".judge-panel").nth(1).getByRole("button", { name: tx.payMock }).click();
  const paid = vendor.locator(".result.paid");
  await expect(paid.getByText(tx.vendorPaid, { exact: true })).toBeVisible();
  await expect(paid.locator(".paid-amount")).toHaveText("$12.00 USD");
  expect(((await paid.innerText()).match(/USD/g) ?? []).length).toBe(1);
  await vendor.getByRole("button", { name: tx.newSale }).click();
  await expectNoOverflow(page);
});

test("Mexico selects MXN", async ({ page, lang }) => {
  const t = T[lang];
  await page.goto("/setup?terminal=rosa-01");
  await expect(page.locator("form select").nth(1)).toBeVisible();
  await pickCountry(page, lang, "Colombia", "CO");
  await expect(page.locator("form select").nth(1)).toHaveValue("USD");
  await pickCountry(page, lang, "Mex", "MX");
  await expect(page.locator("form select").nth(1)).toHaveValue("MXN");
  await expect(page.getByText(t.unsupported)).toHaveCount(0);
  await save(page, lang);
  await page.goto("/?terminal=rosa-01");
  for (const d of "5") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.locator(".entry button.primary")).toContainText("$5.00 MXN");
  await expectNoOverflow(page);
});
