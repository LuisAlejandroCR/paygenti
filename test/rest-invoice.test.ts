// test/rest-invoice.test.ts: RestPayPal.createInvoice against a stubbed fetch — create, send
// without emailing the recipient, and QR extraction from the generate-qr-code body.
import { expect, it } from "vitest";
import { RestPayPal } from "../server/paypal/rest";
import { money } from "../shared/money";

it("creates, sends (send_to_recipient false) and fetches the QR", async () => {
  const calls: { path: string; body: string }[] = [];
  const png = "iVBORw0KGgo".padEnd(400, "A");
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: String(init.body ?? "") });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === "/v1/oauth2/token")
      return json({ access_token: "T", token_type: "Bearer", expires_in: 3600 });
    if (path === "/v2/invoicing/invoices")
      return json({ href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-AAA" });
    if (path.endsWith("/send"))
      return json({ href: "https://www.sandbox.paypal.com/invoice/p/#INV2-AAA" });
    if (path.endsWith("/generate-qr-code"))
      return new Response(`--b\r\nContent-Type: image/png\r\n\r\n${png}\r\n--b--`, { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  const pp = new RestPayPal({ clientId: "id", clientSecret: "s", fetch });
  const inv = await pp.createInvoice({
    amount: money(50000, "MXN"),
    description: "Pedido",
    idempotencyKey: "k1",
  });
  expect(inv.id).toBe("INV2-AAA");
  expect(inv.payUrl).toContain("#INV2-AAA");
  expect(inv.qrPngBase64).toBe(png);
  const send = calls.find((c) => c.path.endsWith("/send"));
  expect(JSON.parse(send?.body ?? "{}").send_to_recipient).toBe(false);
});
