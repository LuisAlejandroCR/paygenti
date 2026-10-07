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
| PayPal + IA | `@paypal/agent-toolkit` (adaptador Bedrock): lista blanca de lectura y cobro para el agente; reembolsos solo por el candado con PIN |
| Persistencia | En memoria detrás de una interfaz `Store`; basta para la demo |

Reglas de arquitectura:

1. Nada fuera de `server/paypal/` llama a la API HTTP de PayPal.
2. La captura la hace el servidor; su respuesta es la confirmación. El webhook es respaldo.
3. Reembolsos y pagos salen solo por `server/policy/` (el cerrojo). La IA propone; la política decide.
4. Sin keys, todo corre en modo mock: `npm install && npm run dev` basta para el jurado.

## Bloques (se entregan en orden; cada uno es un PR que pasa `npm run check`)

### Bloque 0 — Scaffold

- [x] `npm run check` (biome + tsc server/web + vitest) pasa en local y en CI (GitHub Actions).
- [x] `GET /api/health` responde `{ ok: true, paypal: "mock" | "sandbox" }`.
- [x] Tests de `shared/money.ts` y de `MockPayPal` (crear → aprobar → capturar → reembolsar, idempotencia).

### Bloque 1 — Cobro: orden → QR → pago → captura → «Recibido» en voz

- [x] `RestPayPal` (OAuth client credentials con caché del token, Orders v2 create/get/capture,
      Refunds, `verify-webhook-signature`, `PayPal-Request-Id` en cada escritura, timeout).
- [x] Selección de gateway por entorno: con `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` → sandbox; si no → mock.
- [x] `POST /api/terminals/:id/sales` crea venta + orden; una sola venta abierta por terminal (la
      anterior expira); expira a los 5 min.
- [x] `GET /t/:terminal` → 302 a `/pay/:saleId` de la venta abierta, o página «sin venta abierta».
- [x] `/pay/:saleId`: muestra puesto, productos y total antes de aprobar; botones del JS SDK en
      sandbox; en mock, botón «Pagar (simulado)» y «Simular rechazo».
- [x] `POST /api/sales/:id/capture` captura una sola vez (idempotente) y emite `sale.paid` por SSE.
- [x] App de la vendedora: teclado numérico grande → QR de `/t/:terminal`; al llegar `sale.paid`
      dice en voz «Recibido: 95 pesos» (`speechSynthesis`, campanita de respaldo).
- [x] `POST /webhooks/paypal`: verifica firma; `CHECKOUT.ORDER.APPROVED` dispara captura;
      `PAYMENT.CAPTURE.DENIED`/`REFUNDED` actualizan la venta. Firma inválida → 400 y no toca nada.
- [x] Tests: flujo completo en mock vía `app.request`, captura doble, venta expirada, webhook sin firma.

### Bloque 2 — Sticker NFC

- [x] La app de la vendedora graba `PUBLIC_URL/t/:terminal` en un NTAG con Web NFC (Chrome Android);
      si no hay Web NFC, muestra la URL y el QR para imprimir.
- [x] Página `/t/:terminal` maneja: venta abierta, sin venta, venta pagada, venta expirada.
- [x] Tests de las cuatro ramas de la redirección.

### Bloque 3 — Voz → carrito

- [x] `POST /api/voice/parse` `{ text, vendorId }` → `CartLine[]` usando el catálogo.
- [x] Parser por reglas (números en español «dos», «un», «media docena», alias del catálogo) siempre
      disponible; con `ANTHROPIC_API_KEY`, Claude Haiku 4.5 con salida estructurada validada con zod
      y caída al parser por reglas si falla o tarda > 4 s.
- [x] La salida nunca inventa SKUs ni precios: todo ítem se valida contra el catálogo.
- [x] UI: botón push-to-talk (Web Speech API `es-MX`), carrito editable, teclado de respaldo.
- [x] Batería de 10 frases de prueba: ≥ 9 carritos correctos con el parser por reglas.

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

### Stretch

- [x] Soundbox (T3a) en `/soundbox?terminal=rosa-01`: Android viejo en kiosko que anuncia en voz alta
      solo pagos capturados por el servidor (una captura de pantalla falsa no suena); QR en reposo,
      Wake Lock, pantalla completa, reconexión SSE con backoff, sin re-anuncios; instalable (manifest + SW).
- [x] Foto del menú → catálogo en `/backoffice` (panel «Menú»): Claude vision propone productos
      (imagen = datos no confiables, salida validada con zod, nunca se guarda sola); la vendedora
      revisa/edita y guarda con `PUT /api/backoffice/catalog` (SKUs generados, auditado). Sin
      `ANTHROPIC_API_KEY` → 503 y captura manual; el parser de voz usa el catálogo nuevo al instante.
- [x] Pasaporte de ventas firmado: panel «Pasaporte de ventas» en `/backoffice` genera un reporte
      (rango, por defecto 30 días) solo con ventas PayPal capturadas, devoluciones restadas y el
      efectivo aparte como «declarado»; JSON canónico firmado con Ed25519 (`PASSPORT_SIGNING_KEY`
      o llave demo efímera). `/verify#<payload>` público verifica en el navegador (WebCrypto,
      respaldo `POST /api/passport/verify`); cambiar un número lo vuelve INVÁLIDO.
- [x] Pagos a proveedores (Payouts v1, categoría «Money Movement»): panel «Proveedores y pagos» en
      `/backoffice` con allowlist persistida (alta/baja con PIN, auditada), pago con PIN por el cerrojo
      (tope por pago y por día por moneda; MXN 300/500), historial con estado (webhooks
      `PAYMENT.PAYOUTSBATCH.*` / `PAYMENT.PAYOUTS-ITEM.*` y botón actualizar), sección aparte en el
      libro del día. El agente solo propone (`propose_payout`); ejecutar exige el PIN en la UI.

