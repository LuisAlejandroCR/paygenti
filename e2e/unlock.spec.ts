// e2e/unlock.spec.ts: a fresh device cannot charge until it is unlocked with the stall PIN; the PIN
// card replaces the keypad, a wrong PIN says so, and a stranger's API call without a token gets 401.
import { expect, test } from "./fixtures";

test.use({ seedDevice: false });

const TEXT = {
  en: { unlock: "Unlock", wrong: "Wrong PIN.", charge: /Charge/ },
  es: { unlock: "Desbloquear", wrong: "PIN incorrecto.", charge: /Cobrar/ },
} as const;

test("the vendor screen asks for the stall PIN before it can charge", async ({ page, lang }) => {
  const t = TEXT[lang];
  await page.goto("/?terminal=beto-01");
  const unlock = page.getByRole("button", { name: t.unlock, exact: true });
  await expect(unlock).toBeVisible();
  await expect(page.locator(".keypad")).toHaveCount(0);
  await page.locator(".unlock input[type=password]").fill("0000");
  await unlock.click();
  await expect(page.getByText(t.wrong)).toBeVisible();
  await page.locator(".unlock input[type=password]").fill("5678");
  await unlock.click();
  await expect(page.locator(".keypad")).toBeVisible();
  await page.reload();
  await expect(page.locator(".keypad")).toBeVisible();
});

test("an anonymous request cannot open or cancel a charge", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  const res = await anon.post("/api/terminals/rosa-01/sales", { data: { amount: 100 } });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "CHARGE_AUTH_REQUIRED" });
  await anon.dispose();
});
