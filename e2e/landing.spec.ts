// e2e/landing.spec.ts: the public landing page (/landing.html) — axe WCAG 2.2 AA in light and dark,
// no horizontal overflow from 320 px to desktop, every link at least 44 px tall, the hero video
// with its captions off by default, the swap to the real app recording when Rosa's video is
// missing, a poster when a video cannot load, and no autoplay under reduced motion.
import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoOverflow, test } from "./fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("landing page", () => {
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

  test("a product video that cannot load shows its poster and a note", async ({ page }) => {
    await page.route("**/media/app-checkout.mp4", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/landing.html");
    const shot = page.locator(".lp-shot").nth(1);
    await shot.scrollIntoViewIfNeeded();
    await expect(shot.locator("img.lp-poster")).toBeVisible();
    await expect(shot.getByText("El video no se pudo cargar.")).toBeVisible();
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
