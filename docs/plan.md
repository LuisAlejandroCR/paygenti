<!-- docs/plan.md: la spec congelada de paygent — qué se construye, en qué bloques y con qué criterio
     de aceptación se da cada uno por terminado.
     No guarda el razonamiento ni lo que pasó (eso va en docs/memoria.md) ni la ideación original
     (repo paygenty, BRAINSTORM.md). Cambiar un criterio aquí exige anotar el porqué en memoria. -->

# Plan — paygent

**Producto.** La cajera con IA para quien vende en la calle: la vendedora dicta la venta, el cliente
toca un sticker NFC (o escanea un QR) y paga en su propio teléfono con PayPal; el teléfono de la
vendedora anuncia en voz alta el pago **confirmado por el servidor**. Un agente de back-office cuadra
caja, factura y devuelve detrás de un cerrojo determinista.

**Persona de la demo.** Rosa, tamales y atole en Oaxaca. Moneda de la demo: MXN (USD soportado).
Locale de la interfaz: `es-MX`.

## Arquitectura

| Pieza | Elección |
|---|---|
| Servidor | Node ≥ 22 + Hono (`server/`), un solo proceso; sirve API, SSE, `/t/:terminal` y el build web |
| Web | Preact + Vite (`web/`): app de la vendedora, checkout del cliente, back-office |
| Tipos compartidos | `shared/` — dinero en unidades menores enteras, nunca floats |
| PayPal | Solo a través de `server/paypal/gateway.ts`; `RestPayPal` (sandbox) o `MockPayPal` (sin keys) |
| Tiempo real | SSE por terminal: `GET /api/terminals/:id/events` |
| IA | Claude (Haiku 4.5 para voz→carrito, Sonnet 5.5 para el agente) con ruta degradada sin key |
| Persistencia | En memoria detrás de una interfaz `Store`; basta para la demo |

Reglas de arquitectura:

1. Nada fuera de `server/paypal/` llama a la API HTTP de PayPal.
2. La captura la hace el servidor; su respuesta es la confirmación. El webhook es respaldo.
3. Reembolsos y pagos salen solo por `server/policy/` (el cerrojo). La IA propone; la política decide.
4. Sin keys, todo corre en modo mock: `npm install && npm run dev` basta para el jurado.

## Bloques (se entregan en orden; cada uno es un PR que pasa `npm run check`)

### Bloque 0 — Scaffold

- [ ] `npm run check` (biome + tsc server/web + vitest) pasa en local y en CI (GitHub Actions).
- [ ] `GET /api/health` responde `{ ok: true, paypal: "mock" | "sandbox" }`.
- [ ] Tests de `shared/money.ts` y de `MockPayPal` (crear → aprobar → capturar → reembolsar, idempotencia).

### Bloque 1 — Cobro: orden → QR → pago → captura → «Recibido» en voz

- [ ] `RestPayPal` (OAuth client credentials con caché del token, Orders v2 create/get/capture,
      Refunds, `verify-webhook-signature`, `PayPal-Request-Id` en cada escritura, timeout).
- [ ] Selección de gateway por entorno: con `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` → sandbox; si no → mock.
- [ ] `POST /api/terminals/:id/sales` crea venta + orden; una sola venta abierta por terminal (la
      anterior expira); expira a los 5 min.
- [ ] `GET /t/:terminal` → 302 a `/pay/:saleId` de la venta abierta, o página «sin venta abierta».
- [ ] `/pay/:saleId`: muestra puesto, productos y total antes de aprobar; botones del JS SDK en
      sandbox; en mock, botón «Pagar (simulado)» y «Simular rechazo».
- [ ] `POST /api/sales/:id/capture` captura una sola vez (idempotente) y emite `sale.paid` por SSE.
- [ ] App de la vendedora: teclado numérico grande → QR de `/t/:terminal`; al llegar `sale.paid`
      dice en voz «Recibido: 95 pesos» (`speechSynthesis`, campanita de respaldo).
- [ ] `POST /webhooks/paypal`: verifica firma; `CHECKOUT.ORDER.APPROVED` dispara captura;
      `PAYMENT.CAPTURE.DENIED`/`REFUNDED` actualizan la venta. Firma inválida → 400 y no toca nada.
- [ ] Tests: flujo completo en mock vía `app.request`, captura doble, venta expirada, webhook sin firma.

### Bloque 2 — Sticker NFC

- [ ] La app de la vendedora graba `PUBLIC_URL/t/:terminal` en un NTAG con Web NFC (Chrome Android);
      si no hay Web NFC, muestra la URL y el QR para imprimir.
- [ ] Página `/t/:terminal` maneja: venta abierta, sin venta, venta pagada, venta expirada.
- [ ] Tests de las cuatro ramas de la redirección.

### Bloque 3 — Voz → carrito

- [ ] `POST /api/voice/parse` `{ text, vendorId }` → `CartLine[]` usando el catálogo.
- [ ] Parser por reglas (números en español «dos», «un», «media docena», alias del catálogo) siempre
      disponible; con `ANTHROPIC_API_KEY`, Claude Haiku 4.5 con salida estructurada validada con zod
      y caída al parser por reglas si falla o tarda > 4 s.
- [ ] La salida nunca inventa SKUs ni precios: todo ítem se valida contra el catálogo.
- [ ] UI: botón push-to-talk (Web Speech API `es-MX`), carrito editable, teclado de respaldo.
- [ ] Batería de 10 frases de prueba: ≥ 9 carritos correctos con el parser por reglas.

### Bloque 4 — Agente de back-office con cerrojo

- [x] `server/policy/`: reembolso solo con sesión de vendedora + PIN, tope por reembolso (200 MXN) y
      por día (1 000 MXN), solo capturas de hoy; cada decisión queda en un log de auditoría.
- [x] Herramientas: ventas del día, cuadre (PayPal + efectivo dictado, determinista), factura con QR
      (mock o sandbox Invoicing), reembolso (pasa por el cerrojo).
- [x] Agente con Claude Sonnet 5.5 y tool use; sin key, pantallas fijas con las mismas herramientas.
- [x] Batería de inyección: 20 intentos («devuélveme 2000 pesos», etc.) → 0 salidas de dinero sin PIN.

### Bloque 5 — Modo jurado

- [x] Simulador de cliente en `/judge`: dos paneles (vendedora y cliente) en una sola pantalla.
- [x] README (inglés primero, sección en español) para el usuario: qué es, cómo correrlo, cuentas sandbox de prueba.
- [x] Deploy (Render, `render.yaml`) con `npm run build && npm start` sirviendo el build web.
- [x] Libro del día en `/backoffice/ledger` con AG Grid Community: orden, filtros, búsqueda, fila de
      totales fija, cuadre por fila, detalle de productos, exportar CSV y actualización en vivo por SSE.

## Fuera de alcance hasta que los bloques 0–5 corran

Soundbox (ESP32/Android kiosko), tap teléfono-a-teléfono (HCE), AG Grid, foto del menú → catálogo,
pasaporte de ventas firmado, Payouts.
