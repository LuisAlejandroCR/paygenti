// e2e/footprint.spec.ts: financial footprint — import a bank statement with the PIN in the back
// office, see only monthly totals (no names), generate the passport and find the self-reported block
// and the disclaimer on the public verify page, then delete the imported data again; no overflow.
import { DICTIONARIES } from "../web/src/i18n";
import { apiSale, expect, expectNoOverflow, login, test } from "./fixtures";

const CSV = "Fecha;Concepto;Abono;Cargo\n01/09/2026;SPEI de LUIS GOMEZ;1.500,00;\n";

test("statement import shows up as self-reported in the signed passport", async ({
  page,
  request,
  tx,
  lang,
}) => {
  const d = DICTIONARIES[lang];
  await apiSale(request, 2100);
  await login(page, tx);
  const panel = page.locator("section.footprint-panel");
  await expect(panel.getByText(d["footprint.disclaimer"])).toBeVisible();
  const form = panel.getByRole("form", { name: d["footprint.import"] });
  await form
    .getByLabel(d["footprint.import"])
    .setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await form.getByLabel(tx.yourPin).fill("1234");
  await form.getByRole("button", { name: d["footprint.importButton"], exact: true }).click();
  await expect(panel.locator("table.statement-months")).toContainText("2026-09");
  await expect(panel).not.toContainText("GOMEZ");
  await expectNoOverflow(page);

  const passport = page.locator("form.passport-panel");
  await passport.getByRole("button", { name: tx.passportGenerate }).click();
  const link = passport.getByRole("link", { name: tx.passportOpen });
  await expect(link).toBeVisible();
  const url = new URL((await link.getAttribute("href")) ?? "");
  await page.goto(`${url.pathname}${url.hash}`);
  await expect(page.locator(".verdict")).toHaveText(tx.valid);
  const fp = page.locator("section.footprint");
  await expect(fp.getByText(d["footprint.disclaimer"])).toBeVisible();
  await expect(fp.locator('[data-provenance="self-reported, not verified"]')).toBeVisible();
  await expect(fp.locator('[data-provenance="verified"]')).toBeVisible();
  await expect(fp.locator("table.statement-months")).toContainText("2026-09");
  await expectNoOverflow(page);

  await page.goto("/backoffice");
  const again = page.locator("section.footprint-panel");
  await expect(again.locator("table.statement-months")).toBeVisible();
  await again.getByLabel(tx.yourPin).fill("1234");
  await again.getByRole("button", { name: d["footprint.delete"] }).click();
  await expect(again.getByText(d["footprint.deleted"])).toBeVisible();
  await expect(again.locator("table.statement-months")).toHaveCount(0);
});
