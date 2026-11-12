// e2e/passkey.spec.ts: Face ID / fingerprint unlock in a real browser, with Chromium's virtual
// platform authenticator (DevTools WebAuthn domain). PIN unlock offers the passkey, enrolling works,
// and a phone that lost its token unlocks again with one tap and no PIN.
import { expect, test } from "./fixtures";

test.use({ seedDevice: false });

const TEXT = {
  en: {
    unlock: "Unlock",
    enrol: "Use Face ID / fingerprint next time",
    passkey: "Unlock with Face ID / fingerprint",
  },
  es: {
    unlock: "Desbloquear",
    enrol: "Usar Face ID / huella la próxima vez",
    passkey: "Desbloquear con Face ID / huella",
  },
} as const;

test("PIN once, then Face ID / fingerprint unlocks the charge screen", async ({ page, lang }) => {
  const t = TEXT[lang];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/?terminal=beto-01");
  await page.locator(".unlock input[type=password]").fill("5678");
  await page.getByRole("button", { name: t.unlock, exact: true }).click();
  await expect(page.locator(".keypad")).toBeVisible();
  await page.getByRole("button", { name: t.enrol }).click();
  await expect(page.getByRole("button", { name: t.enrol })).toHaveCount(0);
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);

  // The phone loses its device token (expired, or the server restarted without a secret).
  await page.evaluate(() => localStorage.removeItem("paygent.device.beto-01"));
  await page.reload();
  await expect(page.locator(".keypad")).toHaveCount(0);
  await page.getByRole("button", { name: t.passkey }).click();
  await expect(page.locator(".keypad")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("paygent.device.beto-01"))).toMatch(
    /^pgd\.beto\./,
  );
});
