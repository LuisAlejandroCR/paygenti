// e2e/payouts.spec.ts: suppliers & payouts in /backoffice on the mock gateway — add a supplier with
// the PIN, pay within the cap (status Paid), refuse a payout over the per-payout cap, and the server
// refusing a recipient that is not on the list (unknown id, or a supplier just removed with the PIN).
import { type Page } from "@playwright/test";
import { expect, expectNoOverflow, login, type TEXT, test } from "./fixtures";

type Tx = (typeof TEXT)[keyof typeof TEXT];

async function addSupplier(page: Page, tx: Tx, name: string, email: string) {
  const form = page.getByRole("form", { name: tx.addForm });
  await form.getByLabel(tx.supplierName).fill(name);
  await form.getByLabel(tx.supplierReceiver).fill(email);
  await form.getByLabel(tx.yourPin).fill("1234");
  await form.getByRole("button", { name: tx.addSupplier }).click();
  await expect(page.getByRole("status").filter({ hasText: tx.supplierAdded })).toBeVisible();
}

async function payout(page: Page, tx: Tx, name: string, amount: string) {
  const form = page.getByRole("form", { name: tx.payForm });
  await form.getByLabel(tx.supplier).selectOption({ label: name });
  await form.getByLabel(tx.amount).fill(amount);
  await form.getByLabel(tx.yourPin).fill("1234");
  await form.getByRole("button", { name: tx.pay, exact: true }).click();
}

/** POST /api/backoffice/payouts with the page's session token (what a tampered client could send). */
function apiPayout(page: Page, supplierId: string) {
  return page.evaluate(async (id) => {
    const token = sessionStorage.getItem("paygent.bo.token");
    const res = await fetch("/api/backoffice/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ supplierId: id, amountMinor: 1000, pin: "1234" }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  }, supplierId);
}

const unique = () => Math.random().toString(36).slice(2, 8);

test("add a supplier with the PIN, pay within the cap, refuse over the cap", async ({
  page,
  tx,
}) => {
  await login(page, tx);
  await expect(page.getByRole("heading", { name: tx.payTitle })).toBeVisible();
  const id = unique();
  const name = `Masa ${id}`;
  await addSupplier(page, tx, name, `masa-${id}@example.com`);

  await payout(page, tx, name, "50");
  await expect(page.getByRole("status").filter({ hasText: tx.payoutSent })).toBeVisible();
  const row = page.getByTestId("payout-history").locator("li").filter({ hasText: name }).first();
  await expect(row).toContainText(tx.paidStatus);

  await payout(page, tx, name, "400");
  await expect(page.getByRole("alert").filter({ hasText: tx.payoutOverCap })).toBeVisible();
  await expect(
    page.getByTestId("payout-history").locator("li").filter({ hasText: name }),
  ).toHaveCount(1);
  await expectNoOverflow(page);
});

test("the server refuses recipients that are not on the list", async ({ page, tx }) => {
  await login(page, tx);
  await expect(page.getByRole("heading", { name: tx.payTitle })).toBeVisible();
  const unknown = await apiPayout(page, "not-a-supplier");
  expect(unknown).toEqual({
    status: 403,
    body: expect.objectContaining({ error: "PAYOUT_NOT_ALLOWLISTED" }),
  });

  const id = unique();
  const name = `Leña ${id}`;
  await addSupplier(page, tx, name, `lena-${id}@example.com`);
  const suppliers = await page.evaluate(async () => {
    const token = sessionStorage.getItem("paygent.bo.token");
    const res = await fetch("/api/backoffice/suppliers", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return ((await res.json()) as { suppliers: { id: string; name: string }[] }).suppliers;
  });
  const supplierId = suppliers.find((s) => s.name === name)?.id ?? "";
  const item = page.locator(".supplier-list li").filter({ hasText: name });
  await item.getByRole("button", { name: tx.remove }).click();
  const confirm = page.getByRole("form", { name: new RegExp(name) });
  await confirm.locator('input[type="password"]').fill("1234");
  await confirm.getByRole("button", { name: tx.remove, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: tx.supplierRemoved })).toBeVisible();
  await expect(item).toHaveCount(0);

  const removed = await apiPayout(page, supplierId);
  expect(removed.body.error).toBe("PAYOUT_NOT_ALLOWLISTED");
  await expectNoOverflow(page);
});
