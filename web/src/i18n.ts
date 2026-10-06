// web/src/i18n.ts: English/Spanish dictionary for every UI string, locale detection
// (navigator.language: es* -> Spanish, else English) and the useT() hook behind the EN/ES toggle.
// The choice persists in localStorage; DOM access is guarded so tests can import this in Node.
import { useEffect, useState } from "preact/hooks";

export type Locale = "en" | "es";
export const LOCALES: readonly Locale[] = ["en", "es"];
const STORAGE_KEY = "paygent.locale";

const en = {
  "app.online": "Online",
  "app.offline": "Offline",
  "app.langToggle": "Switch language",
  "vendor.terminalNotFound": "This terminal was not found.",
  "vendor.createFailed": "Could not create the charge. Check the connection and try again.",
  "vendor.amountEntry": "Amount entry",
  "vendor.delete": "Delete",
  "vendor.decimal": "Decimal point",
  "vendor.creating": "Creating…",
  "vendor.charge": "Charge",
  "vendor.chargeAmount": "Charge {amount}",
  "vendor.qrAlt": "QR code to pay at stall {terminal}",
  "vendor.scanHint": "Scan or tap the sticker to pay with PayPal",
  "vendor.waiting": "Waiting for payment…",
  "vendor.cancel": "Cancel",
  "vendor.paid": "PAID",
  "vendor.newSale": "New sale",
  "vendor.declined": "Payment declined",
  "vendor.expired": "Charge expired",
  "vendor.hideSticker": "Hide sticker",
  "vendor.writeSticker": "Write sticker",
  "announce.received": "Received: {amount}",
  "money.peso": "peso",
  "money.pesos": "pesos",
  "money.dollar": "dollar",
  "money.dollars": "dollars",
  "money.withCents": "{units} and {cents} cents",
  "checkout.notFound": "We could not find this sale.",
  "checkout.declinedRetry": "The payment was declined. Try another method.",
  "checkout.expired": "This sale expired. Ask the vendor for a new charge.",
  "checkout.failed": "The payment could not be completed. Try again.",
  "checkout.paypalError": "PayPal could not process the payment.",
  "checkout.sdkError": "Could not load PayPal. Check your connection.",
  "checkout.simulateError": "Could not simulate the payment.",
  "checkout.loading": "Loading…",
  "checkout.items": "Items",
  "checkout.total": "Total",
  "checkout.paid": "Payment received! Thank you.",
  "checkout.refunded": "This payment was refunded.",
  "checkout.declined": "Payment declined.",
  "checkout.processing": "Processing…",
  "checkout.payMock": "Pay (simulated)",
  "checkout.declineMock": "Simulate decline",
  "checkout.demoNote": "Demo mode: no real money moves.",
  "sticker.label": "Write sticker",
  "sticker.title": "Stall sticker",
  "sticker.approach": "Hold the sticker to the phone…",
  "sticker.write": "Write NFC sticker",
  "sticker.done": "Sticker written. Try it with another phone.",
  "sticker.error": "Could not write it. Make sure NFC is on and try again.",
  "sticker.noNfc":
    "This browser cannot write NFC (use Chrome on Android). Print this QR and stick it on the stall.",
  "sticker.qrAlt": "Printable QR code for stall {terminal}",
  "sticker.print": "Print QR",
  "voice.noProducts": "No products recognized. Try again or use the keypad.",
  "voice.unmatched": "Did not understand: {items}",
  "voice.parseFailed": "Could not read the order. Check the connection.",
  "voice.notHeard": "I did not hear you. Hold the button and speak close to the phone.",
  "voice.label": "Voice order",
  "voice.listening": "Listening… release to finish",
  "voice.hold": "Hold and say the order",
  "voice.unsupported": "Your browser cannot dictate. Use the keypad below.",
  "voice.removeOne": "Remove one {name}",
  "voice.addOne": "Add one {name}",
  "voice.removeAll": "Remove {name}",
  "voice.clear": "Clear cart",
  "bo.pinWrong": "Wrong PIN.",
  "bo.pinLocked": "Too many attempts. Wait a few minutes.",
  "bo.sessionRequired": "Your session expired. Sign in again with your PIN.",
  "bo.agentFailed": "The assistant did not answer. Use the buttons.",
  "bo.offline": "No connection to the server.",
  "bo.error": "Error: {code}",
  "bo.cashFormat": "Type the cash in pesos, for example 350.",
  "bo.invoiceFormat": "Type the invoice amount in pesos.",
  "bo.refundFormat": "Type how much to refund in pesos.",
  "bo.title": "My business",
  "bo.pin": "Vendor PIN",
  "bo.enter": "Enter",
  "bo.exit": "Sign out",
  "bo.askTitle": "Ask the assistant",
  "bo.askPlaceholder": "How much did I sell today?",
  "bo.askPin": "PIN (refunds only)",
  "bo.ask": "Ask",
  "bo.today": "Today's sales",
  "bo.salesCount": "{count} sales",
  "bo.refund": "Refund",
  "bo.refunded": "Refunded",
  "bo.refresh": "Refresh",
  "bo.refundTitle": "Refund",
  "bo.refundAmount": "How much to refund? (pesos)",
  "bo.confirmPin": "Confirm with your PIN",
  "bo.cancel": "Cancel",
  "bo.reconcileTitle": "Daily reconcile",
  "bo.cash": "Cash in the till (pesos)",
  "bo.reconcile": "Reconcile",
  "bo.refunds": "Refunds",
  "bo.cashRow": "Cash",
  "bo.total": "Total",
  "bo.invoiceTitle": "Invoice with QR",
  "bo.amount": "Amount (pesos)",
  "bo.concept": "Description",
  "bo.createInvoice": "Create invoice",
  "bo.invoiceQrAlt": "QR for invoice {id}",
  "bo.openInvoice": "Open invoice",
  "judge.title": "Judge mode",
  "judge.intro":
    "One screen, two phones: the vendor on the left, the customer on the right. Runs on a mock PayPal gateway unless sandbox keys are set.",
  "judge.step1":
    "Vendor: type an amount (e.g. 95) or hold the mic and say “two mole tamales and an atole”.",
  "judge.step2": "Vendor: tap “Charge”. The QR appears — that is what the customer would scan.",
  "judge.step3":
    "Customer: the checkout opens on the right. Tap “Pay (simulated)” or “Simulate decline”.",
  "judge.step4": "Vendor: the screen turns PAID and the phone says the amount out loud.",
  "judge.step5":
    "Bonus: open /backoffice (PIN 1234) and try a refund — the policy lock asks for the PIN again.",
  "judge.vendor": "Vendor",
  "judge.customer": "Customer",
  "judge.noSale": "No open sale. Create one in the vendor panel.",
  "ledger.title": "Daily ledger",
  "ledger.open": "Daily ledger",
  "ledger.back": "Back office",
  "ledger.date": "Day",
  "ledger.search": "Search sales…",
  "ledger.export": "Export CSV",
  "ledger.live": "Live",
  "ledger.updated": "Updated {time}",
  "ledger.empty": "No sales on this day.",
  "ledger.total": "Total",
  "ledger.col.time": "Time",
  "ledger.col.terminal": "Terminal",
  "ledger.col.method": "Method",
  "ledger.col.status": "Status",
  "ledger.col.items": "Items",
  "ledger.col.paid": "Paid",
  "ledger.col.refunded": "Refunded",
  "ledger.col.net": "Net",
  "ledger.col.reconciliation": "Reconciliation",
  "ledger.col.captureId": "Capture ID",
  "ledger.detail": "Sale detail",
  "ledger.detailHint": "Click a row to see its line items.",
  "ledger.line.qty": "Qty",
  "ledger.line.unit": "Unit price",
  "ledger.line.subtotal": "Subtotal",
  "ledger.method.paypal": "PayPal",
  "ledger.method.cash": "Cash",
  "ledger.status.open": "Open",
  "ledger.status.approved": "Approved",
  "ledger.status.paid": "Paid",
  "ledger.status.failed": "Failed",
  "ledger.status.expired": "Expired",
  "ledger.status.refunded": "Refunded",
  "ledger.rec.matched": "Matched",
  "ledger.rec.missing_capture": "Missing capture",
  "ledger.rec.partial_refund": "Partial refund",
  "ledger.rec.refunded": "Refunded",
  "ledger.rec.pending": "Pending",
  "ledger.rec.void": "Void",
  "ledger.rec.cash": "Cash",
  "ledger.cashTotal": "Cash: {amount}",
  "reason.POLICY_ERROR": "I couldn't validate the operation; for safety it was not done.",
  "reason.MALFORMED_ACTION": "The operation data is incomplete; nothing was done.",
  "reason.UNKNOWN_ACTOR": "I don't know who is asking; nothing was done.",
  "reason.UNKNOWN_ACTION": "That operation doesn't exist; nothing was done.",
  "reason.DISPUTE_MANUAL_ONLY": "Disputes are handled by {vendor} by hand, outside the assistant.",
  "reason.INVALID_AMOUNT": "The amount is not valid; it must be greater than zero.",
  "reason.CURRENCY_MISMATCH": "The currency doesn't match the account; nothing was done.",
  "reason.CUSTOMER_NOT_AUTHORIZED": "Only {vendor} can authorize this, not the customer.",
  "reason.VENDOR_REQUIRED": "Only {vendor} can authorize this; the limit is {limit}.",
  "reason.PIN_REQUIRED": "{vendor} must confirm with the PIN to authorize this.",
  "reason.REFUND_OVER_CAP": "The maximum per refund is {max}; you asked for {amount}.",
  "reason.REFUND_EXCEEDS_CAPTURE":
    "You can't refund more than was charged: {left} left on that charge.",
  "reason.CAPTURE_NOT_TODAY": "Only today's charges can be refunded.",
  "reason.REFUND_DAILY_CAP": "The daily refund limit is {max}; {left} left today.",
  "reason.REFUND_OK": "Refund authorized for {amount}.",
  "reason.PAYOUT_NOT_ALLOWLISTED": "That recipient is not on {vendor}'s list; no payout.",
  "reason.PAYOUT_DAILY_CAP": "The daily payout limit is {max}; {left} left today.",
  "reason.PAYOUT_OK": "Payout authorized for {amount}.",
  "reason.ORDER_OK": "Charge for {amount} ready.",
  "reason.INVOICE_OK": "Invoice for {amount} ready.",
  "reason.SALE_NOT_REFUNDABLE": "That sale has no paid charge.",
  "reason.REFUND_FAILED": "PayPal did not accept the refund.",
  "reason.TICKET_INVALID": "That permit doesn't exist or has expired.",
  "soundbox.title": "Soundbox",
  "soundbox.enable": "Tap to enable sound",
  "soundbox.enableHint": "Browsers need one tap before they can speak.",
  "soundbox.idle": "Scan to pay",
  "soundbox.open": "To pay",
  "soundbox.paid": "PAID",
  "soundbox.failed": "Payment declined",
  "soundbox.expired": "Charge cancelled or expired",
  "soundbox.refunded": "Refunded",
  "soundbox.offline": "Offline, reconnecting…",
  "soundbox.fullscreen": "Full screen",
  "soundbox.notFound": "This terminal was not found.",
  "soundbox.trust": "Only payments confirmed by PayPal make a sound.",
  "judge.openSoundbox": "Open soundbox",
} as const;

