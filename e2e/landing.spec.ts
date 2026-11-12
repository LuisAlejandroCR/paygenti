// e2e/landing.spec.ts: the public landing page (/landing.html) — axe WCAG 2.2 AA in light and dark,
// no horizontal overflow from 320 px to desktop, every link at least 44 px tall, the hero video
// with its captions off by default, the swap to the real app recording when Rosa's video is
// missing, a poster when a video cannot load, and no autoplay under reduced motion, and the full-demo slot
// (web/public/media/demo.mp4) hidden until that file exists. The copy checks run in Spanish; a
// separate block covers the ES/EN toggle (browser-language default, switch, and persistence). Also
// the hero sale simulator (keyboard to PAID, no API calls) and the open-on-your-phone QR card.
import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoOverflow, test } from "./fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("landing language toggle", () => {
  test("follows the browser language, switches ES/EN and remembers it", async ({ page }) => {
    await page.goto("/landing.html");
    const startsEs = await page.evaluate(() => navigator.language.toLowerCase().startsWith("es"));
    const copy = {
      es: { h1: /^Cobra con PayPal/, cta: "Probar la demo", lang: /^es/ },
      en: { h1: /^Take PayPal payments/, cta: "Try the demo", lang: /^en/ },
    };
    const from = startsEs ? copy.es : copy.en;
    const to = startsEs ? copy.en : copy.es;
    const h1 = page.locator("h1");
    await expect(h1).toHaveText(from.h1);
    await expect(page.getByRole("link", { name: from.cta }).first()).toBeVisible();

    const target = page.getByRole("button", { name: startsEs ? "EN" : "ES", exact: true });
    await expect(target).toHaveAttribute("aria-pressed", "false");
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect(h1).toHaveText(to.h1);
    await expect(page.getByRole("link", { name: to.cta }).first()).toHaveAttribute(
      "href",
      "/judge",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", to.lang);

    await page.reload();
    await expect(h1).toHaveText(to.h1);
    await expect(page.getByRole("link", { name: to.cta }).first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", to.lang);
  });

  test("simulator and phone card switch language too", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("paygent.locale", "en"));
    await page.goto("/landing.html");
    const sim = page.locator("[data-sim]");
    await sim.getByRole("button", { name: "Next step" }).click();
    await expect(sim.getByText("40 MXN · Scan to pay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open it on your phone" })).toBeVisible();
    await expect(page.getByRole("img", { name: /QR code that opens/ })).toBeVisible();
  });

  test("English copy passes axe too", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("paygent.locale", "en"));
    await page.goto("/landing.html");
    await expect(page.locator("h1")).toHaveText(/^Take PayPal payments/);
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => v.id)).toEqual([]);
  });
});

