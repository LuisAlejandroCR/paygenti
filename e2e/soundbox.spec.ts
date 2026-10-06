// e2e/soundbox.spec.ts: soundbox kiosk end to end — QR when idle, open amount, PAID with the amount
// after a sale is captured from another context, spoken once and not again after a reload; layout.
import type { Page } from "@playwright/test";
import { expect, expectNoOverflow, test } from "./fixtures";

const SB = {
  en: { enable: "Tap to enable sound", paid: "PAID", open: "To pay", spoken: "Received: 42 pesos" },
  es: {
    enable: "Toca para activar el sonido",
    paid: "PAGADO",
    open: "Por pagar",
    spoken: "Recibido: 42 pesos",
  },
} as const;

/** Records what the page says instead of speaking (no voices in headless browsers). */
async function captureSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    if ("speechSynthesis" in window) {
      window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
        if (u.text) w.__spoken.push(u.text);
      };
      window.speechSynthesis.getVoices = () => [];
    }
  });
}
const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("soundbox: idle QR, open amount, PAID once, no re-announce after reload", async ({
  page,
  request,
  lang,
}) => {
  const sb = SB[lang];
  await captureSpeech(page);
  await page.goto("/soundbox?terminal=rosa-01");
  await page.getByRole("button", { name: sb.enable }).click();
  await expect(page.locator(".sb-net")).toHaveClass(/on/);
  await expect(page.locator("img.sb-qr")).toBeVisible();
  await expectNoOverflow(page);

  const res = await request.post("/api/terminals/rosa-01/sales", { data: { amount: 4200 } });
  const { sale } = (await res.json()) as { sale: { id: string; orderId: string } };
  await expect(page.getByText(sb.open, { exact: true })).toBeVisible();
  await expect(page.locator(".sb-amount")).toContainText("42.00");

  await request.post(`/api/mock/orders/${sale.orderId}/approve`, { data: { decline: false } });
  await request.post(`/api/sales/${sale.id}/capture`);
  await expect(page.getByText(sb.paid, { exact: true })).toBeVisible();
  await expect(page.locator(".sb-amount")).toContainText("42.00");
  await expect.poll(() => spoken(page)).toEqual([sb.spoken]);
  await expectNoOverflow(page);
  const stored = await page.evaluate(() => sessionStorage.getItem("paygent.soundbox.announced"));
  expect(stored).toContain(sale.id);

  await page.reload();
  await page.getByRole("button", { name: sb.enable }).click();
  await expect(page.locator(".sb-net")).toHaveClass(/on/);
  await page.waitForTimeout(500);
  expect(await spoken(page)).toEqual([]);
  await expect(page.locator("img.sb-qr")).toBeVisible();
});

test("soundbox: declined sale shows the failed state without sound", async ({ page, request }) => {
  await captureSpeech(page);
  await page.goto("/soundbox?terminal=rosa-01");
  await page.locator(".sb-overlay").click();
  await expect(page.locator(".sb-net")).toHaveClass(/on/);
  const res = await request.post("/api/terminals/rosa-01/sales", { data: { amount: 1300 } });
  const { sale } = (await res.json()) as { sale: { id: string; orderId: string } };
  await request.post(`/api/mock/orders/${sale.orderId}/approve`, { data: { decline: true } });
  await request.post(`/api/sales/${sale.id}/capture`);
  await expect(page.locator(".soundbox")).toHaveAttribute("data-state", "failed");
  expect(await spoken(page)).toEqual([]);
  await expectNoOverflow(page);
});

test("judge links to the soundbox and the app is installable", async ({ page, request }) => {
  await page.goto("/judge");
  await expect(page.locator("a.judge-soundbox")).toHaveAttribute(
    "href",
    "/soundbox?terminal=rosa-01",
  );
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await request.get("/sw.js")).ok()).toBe(true);
  expect((await request.get("/icon-192.png")).ok()).toBe(true);
});
