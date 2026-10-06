// e2e/menu.spec.ts: back-office menu editor without an API key — add an item by hand, save, and a
// typed order on the vendor screen builds a cart with the new item. Restores the catalog after.
import { expect, expectNoOverflow, login, test } from "./fixtures";

interface Item {
  names?: { en: string; es: string };
  name: string;
  price: { minor: number };
  aliases: string[];
}

test("manual catalog edit is used by the next typed order", async ({ page, request, tx, lang }) => {
  const session = await request.post("/api/backoffice/session", { data: { pin: "1234" } });
  const { token } = (await session.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const original = (
    (await (await request.get("/api/backoffice/catalog", { headers })).json()) as {
      items: Item[];
    }
  ).items;
  try {
    await login(page, tx);
    const panel = page.locator("form.menu-panel");
    await expect(panel.getByRole("textbox", { name: tx.menuNameEn })).toHaveCount(original.length);
    await panel.getByRole("button", { name: tx.menuAdd }).click();
    const row = panel.locator("tbody tr").last();
    await row.getByRole("textbox", { name: tx.menuNameEn }).fill("Tlayuda");
    await row.getByRole("textbox", { name: tx.menuNameEs }).fill("Tlayuda");
    await row.getByRole("textbox", { name: tx.menuPrice }).fill("60");
    await row.getByRole("textbox", { name: tx.menuAliases }).fill("tlayudita");
    await expectNoOverflow(page);
    await panel.getByRole("button", { name: tx.menuSave }).click();
    await expect(page.getByRole("status").filter({ hasText: tx.menuSaved })).toBeVisible();

    await page.goto("/");
    const typed = lang === "es" ? "2 tlayudas y un atole" : "2 tlayudas and an atole";
    await page.getByRole("textbox", { name: tx.typeOrder }).fill(typed);
    await page.getByRole("button", { name: tx.typeAdd, exact: true }).click();
    await expect(page.locator(".cart li")).toHaveCount(2);
    await expect(page.getByRole("button", { name: tx.charge })).toHaveText(/140/); // 2 x 60 + 20
    await page.getByRole("button", { name: tx.clear }).click();
  } finally {
    const items = original.map((i) => ({
      names: i.names ?? { en: i.name, es: i.name },
      price: i.price.minor,
      aliases: i.aliases,
    }));
    const restored = await request.put("/api/backoffice/catalog", { headers, data: { items } });
    expect(restored.status()).toBe(200);
  }
});