### Checkout: Venmo, Pay Later y tarjeta (`feat/venmo-paylater`)

- [x] `/pay/:saleId` en sandbox usa el JS SDK v6 (`web-sdk/v6/core`) con el `clientId` de
      `/api/config`; la orden la crea y la captura el servidor (endpoints sin cambios).
- [x] Botones en este orden y solo si aplican: PayPal, Venmo, Pay Later, tarjeta. Primero una regla
      estática por moneda de la venta (`shared/funding.ts`: Venmo solo USD; Pay Later solo
      USD/CAD/GBP/EUR/AUD), luego `findEligibleMethods` del SDK decide por comprador.
- [x] Mensaje de Pay Later bajo el total solo si Pay Later quedó elegible.
- [x] Modo mock sin cambios («Pagar (simulado)», «Simular rechazo»); e2e verde.
- [x] Textos en/es, grupo de botones con nombre accesible, sin scroll horizontal a 375 px.
- [x] Tests: unidad de la selección por moneda; e2e que lee `data-funding` (USD incluye venmo y
      paylater; MXN no incluye venmo).

### Botones Apple Pay / Google Pay (`feat/wallet-buttons`)

Hoy `RAIL_APPLE_PAY` / `RAIL_GOOGLE_PAY` solo anuncian el riel. Se montan los botones nativos con el
SDK v6 (`applepay-payments`, `googlepay-payments`; API tomada de
`paypal-examples/v6-web-sdk-sample-integration`, leída 2026-10-07).

- [x] Cada botón aparece solo si el riel está activo **y** el navegador es elegible:
      `ApplePaySession.canMakePayments()` / `PaymentsClient.isReadyToPay().result` **y**
      `findEligibleMethods().isEligible("applepay"|"googlepay")`. Si no, no hay botón (oculto).
- [x] Usa el pedido que el servidor ya creó (`sale.orderId`): `confirmOrder` del SDK y luego
      `POST /api/sales/:id/capture`. Nada queda `paid` sin la captura PayPal (misma ruta que hoy).
- [x] Modo mock (sin llaves): sin botones de wallet, sin cargar scripts de Apple/Google; los botones
      simulados siguen igual. Si un script falla, se ocultan los wallets y PayPal sigue.
- [x] `GET /.well-known/apple-developer-merchantid-domain-association` sirve
      `APPLE_PAY_DOMAIN_ASSOCIATION` tal cual (text/plain); sin la variable, 404.
- [x] Tests: unidad de elegibilidad y de los pedidos Apple/Google; ruta `.well-known`; e2e en mock
      sin contenedor de wallets.

## Fuera de alcance hasta que los bloques 0–5 corran

Soundbox (ESP32/Android kiosko), tap teléfono-a-teléfono (HCE), AG Grid, foto del menú → catálogo,
pasaporte de ventas firmado, Payouts.

## Pendiente (revisado 2026-10-07)

Bloques 0–5 y los stretch Soundbox (T3a), AG Grid, foto del menú y pasaporte están hechos y en `main`.
Verificado en Render con el sandbox real: pago capturado, webhooks entregados, reembolsos de 1 y 150
aceptados, 250 rechazado por el tope.

| # | Pendiente | Origen | Criterio de aceptación |
|---|---|---|---|
| 1 | UI/UX web: pasada de diseño completa sobre todas las pantallas (jerarquía, estados vacíos, errores, onboarding) | Usuario | Revisión pantalla por pantalla a 375 px y 1280 px, claro/oscuro, en/es; e2e verde |
| 2 | App móvil nativa iOS + Android (Expo SDK 57, `mobile/`): **en progreso** — venta, PAGADO, bocina, NFC sticker, HCE Android y administración implementados; typecheck, lint, jest, expo-doctor, export Android y prebuild Android verdes. Falta: compilar dev client y probar en dispositivos reales (EAS para iOS) | BRAINSTORM §4, §7 | Un iPhone y un Android leen el tag emulado (HCE solo en Android; iOS no puede emular) y abren `/t/:terminal`; ver `mobile/README.md` |
| 3 | Persistencia: hoy todo vive en memoria y se pierde en cada reinicio o sueño de Render | Riesgo de demo | Ventas, catálogo y auditoría sobreviven a un reinicio — código en `feat/persistence` (PostgresStore); ⏳ falta `DATABASE_URL` de Neon en Render |
| 4 | Pruebas en dispositivos reales: sticker NTAG, voz en el mercado, soundbox en Android viejo | BRAINSTORM §9 | Un tap real en un sticker paga una orden sandbox y el teléfono habla |
| 5 | Payouts a proveedores — **hecho en `feat/payouts`** (sandbox con Payouts activo: el token trae el scope; falta un pago real a una cuenta personal sandbox) | Stretch | Pago a proveedor en allowlist, con PIN y tope, o propuesta firmada sin ejecutar |
| 6 | Soundbox ESP32 (T3b) | Stretch | Opcional; solo con 1–5 cerrados |
| 7 | Validación con personas: 3 entrevistas a vendedores; 10 ventas dictadas por otra persona (≥ 9 carritos correctos); alguien externo corre `/judge` desde un navegador limpio | BRAINSTORM §6.1, §9 | Notas en `docs/memoria.md` |
| 8 | Entrega: video < 3 min en inglés en dispositivos reales, repo público sin secretos ni docs privados, texto de Devpost, deploy vivo hasta el 15-dic | Reglas del hackathon | Envío antes del 12-nov 12:00 PT |
