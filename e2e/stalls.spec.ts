// e2e/stalls.spec.ts: one owner, two paygents — the stall switcher moves the back office to Don Beto
// (his own PIN), "All my Paygentis" shows totals per currency, and a refund Claude proposed over
// /mcp waits in the approvals inbox until the owner approves it with the stall PIN.
import { apiSale, expect, expectNoOverflow, login, test } from "./fixtures";

const ALL = { en: "All my Paygentis", es: "Todos mis Paygentis" };
const APPROVE = { en: "Approve", es: "Aprobar" };
const APPROVED = { en: "Approved: the money moved.", es: "Aprobado: el dinero se movió." };

test("switcher moves to Don Beto, and All my Paygentis sums per currency", async ({
  page,
  tx,
  lang,
}) => {
  await login(page, tx);
  const switcher = page.getByTestId("stall-switcher");
  await expect(switcher).toBeVisible();
  await expect(switcher.locator("option")).toHaveText([
    "Rosa — Tamales y atole",
    "Don Beto — Tacos",
    ALL[lang],
  ]);
  await switcher.selectOption("beto");
  await expect(page).toHaveURL(/\/backoffice\?stall=beto$/);
  // Rosa's PIN does not open Don Beto's stall; his own does.
  await page.locator('input[type="password"]').fill("1234");
  await page.getByRole("button", { name: tx.enter }).click();
  await expect(page.getByText(tx.pinWrong)).toBeVisible();
  await page.locator('input[type="password"]').fill("5678");
  await page.getByRole("button", { name: tx.enter }).click();
  await expect(page.getByRole("link", { name: tx.ledger })).toBeVisible();
  await expect(page.getByTestId("stall-switcher")).toHaveValue("beto");
  await expectNoOverflow(page);

  await page.getByTestId("stall-switcher").selectOption("__all");
  await expect(page).toHaveURL(/\/backoffice\/all$/);
  const totals = page.getByTestId("owner-totals");
  await expect(totals.locator('[data-currency="MXN"]')).toBeVisible();
  await expect(page.getByTestId("owner-stall-rosa")).toBeVisible();
  await expect(page.getByTestId("owner-stall-beto")).toBeVisible();
  await expectNoOverflow(page);
});

test("a refund Claude proposed is approved in the inbox with the stall PIN", async ({
  page,
  request,
  tx,
  lang,
}) => {
  const sale = await apiSale(request, 3000);
  const session = await request.post("/api/backoffice/session", { data: { pin: "1234" } });
  const { token } = (await session.json()) as { token: string };
  const created = await request.post("/api/owner/mcp-tokens", {
    headers: { "X-Paygent-Sessions": `rosa=${token}` },
    data: { label: "e2e" },
  });
  const { secret } = (await created.json()) as { secret: string };
  const proposed = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${secret}` },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "propose_refund",
        arguments: { stall: "rosa", saleId: sale.id, amountMinor: 100, note: "e2e" },
      },
    },
  });
  expect(proposed.ok()).toBe(true);

  await login(page, tx);
  const inbox = page.getByTestId("approvals");
  await expect(inbox).toBeVisible();
  await inbox.locator('input[type="password"]').first().fill("1234");
  await inbox.getByRole("button", { name: APPROVE[lang] }).first().click();
  await expect(inbox.getByRole("status")).toHaveText(APPROVED[lang]);
  await expectNoOverflow(page);
});
