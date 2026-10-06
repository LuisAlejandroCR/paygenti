// e2e/lockout.spec.ts: five wrong PINs lock the back office; even the right PIN is then refused.
// Runs as its own project after every other one, because the lock lasts five minutes.
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