export type Key = keyof typeof en;
type Dict = Record<Key, string>;

const es: Dict = {
  "app.online": "En línea",
  "app.offline": "Sin conexión",
  "app.langToggle": "Cambiar idioma",
  "vendor.terminalNotFound": "No se encontró esta terminal.",
  "vendor.createFailed": "No se pudo crear el cobro. Revisa la conexión e intenta de nuevo.",
  "vendor.amountEntry": "Captura del monto",
  "vendor.delete": "Borrar",
  "vendor.decimal": "Punto decimal",
  "vendor.creating": "Creando…",
  "vendor.charge": "Cobrar",
  "vendor.chargeAmount": "Cobrar {amount}",
  "vendor.qrAlt": "Código QR para pagar en el puesto {terminal}",
  "vendor.scanHint": "Escanea o toca el sticker para pagar con PayPal",
  "vendor.waiting": "Esperando pago…",
  "vendor.cancel": "Cancelar",
  "vendor.paid": "PAGADO",
  "vendor.newSale": "Nueva venta",
  "vendor.declined": "Pago rechazado",
  "vendor.expired": "Cobro expirado",
  "vendor.hideSticker": "Ocultar sticker",
  "vendor.writeSticker": "Grabar sticker",
  "announce.received": "Recibido: {amount}",
  "money.peso": "peso",
  "money.pesos": "pesos",
  "money.dollar": "dólar",
  "money.dollars": "dólares",
  "money.withCents": "{units} con {cents} centavos",
  "checkout.notFound": "No encontramos esta venta.",
  "checkout.declinedRetry": "El pago fue rechazado. Intenta con otro método.",
  "checkout.expired": "Esta venta expiró. Pide a la vendedora un cobro nuevo.",
  "checkout.failed": "No se pudo completar el pago. Intenta de nuevo.",
  "checkout.paypalError": "PayPal no pudo procesar el pago.",
  "checkout.sdkError": "No se pudo cargar PayPal. Revisa tu conexión.",
  "checkout.simulateError": "No se pudo simular el pago.",
  "checkout.loading": "Cargando…",
  "checkout.items": "Productos",
  "checkout.total": "Total",
  "checkout.paid": "¡Pago recibido! Gracias.",
  "checkout.refunded": "Este pago fue reembolsado.",
  "checkout.declined": "Pago rechazado.",
  "checkout.processing": "Procesando…",
  "checkout.payMock": "Pagar (simulado)",
  "checkout.declineMock": "Simular rechazo",
  "checkout.demoNote": "Modo demostración: no se mueve dinero real.",
  "sticker.label": "Grabar sticker",
  "sticker.title": "Sticker del puesto",
  "sticker.approach": "Acerca el sticker al teléfono…",
  "sticker.write": "Grabar sticker NFC",
  "sticker.done": "Sticker grabado. Pruébalo con otro teléfono.",
  "sticker.error": "No se pudo grabar. Revisa que el NFC esté activo e intenta de nuevo.",
  "sticker.noNfc":
    "Este navegador no puede grabar NFC (usa Chrome en Android). Imprime este QR y pégalo en el puesto.",
  "sticker.qrAlt": "Código QR del puesto {terminal} para imprimir",
  "sticker.print": "Imprimir QR",
  "voice.noProducts": "No reconocí productos. Intenta de nuevo o usa el teclado.",
  "voice.unmatched": "No entendí: {items}",
  "voice.parseFailed": "No se pudo interpretar el pedido. Revisa la conexión.",
  "voice.notHeard": "No te escuché. Mantén presionado y habla cerca del teléfono.",
  "voice.label": "Pedido por voz",
  "voice.listening": "Escuchando… suelta para terminar",
  "voice.hold": "Mantén presionado y di el pedido",
  "voice.unsupported": "Tu navegador no permite dictar. Usa el teclado de abajo.",
  "voice.removeOne": "Quitar uno de {name}",
  "voice.addOne": "Agregar uno de {name}",
  "voice.removeAll": "Eliminar {name}",
  "voice.clear": "Vaciar carrito",
  "bo.pinWrong": "PIN incorrecto.",
  "bo.pinLocked": "Demasiados intentos. Espera unos minutos.",
  "bo.sessionRequired": "La sesión venció. Entra de nuevo con tu PIN.",
  "bo.agentFailed": "El asistente no respondió. Usa los botones.",
  "bo.offline": "Sin conexión con el servidor.",
  "bo.error": "Error: {code}",
  "bo.cashFormat": "Escribe el efectivo en pesos, por ejemplo 350.",
  "bo.invoiceFormat": "Escribe el monto de la factura en pesos.",
  "bo.refundFormat": "Escribe cuánto devolver en pesos.",
  "bo.title": "Mi negocio",
  "bo.pin": "PIN de la vendedora",
  "bo.enter": "Entrar",
  "bo.exit": "Salir",
  "bo.askTitle": "Pregúntale al asistente",
  "bo.askPlaceholder": "¿Cuánto vendí hoy?",
  "bo.askPin": "PIN (solo para devoluciones)",
  "bo.ask": "Preguntar",
  "bo.today": "Ventas de hoy",
  "bo.salesCount": "{count} ventas",
  "bo.refund": "Devolver",
  "bo.refunded": "Devuelta",
  "bo.refresh": "Actualizar",
  "bo.refundTitle": "Devolución",
  "bo.refundAmount": "¿Cuánto devolver? (pesos)",
  "bo.confirmPin": "Confirma con tu PIN",
  "bo.cancel": "Cancelar",
  "bo.reconcileTitle": "Cuadre del día",
  "bo.cash": "Efectivo en caja (pesos)",
  "bo.reconcile": "Cuadrar",
  "bo.refunds": "Devoluciones",
  "bo.cashRow": "Efectivo",
  "bo.total": "Total",
  "bo.invoiceTitle": "Factura con QR",
  "bo.amount": "Monto (pesos)",
  "bo.concept": "Concepto",
  "bo.createInvoice": "Crear factura",
  "bo.invoiceQrAlt": "QR de la factura {id}",
  "bo.openInvoice": "Abrir factura",
  "judge.title": "Modo jurado",
  "judge.intro":
    "Una pantalla, dos teléfonos: la vendedora a la izquierda, el cliente a la derecha. Usa un PayPal simulado salvo que haya llaves de sandbox.",
  "judge.step1":
    "Vendedora: escribe un monto (ej. 95) o mantén el micrófono y di “dos tamales de mole y un atole”.",
  "judge.step2": "Vendedora: toca “Cobrar”. Aparece el QR — eso es lo que escanearía el cliente.",
  "judge.step3":
    "Cliente: el cobro se abre a la derecha. Toca “Pagar (simulado)” o “Simular rechazo”.",
  "judge.step4": "Vendedora: la pantalla dice PAGADO y el teléfono anuncia el monto en voz alta.",
  "judge.step5":
    "Extra: abre /backoffice (PIN 1234) y prueba una devolución — el candado de políticas vuelve a pedir el PIN.",
  "judge.vendor": "Vendedora",
  "judge.customer": "Cliente",
  "judge.noSale": "No hay venta abierta. Crea una en el panel de la vendedora.",
  "ledger.title": "Libro del día",
  "ledger.open": "Libro del día",
  "ledger.back": "Back office",
  "ledger.date": "Día",
  "ledger.search": "Buscar ventas…",
  "ledger.export": "Exportar CSV",
  "ledger.live": "En vivo",
  "ledger.updated": "Actualizado {time}",
  "ledger.empty": "No hay ventas en este día.",
  "ledger.total": "Total",
  "ledger.col.time": "Hora",
  "ledger.col.terminal": "Terminal",
  "ledger.col.method": "Método",
  "ledger.col.status": "Estado",
  "ledger.col.items": "Productos",
  "ledger.col.paid": "Cobrado",
  "ledger.col.refunded": "Devuelto",
  "ledger.col.net": "Neto",
  "ledger.col.reconciliation": "Cuadre",
  "ledger.col.captureId": "ID de captura",
  "ledger.detail": "Detalle de la venta",
  "ledger.detailHint": "Toca una fila para ver sus productos.",
  "ledger.line.qty": "Cant.",
  "ledger.line.unit": "Precio unitario",
  "ledger.line.subtotal": "Subtotal",
  "ledger.method.paypal": "PayPal",
  "ledger.method.cash": "Efectivo",
  "ledger.status.open": "Abierta",
  "ledger.status.approved": "Aprobada",
  "ledger.status.paid": "Pagada",
  "ledger.status.failed": "Fallida",
  "ledger.status.expired": "Expirada",
  "ledger.status.refunded": "Devuelta",
  "ledger.rec.matched": "Cuadra",
  "ledger.rec.missing_capture": "Falta captura",
  "ledger.rec.partial_refund": "Devolución parcial",
  "ledger.rec.refunded": "Devuelta",
  "ledger.rec.pending": "Pendiente",
  "ledger.rec.void": "Anulada",
  "ledger.rec.cash": "Efectivo",
  "ledger.cashTotal": "Efectivo: {amount}",
  "reason.POLICY_ERROR": "No pude validar la operación; por seguridad no se hace.",
  "reason.MALFORMED_ACTION": "Los datos de la operación no están completos; no se hace nada.",
  "reason.UNKNOWN_ACTOR": "No sé quién pide la operación; no se hace nada.",
  "reason.UNKNOWN_ACTION": "Esa operación no existe; no se hace nada.",
  "reason.DISPUTE_MANUAL_ONLY": "Las disputas las decide {vendor} a mano, fuera del asistente.",
  "reason.INVALID_AMOUNT": "El monto no es válido; tiene que ser mayor a cero.",
  "reason.CURRENCY_MISMATCH": "La moneda no coincide con la de la cuenta; no se hace nada.",
  "reason.CUSTOMER_NOT_AUTHORIZED": "Esto lo autoriza solo {vendor}, no el cliente.",
  "reason.VENDOR_REQUIRED": "Solo {vendor} puede autorizar esto; el límite es {limit}.",
  "reason.PIN_REQUIRED": "Para autorizar esto, {vendor} tiene que confirmar con su PIN.",
  "reason.REFUND_OVER_CAP": "El máximo por devolución es {max}; pediste {amount}.",
  "reason.REFUND_EXCEEDS_CAPTURE":
    "No se puede devolver más de lo cobrado: de ese cobro quedan {left}.",
  "reason.CAPTURE_NOT_TODAY": "Solo se pueden devolver cobros de hoy.",
  "reason.REFUND_DAILY_CAP": "El tope de devoluciones del día es {max}; hoy quedan {left}.",
  "reason.REFUND_OK": "Devolución autorizada por {amount}.",
  "reason.PAYOUT_NOT_ALLOWLISTED": "Ese destinatario no está en la lista de {vendor}; no se paga.",
  "reason.PAYOUT_DAILY_CAP": "El tope de pagos del día es {max}; hoy quedan {left}.",
  "reason.PAYOUT_OK": "Pago autorizado por {amount}.",
  "reason.ORDER_OK": "Cobro por {amount} listo.",
  "reason.INVOICE_OK": "Factura por {amount} lista.",
  "reason.SALE_NOT_REFUNDABLE": "Esa venta no tiene un cobro pagado.",
  "reason.REFUND_FAILED": "PayPal no aceptó la devolución.",
  "reason.TICKET_INVALID": "Ese permiso no existe o ya venció.",
  "soundbox.title": "Bocina",
  "soundbox.enable": "Toca para activar el sonido",
  "soundbox.enableHint": "El navegador necesita un toque antes de poder hablar.",
  "soundbox.idle": "Escanea para pagar",
  "soundbox.open": "Por pagar",
  "soundbox.paid": "PAGADO",
  "soundbox.failed": "Pago rechazado",
  "soundbox.expired": "Cobro cancelado o vencido",
  "soundbox.refunded": "Devuelto",
  "soundbox.offline": "Sin conexión, reconectando…",
  "soundbox.fullscreen": "Pantalla completa",
  "soundbox.notFound": "No se encontró esta terminal.",
  "soundbox.trust": "Solo los pagos confirmados por PayPal suenan.",
  "judge.openSoundbox": "Abrir bocina",
};

