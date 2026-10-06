// e2e/voice.spec.ts: voice cart on the vendor screen. Headless Chromium has no microphone, so a
// fake SpeechRecognition returns a fixed transcript; the server parser and cart editing are real.
// The typed order box needs no speech support at all and goes through the same parser.
import { expect, expectNoOverflow, test } from "./fixtures";

test("voice order builds an editable cart", async ({ page, tx, lang }) => {
  const said = lang === "es" ? "dos de mole y uno de rajas" : "two mole and one rajas";
  await page.addInitScript((text) => {
    class FakeRecognition {
      lang = "";
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: text }]] });
          this.onend?.();
        }, 50);
      }
      stop() {}
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  }, said);
  await page.goto("/");
  await page.getByRole("button", { name: tx.hold }).dispatchEvent("pointerdown");
  const cart = page.locator(".cart li");
  await expect(cart).toHaveCount(2);
  await expect(page.locator(".entry")).toHaveCount(0);
  const charge = page.getByRole("button", { name: tx.charge });
  await expect(charge).toHaveText(/81/); // 2 x 28 + 25 = 81 pesos
  await page.getByRole("button", { name: tx.addOne }).click();
  await expect(charge).toHaveText(/109/);
  await page.getByRole("button", { name: tx.removeOne }).click();
  await page.getByRole("button", { name: tx.removeAll }).click();
  await expect(cart).toHaveCount(1);
  await expect(charge).toHaveText(/56/);
  await expectNoOverflow(page);
  await page.getByRole("button", { name: tx.clear }).click();
  await expect(cart).toHaveCount(0);
  await expect(page.locator(".entry")).toBeVisible();
});

test("typed order builds the same cart without speech support", async ({ page, tx, lang }) => {
  const typed = lang === "es" ? "2 tamales de rajas y un atole" : "2 rajas tamales and an atole";
  await page.goto("/");
  await page.getByRole("textbox", { name: tx.typeOrder }).fill(typed);
  await page.getByRole("button", { name: tx.typeAdd, exact: true }).click();
  await expect(page.locator(".cart li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: tx.charge })).toHaveText(/70/); // 2 x 25 + 20
  await expect(page.getByRole("textbox", { name: tx.typeOrder })).toHaveValue("");
  await expectNoOverflow(page);
  await page.getByRole("button", { name: tx.clear }).click();
  await expect(page.locator(".cart li")).toHaveCount(0);
});