test.describe("landing page", () => {
  // These checks read the Spanish copy, so pin the language whatever the project's browser locale.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("paygent.locale", "es"));
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe passes in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/landing.html");
      await page.waitForTimeout(500);
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const bad = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(bad).toEqual([]);
    });
  }

  test("no overflow at 320, 430, tablet and desktop; links are big enough", async ({ page }) => {
    for (const width of [320, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/landing.html");
      await expectNoOverflow(page);
      const small = await page.$$eval("a", (links) =>
        links
          .filter((a) => a.getBoundingClientRect().height > 0)
          .filter((a) => !a.classList.contains("lp-skip"))
          .filter((a) => a.getBoundingClientRect().height < 44)
          .map((a) => a.textContent?.trim()),
      );
      expect(small, `links under 44 px at ${width}`).toEqual([]);
    }
  });

  test("hero plays Rosa's video with captions off and the CTAs go to the demo", async ({
    page,
  }) => {
    await page.goto("/landing.html");
    const hero = page.locator("[data-hero] video");
    await expect(hero.locator("source")).toHaveAttribute("src", "/media/hero-person.mp4");
    await expect
      .poll(() => hero.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.mode))
      .not.toBe("showing");
    await expect(hero).toHaveAttribute("muted", "");
    await expect(page.getByRole("link", { name: "Probar la demo" }).first()).toHaveAttribute(
      "href",
      "/judge",
    );
  });

  test("without Rosa's video the hero shows the real charge recording", async ({ page }) => {
    await page.route("**/media/hero-person.mp4", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/landing.html");
    const hero = page.locator("[data-hero] video");
    await expect(hero.locator("source")).toHaveAttribute("src", "/media/app-charge.mp4");
    await expect(hero).toHaveAttribute("poster", "/media/app-charge.jpg");
    await expect(page.locator("[data-caption]")).toContainText("Grabación real");
  });

  test("the full-demo slot stays hidden without demo.mp4 and appears when it exists", async ({
    page,
  }) => {
    await page.route("**/media/demo.mp4", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/landing.html");
    await page.waitForTimeout(300);
    await expect(page.locator("#demo")).toBeHidden();
    await page.unroute("**/media/demo.mp4");
    await page.route("**/media/demo.mp4", (r) =>
      r.fulfill({ status: 200, contentType: "video/mp4", body: "" }),
    );
    await page.reload();
    await expect(page.locator("#demo")).toBeVisible();
    await expect(page.locator("#demo video source")).toHaveAttribute("src", "/media/demo.mp4");
  });

  test("a product video that cannot load shows its poster and a note", async ({ page }) => {
    await page.route("**/media/app-checkout.mp4", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/landing.html");
    const shot = page.locator(".lp-shot", { has: page.locator("#cap-checkout") });
    await shot.scrollIntoViewIfNeeded();
    await expect(shot.locator("img.lp-poster")).toBeVisible();
    await expect(shot.getByText("El video no se pudo cargar.")).toBeVisible();
  });

  test("paid moment: real voice box clip loops muted with a poster", async ({ page }) => {
    await page.goto("/landing.html");
    const v = page.locator("#pagado video");
    for (const a of ["autoplay", "muted", "loop", "playsinline"])
      await expect(v).toHaveAttribute(a, "");
    await expect(v).toHaveAttribute("poster", "/media/voicebox-paid.jpg");
    await expect(v.locator("source")).toHaveAttribute("src", "/media/voicebox-paid.mp4");
    const res = await page.request.get("/media/voicebox-paid.mp4");
    expect(res.ok()).toBe(true);
    expect((await res.body()).length).toBeLessThan(4 * 1024 * 1024);
  });

  test("Rosa's second take: muted loop with captions off and a real file", async ({ page }) => {
    await page.goto("/landing.html");
    const v = page.locator(".lp-rosa2 video");
    for (const a of ["autoplay", "muted", "loop", "playsinline"])
      await expect(v).toHaveAttribute(a, "");
    await expect(v).toHaveAttribute("poster", "/media/rosa-2.jpg");
    await expect
      .poll(() => v.evaluate((el: HTMLVideoElement) => el.textTracks[0]?.mode))
      .not.toBe("showing");
    const res = await page.request.get("/media/rosa-2.mp4");
    expect(res.ok()).toBe(true);
    expect((await res.body()).length).toBeLessThan(4 * 1024 * 1024);
  });

  test("reduced motion: nothing plays on its own", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing.html");
    await page.waitForTimeout(800);
    const playing = await page.$$eval(
      "video",
      (vs) => vs.filter((v) => !(v as HTMLVideoElement).paused).length,
    );
    expect(playing).toBe(0);
  });

  test("sale simulator steps by keyboard to the paid screen, labelled as a simulation", async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) calls.push(r.url());
    });
    await page.goto("/landing.html");
    const sim = page.locator("[data-sim]");
    await expect(sim.getByText("Simulación")).toBeVisible();
    await expect(sim.getByText("Te escucho…")).toBeVisible();
    const next = sim.getByRole("button", { name: "Siguiente paso" });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(sim.getByText("40 MXN · Escanea para pagar")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(sim.getByText("Esperando pago…")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(sim.getByText("¡Pagado! 40 MXN")).toBeVisible();
    await expect(sim.locator('[aria-current="step"]')).toHaveAttribute("data-sim-dot", "4");
    await expect(sim.getByRole("button", { name: "Otra vez" })).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("sale simulator can play itself, but not under reduced motion", async ({ page }) => {
    await page.goto("/landing.html");
    const sim = page.locator("[data-sim]");
    await sim.getByRole("button", { name: "Reproducir solo" }).click();
    await expect(sim.getByText("¡Pagado! 40 MXN")).toBeVisible({ timeout: 10_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(sim.getByRole("button", { name: "Reproducir solo" })).toBeHidden();
    await expect(sim.getByRole("button", { name: "Siguiente paso" })).toBeVisible();
  });

  test("open-it-on-your-phone card has a QR and a link to /judge", async ({ page }) => {
    await page.goto("/landing.html");
    const card = page.locator("[data-phone-card]");
    await expect(card.getByRole("heading", { name: "Ábrelo en tu teléfono" })).toBeVisible();
    await expect(card.getByRole("img")).toHaveAttribute("src", "/qr-judge.svg");
    await expect(card.getByRole("link")).toHaveAttribute(
      "href",
      "https://paygenti.vercel.app/judge",
    );
    const res = await page.request.get("/qr-judge.svg");
    expect(res.ok()).toBe(true);
  });

  test("keyboard: skip link is first and moves focus to the content", async ({ page }) => {
    await page.goto("/landing.html");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#contenido$/);
  });
});