export const DICTIONARIES: Record<Locale, Dict> = { en, es };

/** es* -> Spanish; anything else (or nothing) -> English. A stored valid choice wins. */
export function detectLocale(navigatorLanguage?: string | null, stored?: string | null): Locale {
  if (stored === "en" || stored === "es") return stored;
  return navigatorLanguage?.toLowerCase().startsWith("es") ? "es" : "en";
}

/** BCP-47 tag for speech recognition and synthesis. */
export function speechLang(locale: Locale): string {
  return locale === "es" ? "es-MX" : "en-US";
}

export function translate(
  locale: Locale,
  key: Key,
  vars?: Record<string, string | number>,
): string {
  const text = DICTIONARIES[locale][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : text;
}

interface Env {
  navigator?: { language?: string };
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  document?: { documentElement: { lang: string } };
}
const env = globalThis as Env;

function readStored(): string | null {
  try {
    return env.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

let current: Locale = detectLocale(env.navigator?.language, readStored());
const listeners = new Set<(l: Locale) => void>();
if (env.document) env.document.documentElement.lang = speechLang(current);

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    env.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage blocked (private mode): the choice lasts for this page only.
  }
  if (env.document) env.document.documentElement.lang = speechLang(locale);
  for (const fn of listeners) fn(locale);
}

/** Non-hook translator for code outside components (announce.ts). */
/** Localized policy/back-office reason for a machine code; falls back to the server text. */
export function reasonText(
  code: string | undefined,
  params?: Record<string, string | number>,
  fallback?: string,
  locale: Locale = current,
): string | undefined {
  const key = `reason.${code}`;
  return key in DICTIONARIES[locale] ? translate(locale, key as Key, params) : fallback;
}

/** Display name of a cart line in the active locale (falls back to the canonical English name). */
export function lineName(
  line: { name: string; names?: { en: string; es: string } },
  locale: Locale = current,
): string {
  return line.names?.[locale] ?? line.name;
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  return translate(current, key, vars);
}

/** Re-renders the component when the locale changes. */
export function useT() {
  const [locale, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => {
      listeners.delete(set);
    };
  }, []);
  return {
    locale,
    t: (key: Key, vars?: Record<string, string | number>) => translate(locale, key, vars),
  };
}
