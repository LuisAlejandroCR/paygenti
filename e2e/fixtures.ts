// e2e/fixtures.ts: shared Playwright fixtures — fails any test that logs a console error or
// throws in the page, a per-locale text table, and helpers for the PIN login and API sales.
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";

export const TEXT = {
  en: {
    online: "Online",
    payMock: "Pay (simulated)",
    declineMock: "Simulate decline",
    customerPaid: "Payment received! Thank you.",
    customerDeclined: "Payment declined.",
    vendorPaid: "PAID",
    vendorDeclined: "Payment declined",
    newSale: "New sale",
    charge: /^Charge \$/,
    clear: "Clear cart",
    addOne: "Add one Mole tamale",
    removeOne: "Remove one Mole tamale",
    removeAll: "Remove Rajas tamale",
    hold: "Hold and say the order",
    enter: "Enter",
    pinWrong: "Wrong PIN.",
    pinLocked: "Too many attempts. Wait a few minutes.",
    refund: "Refund",
    refundOk: /Refund authorized for/,
    overCap: /The maximum per refund is/,
    createInvoice: "Create invoice",
    invoiceQr: /QR for invoice/,
    ledger: "Daily ledger",
    exportCsv: "Export CSV",
    tPaid: "Your last payment was recorded",
    tGone: "The last charge is no longer available",
  },
  es: {
    online: "En línea",
    payMock: "Pagar (simulado)",
    declineMock: "Simular rechazo",
    customerPaid: "¡Pago recibido! Gracias.",
    customerDeclined: "Pago rechazado.",
    vendorPaid: "PAGADO",
    vendorDeclined: "Pago rechazado",
    newSale: "Nueva venta",
    charge: /^Cobrar \$/,
    clear: "Vaciar carrito",
    addOne: "Agregar uno de Tamal de mole",
    removeOne: "Quitar uno de Tamal de mole",
    removeAll: "Eliminar Tamal de rajas",
    hold: "Mantén presionado y di el pedido",
    enter: "Entrar",
    pinWrong: "PIN incorrecto.",
    pinLocked: "Demasiados intentos. Espera unos minutos.",
    refund: "Devolver",
    refundOk: /Devolución autorizada por/,
    overCap: /El máximo por devolución es/,
    createInvoice: "Crear factura",
    invoiceQr: /QR de la factura/,
    ledger: "Libro del día",
    exportCsv: "Exportar CSV",
    tPaid: "Tu último pago ya quedó registrado",
    tGone: "El último cobro ya no está disponible",
  },
} as const;

export type Lang = keyof typeof TEXT;

export const test = base.extend<{ lang: Lang; tx: (typeof TEXT)[Lang]; guard: void }>({
  lang: async ({ locale }, use) => use(locale?.startsWith("es") ? "es" : "en"),
  tx: async ({ lang }, use) => use(TEXT[lang]),
  guard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        // A 4xx the UI handles (wrong PIN, refund over the cap) is logged by the browser itself.
        if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await use();
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** document.scrollWidth must not exceed the viewport: no horizontal page scroll. */
export async function expectNoOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll, "horizontal overflow").toBeLessThanOrEqual(inner);
}

export async function login(page: Page, tx: (typeof TEXT)[Lang], pin = "1234") {
  await page.goto("/backoffice");
  await page.locator('input[type="password"]').fill(pin);
  await page.getByRole("button", { name: tx.enter }).click();
}

/** Creates a keypad sale on rosa-01 and settles it through the mock gateway. */
export async function apiSale(
  request: APIRequestContext,
  amountMinor: number,
  decline = false,
): Promise<{ id: string; status: string }> {
  const created = await request.post("/api/terminals/rosa-01/sales", {
    data: { amount: amountMinor },
  });
  expect(created.status()).toBe(201);
  const { sale } = (await created.json()) as { sale: { id: string; orderId: string } };
  await request.post(`/api/mock/orders/${sale.orderId}/approve`, { data: { decline } });
  const cap = await request.post(`/api/sales/${sale.id}/capture`);
  return ((await cap.json()) as { sale: { id: string; status: string } }).sale;
}
