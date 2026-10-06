// e2e/lockout.spec.ts: five wrong PINs lock the back office; even the right PIN is then refused.
// The lock is per client: another address still gets in. Runs as its own project after every other
// one, because this browser's lock lasts five minutes.
import { expect, login, test } from "./fixtures";

test("five wrong PINs lock out the right one too", async ({ page, tx }) => {
  for (let i = 0; i < 4; i++) {
    await login(page, tx, "0000");
    await expect(page.getByText(tx.pinWrong)).toBeVisible();
  }
  await login(page, tx, "0000");
  await expect(page.getByText(tx.pinLocked)).toBeVisible();
  await login(page, tx, "1234");
  await expect(page.getByText(tx.pinLocked)).toBeVisible();
});

test("the lock is per client: another address still logs in", async ({ request }) => {
  const res = await request.post("/api/backoffice/session", {
    data: { pin: "1234" },
    headers: { "X-Forwarded-For": "198.51.100.23" },
  });
  expect(res.status()).toBe(200);
});
