<!-- docs/memoria.md: bitácora de paygent — decisiones tomadas, por qué, y qué pasó en cada bloque.
     No es la spec (docs/plan.md, criterios de aceptación) ni la portada (README.md).
     Entradas nuevas arriba, fechadas; nunca se reescribe una entrada vieja, se corrige con otra. -->

# Memoria — paygent

## 2026-11-12 — Caja de voz: firmware Arduino y endpoint de voz por terminal

- Firmware **Arduino propio** en vez de XiaoZhi, ESP-IDF o ESPHome: con el cierre a horas, era lo único
  que llegaba a una toma real, y habla HTTP directo con paygent.
- `POST /api/terminals/:id/voice` acepta `audio/*` (transcribe) o JSON `{ text }` (caja virtual). Si la
  frase trae una cifra, cobra ese monto en la moneda del puesto; si no, usa el parser del catálogo; si
  nada sirve, `intent: "unknown"` sin crear venta. Sin token `pgd_` todavía (abierto como `/sales`).
- La pantalla resultó horizontal de fábrica (tipo ILI9342): se descubrió probando las cuatro rotaciones
  y luego los volteos de `MADCTL` en el aparato; queda `0xE8` con tamaño lógico 240×320.
- STT por OpenRouter (`openai/whisper-1`) reusando el transcriptor compatible con Whisper.
- La bitácora del hardware (#48), el estudio de modelos (#47) y sus diagramas se habían mergeado en
  cadena entre ramas de docs y nunca llegaron a `main`; entran con este PR.

## 2026-11-10 — Pendientes de código cerrados antes del hardware

- Libro del día: si la vendedora cambiaba de moneda ese día, `sales-today`, `ledger` y el cuadre sumaban
  centavos de MXN y USD bajo la moneda nueva. Ahora los totales cubren solo la moneda actual y el resto sale en
  `others` (por moneda, nunca convertido); web y móvil lo muestran como línea aparte.
- Móvil, Resumen: de hasta 62 llamadas a 2 con `GET .../backoffice/ledger-range?from&to` (≤ 32 días, cortado
  en el "hoy" del puesto, que también devuelve). El día ya no sale del reloj del teléfono.
- `/` sin `?terminal=` abre la primera terminal del puesto elegido en el back office (antes siempre Rosa).
- `CORS_ORIGINS`: orígenes exactos que pueden llamar a `/api/*` desde el navegador (el dashboard desplegado
  aparte). Sin credenciales (todo es bearer). Sin la variable no se manda ningún header CORS.
- Quedan para el usuario o como decisión: DB y PINs en Render, EAS, pruebas en dispositivos, repo público,
  Bre-B automático, despliegue del dashboard, Yape, tokens verificado/autodeclarado en web y móvil.

## 2026-11-10 — Cobrar, cancelar y extender piden un dispositivo desbloqueado

- Problema: `POST /api/terminals/:id/sales`, `/api/sales/:id/cancel` y `/extend` eran públicos. Cualquiera
  con la URL podía abrir un cobro en el sticker de un puesto o cancelar la venta que su cliente estaba por
  pagar. No desviaba dinero, pero podía sabotear la demo en vivo.
- Decisión: token de dispositivo firmado (HMAC-SHA256 sobre puesto y vencimiento, 7 días) que se pide con el
  PIN del puesto en `POST /api/terminals/:id/unlock` (comparte el bloqueo del PIN). Solo cobra para ese
  puesto: no abre libro, reembolsos ni payouts. Sin estado en servidor, así que sobrevive a un reinicio
  si `DEVICE_TOKEN_SECRET` existe (`render.yaml` lo genera). También vale una sesión viva del back office
  del mismo puesto (dashboard, back office del móvil). Por qué no la sesión del back office en el mostrador:
  dejaría el libro abierto 8 h en un teléfono que ve cualquiera.
- Clientes: la pantalla web y el móvil muestran una tarjeta de PIN en lugar del teclado; un token rechazado
  la vuelve a mostrar. Web en `localStorage` (`paygent.device.<terminal>`); móvil en AsyncStorage por
  servidor y terminal. El dashboard manda su sesión. El cliente (checkout, rieles, captura) sigue público.
- `CHARGE_AUTH=off` existe solo para pruebas locales. `createApp` lo trae encendido por defecto; los tests
  viejos que no prueban esto lo apagan, `test/charge-auth.test.ts` y `e2e/unlock.spec.ts` lo prueban encendido.
- ⏳ `/judge` ahora pide el PIN demo una vez en el panel de la vendedora: decirlo en Devpost (ya está en
  `docs/submission.md`) y en el video. ⏳ Móvil sin probar en dispositivo.

## 2026-11-10 — El bloqueo del PIN ya no confía en X-Forwarded-For

- Problema: `clientIp()` tomaba la primera entrada de `X-Forwarded-For`, que escribe el cliente (Render la
  agrega al final, no la reemplaza). Rotando ese header un atacante tenía intentos nuevos sin fin por
  "IP", podía bloquear a la vendedora poniendo su IP, y el freno global fijo de 5 min le dejaba ~50
  intentos cada 20 min: un PIN de 4 dígitos caía en ~33 h de promedio, con el deploy vivo hasta el 15-dic.
  Con el PIN: reembolsos y alta de un proveedor propio para payouts (tope 500 MXN/día).
- Arreglo: por defecto solo cuenta la dirección del socket. `TRUSTED_IP_HEADER` (un header de una IP que
  el borde reescribe) o `TRUST_PROXY_HOPS` (cuenta desde la derecha) lo abren; valores que no parecen IP
  se ignoran. El freno global ahora se duplica (5 min → 1 h) hasta el PIN correcto y se persiste.
- e2e: el servidor de Playwright confía solo en `x-e2e-client-ip`; un `X-Forwarded-For` falso sigue en 429.
- ⏳ Falta verificar en Render qué header trae la IP real (`true-client-ip` / `cf-connecting-ip` o el
  número de saltos) y ponerlo; sin eso, todos los clientes comparten una llave de bloqueo.
- Sin arreglar (decisión de diseño): crear, cancelar y extender ventas no piden autenticación; cualquiera
  puede cancelar el cobro abierto de un puesto o abrir uno en su terminal. No desvía dinero, pero puede
  sabotear una demo en vivo.

## 2026-10-14 — Paleta "Cempasúchil" reemplaza a "Merlot Dream"

- Problema: el vino de Cobrar y el rojo destructivo medían ΔE 0.064 (OKLab), es decir, se leían como un solo
  color; "Pagado rechazado" y "Nueva venta" se veían igual. Además `--success` y `--paypal` caían fuera de sRGB.
- Se compararon cinco paletas con rojo y vino como núcleo (Merlot Dream, Chile de Árbol, Cempasúchil, Barro
  Rojo, Pizarra y Vino) sobre capturas reales de la app, con 118 pares de contraste WCAG y simulación de
  daltonismo (Machado 2009). Elegida: Cempasúchil (ΔE vino/rojo 0.175, 0 fallas de contraste).
- Cambios: vino de acción más profundo `oklch(0.39 0.14 6)`, rojo destructivo `oklch(0.54 0.2 29)`, PAGADO y
  verificado en añil `oklch(0.51 0.09 185)` (se distingue del vino con daltonismo rojo-verde), azul PayPal
  de marca. En el dashboard oscuro la tarjeta del mes pasa de vino a rosa con texto oscuro.
- Se cambiaron las tres copias en el mismo PR: `web/src/styles.css`, `paygent-dashboard/src/styles.css` y
  `mobile/src/lib/theme.ts` (hex calculados desde los oklch), más el ícono adaptativo de Android.
- ⏳ El móvil no se probó en dispositivo con la paleta nueva.

## 2026-10-14 — Pasada de UI/UX del dashboard (#43)

- Cobrar en vivo ya no simula: crea la venta en la terminal del puesto y solo muestra "Pagado" cuando el
  servidor reporta la captura de PayPal; en Sandbox la simulación queda rotulada. Probado de punta a punta
  con PayPal mock.
- Auditoría Playwright + axe (8 modos, mock y vivo): axe serias/críticas 172→0 (mock) y 84→0 (vivo), foco
  devuelto en todos los diálogos, sin desborde a 375 px.
- Estados nuevos: servidor caído, sin puestos, mes sin ventas, PIN bloqueado (429) y sin conexión.
- Token nuevo `--primary-text` y alias `--rail-ink`. CI: job `dashboard` (lint, test, build).
- Pendiente: la hora del paso "pagado" en el detalle es inventada; el encabezado dice "EN VIVO" con el
  servidor caído.

## 2026-10-14 — Pasada de UI/UX web (#42)

- Harness `npm run ux:audit` (scripts/ux-audit.ts): 35 pantallas × 8 modos (375/1280 × claro/oscuro ×
  en/es), axe, overflow, objetivos <44 px y consola; salida en ux-shots/ (no versionada).
- Acciones destructivas (devolver, quitar proveedor, borrar estado de cuenta, revocar token, simular
  rechazo) usan botón contorneado + ícono + verbo y se confirman en línea junto a su elemento: la
  diferencia con Cobrar no depende del color.
- Ventas de hoy pasa de tabla a lista apilada; cabeceras sin cortes a media palabra; estados vacíos y de
  error con siguiente paso.
- Resultado: check y e2e verdes (158/158); 0 axe serias/críticas, 0 overflow a 375 px. ⏳ Sin prueba en
  dispositivo real ni lector de pantalla.

## 2026-10-14 — Revisión de documentación

- Desactualizado: `docs/handoff.md` era del 2026-10-07 y no tenía #34–#40; la tabla Pendiente de
  `docs/plan.md` decía "hecho en <rama>" para trabajo ya mergeado, saltaba la fila 10 y la arquitectura
  decía persistencia en memoria, sin dashboard ni móvil. El README no tenía arquitectura, ni cómo correr
  dashboard y móvil, y a su tabla de variables le faltaban `PAYPAL_API_URL`, `STT_URL`, `STT_MODEL`,
  `STT_MOCK_TRANSCRIPT` como filas, los rieles, `APPLE_PAY_DOMAIN_ASSOCIATION`, `VITE_PAYGENT_API` y
  `EXPO_PUBLIC_API_URL`. `paygent-dashboard/README.md` era el texto de Lovable. `mobile/README.md` pedía
  llenar `ascAppId`/`appleTeamId` (ya están desde #25). `docs/accessibility.md` decía que Firefox no
  tenía dictado (#37 lo resolvió).
- Agregado: `docs/design.md` (tokens "Merlot Dream" de las tres copias, reglas de color, tamaños táctiles,
  movimiento, texto grande) y `docs/submission.md` (borrador en inglés: Devpost, guion del video,
  checklist). Plan: filas 11→10, 12→11, 13→12 sin tocar criterios; `docs/bank-confirm.md` apunta a la
  #11. `paygent-dashboard/roadmap.md` (dos casillas marcadas) se fusionó en su README y se borró.
- Hallazgos al leer el código:
  - En el dashboard, "Cobrar" es una simulación también en modo real: marca "pagado" a los 3,5 s sin
    llamar al servidor (`Overlays.tsx`). Contradice "nada queda pagado sin PayPal" en pantalla; no se
    tocó el código.
  - `--primary` significa cosas distintas en la web (texto) y en el dashboard (vino). Los tokens
    verificado/autodeclarado solo existen en el dashboard. `--warning` difiere entre web y dashboard.
  - `render.yaml` y `.env.example` no declaran `STALL_PINS` ni `STT_*`. No se tocaron: esta revisión
    solo cambia `.md`.
  - `/api/health` del deploy (2026-10-14): `database: off`, `speech-to-text: off`, `passport: on`.
    El repo sigue privado.
- Pendiente del dueño (detalle en `docs/handoff.md`): `DATABASE_URL` en Render, decisión de paleta, qué
  docs salen del repo público, video y entrevistas, pruebas en dispositivos.
- El contenido de `LEARNINGS.md` (privado, raíz del checkout principal, sin seguimiento en git) se
  redactó desde esta memoria y `git log`; nunca se versiona.

## 2026-10-07 — Confirmación bancaria: canales elegidos

- Corrige la entrada de abajo: el reenvío no se puede crear por API en cuentas @gmail.com
  (`forwardingAddresses.create` es solo para Workspace con delegación de dominio).
- Elegido: Gmail solo lectura para el hackathon (≤ 100 usuarios de prueba), notificación de Nequi en
  Android y reenvío manual a Resend Inbound en iPhone. Sin Clerk: Paygent no tiene login propio.
- Muestras reales: solo "Recibiste plata por Bre-B" de Nequi confirma ventas; el comprobante de Banco de
  Bogotá es de quien envía. Los PDF tienen datos personales: `*.pdf` en `.gitignore`.

## 2026-10-07 — Confirmación bancaria automática (spec, `docs/bank-confirm.md`)

- El usuario pidió confirmar Bre-B sin PIN usando los avisos del banco: correo de Banco de Bogotá
  ("Comprobante de Transferencia") y de Nequi ("Recibiste plata por Bre-B").
- Sin fricción: Google sign-in crea el reenvío y el filtro por la API de Gmail; Paygent se autoverifica la
  dirección. Se descartó leer el buzón entero (más permiso del necesario).
- En Android, opcional: leer la notificación de la app del banco con `NotificationListenerService`. iOS no
  lo permite.
- Estado nuevo `bank_confirmed`, nunca `paid`; solo con una coincidencia única por monto en 30 min.
- ⏳ Faltan muestras reales de cada banco y confirmar la clasificación de los permisos de Gmail.

## 2026-10-07 — Resumen y Perfil en la app móvil (`feat/mobile-dashboard`)

- Del panel web (`paygent-dashboard/`, rama `feat/dashboard`) solo pasa al teléfono lo que la
  vendedora usa parada en el puesto: `mobile/app/resumen.tsx` (tarjeta vino del mes con verificado
  grande, autodeclarado y por confirmar aparte, delta vs mes anterior al mismo día, pastillas
  Cobrar / Confirmar transferencia / Reembolso, tira de días, transferencias por confirmar con PIN)
  y `mobile/app/perfil.tsx` (cambio de puesto y enlaces a ajustes, configurar puesto y
  administración). Metas, rieles, AG Grid, gráficas e importar estado de cuenta quedan solo en web.
- Datos reales, sin endpoints nuevos: el mes se arma con `GET <bo>/ledger?date=` día por día (≤ 62
  llamadas, 4 a la vez) y confirmar usa `POST /api/sales/:id/vendor-confirm` con el PIN del puesto.
  Reembolso abre la administración existente (PIN ahí). Matemática pura en `mobile/src/lib/summary.ts`:
  verificado = PayPal pagado − reembolsado; autodeclarado = efectivo + `vendor_confirmed`;
  `pending_bank` va a "por confirmar" y nunca suma como pagado. El ledger no trae nombres de pagador.
- Límite: el día se calcula con el reloj del teléfono, el servidor con la zona del puesto; cerca de
  medianoche puede faltar o sobrar un día. Un endpoint mensual ahorraría las llamadas (pendiente).
- jest móvil no encuentra pruebas bajo `.claude/` (worktree): se corrió copiando `mobile/` + `shared/`
  a un directorio temporal. ⏳ Sin probar en dispositivo real (TalkBack/VoiceOver, texto grande).

## 2026-10-07 — Dashboard web conectado al servidor (`feat/dashboard`)

- Ventas, Movimientos y Perfil (Rieles, Metas) rediseñados con el lenguaje de Resumen: banda vino
  con KPIs, tiles que filtran, gráficas antes que texto, íconos SVG. Sin scroll horizontal a 375 px.
- `paygent-dashboard/src/lib/adapter.ts` (puro, con vitest) mapea el JSON del servidor; `api.ts`
  lo usa si `VITE_PAYGENT_API` existe (`npm run dev:live` → proxy de Vite a `:8787`, porque el
  servidor no manda CORS). Sin la variable: mocks y el distintivo Sandbox.
- Real: `/api/stalls`, `POST …/backoffice/session` (el PIN abre sesión de 8 h por puesto),
  `…/ledger?date=` día por día (mes actual y anterior), `…/footprint` (estado de cuenta como
  autodeclarado y la meta), `PUT …/savings-goal`, `…/refunds`, `…/suppliers` + `…/payouts`,
  `…/statement`, `…/approvals` como avisos y `/api/sales/:id/vendor-confirm`.
- Sigue en mock (sin endpoint): métricas por riel (conversión, tiempo de confirmación) y el
  interruptor de rieles; nombre y fecha límite de metas (el servidor guarda una sola meta).
- Invariantes: verificado = PayPal capturado; efectivo, confirmado por la vendedora y estado de
  cuenta = autodeclarado; nunca se suman (se quitaron sumas en Resumen y el promedio 7 días);
  `pending_bank` nunca cuenta como pagado; el PIN viaja a reembolso, payout e importación.
- ⏳ Falta probar con ventas reales en el servidor (se verificó login y carga con ledger vacío).

## 2026-10-07 — Voz en Firefox (`feat/voice-firefox`)

- Firefox no trae `SpeechRecognition`. Respaldo: `web/src/stt.ts` elige `native` → `record`
  (`MediaRecorder` + `POST /api/voice/transcribe`) → `none`. El servidor no tenía speech-to-text
  (Claude no recibe audio), así que se agregó `server/voice/transcribe.ts` como integración
  opcional `speech-to-text`: `STT_API_KEY` usa un endpoint compatible con Whisper (`STT_URL`,
  `STT_MODEL`, por defecto OpenAI `whisper-1`); `STT_MOCK_TRANSCRIPT` devuelve un texto fijo (e2e);
  sin config, 503 `TRANSCRIBE_UNAVAILABLE` y `/api/config` trae `transcribe: false`.
- Accesibilidad: el botón de mantener ahora responde a Espacio/Enter (antes solo puntero, fallaba
  WCAG 2.1.1); la nota de estado siempre está montada como `role="status"` para que se anuncie.
- e2e corre en Chromium ocultando `SpeechRecognition` y con micrófono falso (WebAudio): no hay
  navegador Firefox de Playwright instalado. ⏳ Probar en Firefox real con micrófono.

## 2026-10-07 — Botones Apple Pay / Google Pay (`feat/wallet-buttons`)

- API del SDK v6 tomada de `paypal-examples/v6-web-sdk-sample-integration` (leído 2026-10-07,
  `client/components/{applepay,googlepay}Payments/oneTimePayment`): componentes
  `applepay-payments` / `googlepay-payments`; `createApplePayOneTimePaymentSession()` con
  `formatConfigForPaymentRequest`, `validateMerchant({ validationUrl })`, `confirmOrder({ orderId,
  token, billingContact, shippingContact })`; `createGooglePayOneTimePaymentSession()` con
  `formatConfigForPaymentRequest` y `confirmOrder({ orderId, paymentMethodData })` → `{ status }`.
  Scripts: `applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js`, `pay.google.com/gp/p/js/pay.js`.
- Decisión: se reutiliza el pedido que el servidor creó con la venta; tras `confirmOrder` se llama
  a nuestro `/capture` y el wallet solo da éxito si la venta quedó `paid`. `PAYER_ACTION_REQUIRED`
  (3DS) no se captura: error y la venta sigue abierta. Sin elegibilidad, sin script o en mock: no
  hay botón y PayPal sigue.
- `APPLE_PAY_DOMAIN_ASSOCIATION` se sirve en `/.well-known/apple-developer-merchantid-domain-association`.
- ⏳ Sin probar en sandbox real ni en dispositivos (Safari/iPhone con Apple Pay, Chrome Android con
  Google Pay); falta registrar el dominio de Render en PayPal.

## 2026-10-07 — Transferencias entre cuentas propias (`fix/statement-internal-transfers`)

- El import sumaba todo abono como ingreso; mover dinero de ahorro a cheques inflaba la huella.
- Detector conservador en `server/statement.ts`: (1) concepto/NAME/MEMO con frases de cuenta propia
  (traspaso, entre cuentas, cuenta propia, entre contas, mesma titularidade, own account, internal
  transfer…), sin acentos; (2) abono compensado por un cargo del mismo monto y moneda en **otra**
  cuenta del mismo archivo (bloques STMTRS del OFX) a ≤ 3 días. En una sola cuenta no se emparejan
  cargo y abono iguales: es común vender y pagar al proveedor el mismo monto.
- `TRNTYPE XFER` solo no excluye: Pix/SPEI de clientes llegan así. Mejor contar de más un traspaso
  sin concepto que borrar una venta real. Se reporta `ownAccountMoves {count, totals}`; el concepto
  se lee y se descarta, nunca se guarda.

## 2026-10-07 — Ola de PRs #28–#33 y traspaso

- Terceros plug-and-play (#28): un `DATABASE_URL` inalcanzable o un `PASSPORT_SIGNING_KEY` inválido
  tumbaban el arranque; ahora caen a su respaldo. `/api/health` muestra solo modos, no el error
  (ruta pública). Costo aceptado: si Postgres cae al arrancar, los topes diarios viven en memoria.
- Huella financiera (#32): indicadores, nunca un puntaje; el import bancario es "autodeclarado".
- Al rebasear #31 sobre #30 apareció un hueco: el PIN de cualquier puesto confirmaba ventas SPEI/Pix
  de otro. Ahora `vendor-confirm` usa el PIN del puesto dueño de la venta (test en `rails.test.ts`).
- #31 y #32 traían ambos la migración v3: la de puestos pasó a v4.
- GitHub devolvió 500 en push y en crear PR ~15:06–15:20; se resolvió solo.
- Estado y pendientes para un chat nuevo: `docs/handoff.md`.

## 2026-10-07 — Rieles de pago (`feat/payment-rails-v2`)

- Investigación y fuentes en `docs/payment-rails.md`. Registro en `shared/rails.ts`: cada riel se
  activa por env (`PIX_KEY`, `SPEI_CLABE`, `BREB_KEY`, `RAIL_APPLE_PAY`, `RAIL_GOOGLE_PAY`,
  `RAIL_OXXO`); sin config, no aparece. CLABE inválida = riel oculto.
- Invariante: solo `markPaid` (captura PayPal o webhook verificado) pone `paid`. Pix/SPEI/Bre-B
  pasan a `pending_bank` (ventana de 30 min) y, con el PIN de la vendedora, a `vendor_confirmed`:
  fuera de `paid`/`net` del ledger (`totals.unverified`) y en `selfReported.vendorConfirmed` del
  pasaporte. `method` guarda el riel; columnas text en Postgres, sin migración.
- ⏳ Apple Pay / Google Pay / OXXO solo se anuncian y van por el pedido PayPal; no se montan sus
  botones nativos del SDK v6 (requiere registro de dominio). ⏳ Bre-B no se ofrece nunca hoy: COP no
  es moneda PayPal, así que no existen ventas en COP.

## 2026-10-07 — Pagos a proveedores (`feat/payouts`)

- Hechos verificados (leídos 2026-10-07):
  - https://developer.paypal.com/api/payments.payouts-batch/v1/schema.json (spec OpenAPI de
    https://developer.paypal.com/docs/api/payments.payouts-batch/v1/): `POST /v1/payments/payouts`
    con `sender_batch_header` (`sender_batch_id`, `recipient_type`, `email_subject`,
    `email_message`) e `items[]` (`recipient_type` EMAIL | PHONE | PAYPAL_ID, `amount` =
    `{ value, currency }` — no `currency_code` —, `receiver`, `note`, `sender_item_id`).
    `PayPal-Request-Id` se guarda 30 días; un `sender_batch_id` usado en los últimos 30 días se
    rechaza; con un 5xx se puede reintentar con el mismo `sender_batch_id`. `batch_status`:
    DENIED | PENDING | PROCESSING | SUCCESS | CANCELED; `transaction_status` del ítem: SUCCESS |
    FAILED | PENDING | UNCLAIMED | RETURNED | ONHOLD | BLOCKED | REFUNDED | REVERSED. Sin permiso:
    403 `NOT_AUTHORIZED`; también existe `REQUIRED_SCOPE_MISSING`. **El sandbox no admite PHONE.**
  - https://developer.paypal.com/api/rest/webhooks/event-names/: `PAYMENT.PAYOUTSBATCH.DENIED`,
    `.PROCESSING`, `.SUCCESS`; `PAYMENT.PAYOUTS-ITEM.BLOCKED`, `.CANCELED`, `.FAILED`, `.HELD`,
    `.REFUNDED`, `.RETURNED`, `.SUCCEEDED`, `.UNCLAIMED`.
  - https://developer.paypal.com/docs/payouts/standard/: en live hay que pedir acceso a Payouts y
    fondear el saldo; se paga con saldo PayPal.
- Sandbox real (2026-10-07, solo lectura, sin mover dinero): el token OAuth de la app trae el scope
  `https://uri.paypal.com/payments/payouts` y `GET /v1/payments/payouts/<id falso>` responde 404
  `INVALID_RESOURCE_ID`, no 403: **Payouts está activo**. No se hizo un pago real porque no hay
  registrada una cuenta personal sandbox; ⏳ hacer uno pequeño desde `/backoffice` con esa cuenta.
- Gateway: `createPayout` / `getPayout` en `PayPalGateway`. `RestPayPal` manda `sender_batch_id`
  = `PayPal-Request-Id` = id del pago; 403 o `NOT_AUTHORIZED` / `AUTHORIZATION_ERROR` /
  `REQUIRED_SCOPE_MISSING` se traducen a `PAYOUTS_NOT_ENABLED` (la UI lo explica). `MockPayPal`:
  PENDING al crear, SUCCESS al primer GET; un receptor con «denied» queda DENIED.
- Cerrojo: nuevo tope **por pago** = 60 % del tope diario (MXN 300 de 500; USD 15 de 25). El diario
  no cambió. Alta/baja de proveedor es una acción del cerrojo (`kind: "supplier"`): vendedora + PIN,
  auditada. La allowlist sale de la tabla `suppliers` (`setPayoutAllowlist`), no de la config. El
  proveedor guarda su moneda; si no es la de la cuenta, `CURRENCY_MISMATCH` (sin FX).
- Presupuesto: `commit` solo cuando PayPal acepta; `release` si lo rechaza (4xx). Si la respuesta se
  pierde (timeout, red, 5xx) el presupuesto **se queda gastado** y el pago queda `UNKNOWN`: puede
  existir, así que liberar el tope lo debilitaría. «Actualizar estado» reenvía el mismo
  `sender_batch_id` (idempotente) para recuperar el batch. Un pago luego DENIED no devuelve tope.
- IA: el agente tiene `list_suppliers` y `propose_payout` (zod estricto: si mete `pin` o
  `receiver` → `INVALID_INPUT`). `PolicyEngine.preview` evalúa «¿pasaría con PIN?» sin ticket y lo
  audita como `propose`. La UI rellena el formulario de pago y la vendedora teclea el PIN. Ninguna
  herramienta del modelo ejecuta pagos; batería de 8 ataques + 5 nuevos en la batería del cerrojo.
- Persistencia: migración 2 (`suppliers`, `payouts`). El `requestId` del cliente es el id del pago:
  un doble envío devuelve el primero. `/api/backoffice/config` ya no expone la allowlist.
- Libro del día: los pagos van en una sección aparte bajo AG Grid; los totales de ventas no cambian.

## 2026-10-07 — Checkout con Venmo, Pay Later y tarjeta: JS SDK v6 (`feat/venmo-paylater`)

- Hechos verificados (leídos 2026-10-07):
  - https://developer.paypal.com/v5-v6 — guía de migración: el ejemplo de v5 lleva el comentario
    «v5 (deprecated)»; v6 carga `https://www.paypal.com/web-sdk/v6/core` sin parámetros y se
    configura en `createInstance({ clientId, components, pageType })`. Sin fecha de fin para v5.
  - https://developer.paypal.com/sdk/js/set-up.md — sandbox `https://www.sandbox.paypal.com/web-sdk/v6/core`;
    el `clientId` basta para PayPal, tarjetas, Venmo y pagos únicos; el client token solo es
    obligatorio para Fastlane. https://developer.paypal.com/sdk/js/reference/ ya sirve la
    referencia v6 (v5 quedó como legado).
  - https://developer.paypal.com/docsai/payments/methods/paypal/sdk/js/v6/paypal-checkout — pago
    único con la orden creada y capturada en el servidor: `session.start({ presentationMode: "auto" },
    createOrderPromise)` con `{ orderId }`; `onApprove` trae `orderId`.
  - https://developer.paypal.com/venmo.md — Venmo: «US-based merchants and US-based consumers
    only», «Payment must be in USD»; componente `venmo-payments`, `<venmo-button>`.
    https://developer.paypal.com/docs/checkout/pay-with-venmo/ — móvil: Safari iOS o Chrome Android
    con la app; escritorio por QR.
  - https://developer.paypal.com/pay-later/overview — Pay Later solo en US/USD, CA/CAD, GB/GBP,
    DE/FR/IT/ES (EUR) y AU/AUD; México/MXN no aparece. https://developer.paypal.com/pay-later/integrate.md
    — mensaje `<paypal-message auto-bootstrap amount currency-code>` (componente `paypal-messages`);
    si el país o la moneda no aplica, no se pinta.
  - https://developer.paypal.com/cards/standalone-payment-button — tarjeta como invitado:
    componente `paypal-guest-payments`, `<paypal-basic-card-button>` dentro de
    `<paypal-basic-card-container>`. Esa página usa client token, pero el ejemplo oficial
    https://github.com/paypal-examples/v6-web-sdk-sample-integration (leído 2026-10-07) usa `clientId`, y los
    tipos de `@paypal/paypal-js@11.2.1` (`sdk-v6`) confirman `testBuyerCountry` y `locale` en
    `createInstance` y los nombres de `isEligible`: `paypal`, `venmo`, `paylater`, `card`.
  - Sandbox: v5 usaba `buyer-country` en la URL; en v6 es `testBuyerCountry` en `createInstance`
    («solo sandbox, nunca en producción»).
- Decisión: **migrar a v6**. Es la versión documentada y vigente, cubre pago único con
  crear/capturar en el servidor, usa el mismo `clientId` que ya expone `/api/config` (sin endpoint
  de client token, así que `server/paypal/*` no se tocó) y trae la elegibilidad explícita
  (`findEligibleMethods`) que este bloque necesita. La spec ya decía «JS SDK v6».
- Diseño: `shared/funding.ts` es la regla estática por moneda (PayPal siempre; Venmo solo USD; Pay
  Later solo USD/CAD/GBP/EUR/AUD; tarjeta en toda moneda PayPal) y fija el orden PayPal → Venmo →
  Pay Later → tarjeta. `web/src/paypal-sdk.ts` carga el script, pide solo los componentes que la
  moneda permite y monta los botones que además `findEligibleMethods({ currencyCode, amount })`
  aprueba. Si la elegibilidad falla, queda solo PayPal. En sandbox `testBuyerCountry` sale de la
  moneda (USD → US, MXN → MX, EUR → ES) o de `?buyerCountry=XX`. `data-funding` (candidatos) y
  `data-funding-shown` (montados) en `<main class="checkout">` sirven a e2e y depuración.
- Verificado en vivo (sandbox, 375 px, sin iniciar sesión en PayPal ni aprobar pagos): venta MXN →
  PayPal + tarjeta; venta USD (comprador US) → PayPal, Pay Later («Pay in 4 interest-free payments
  of $30.00» bajo el total) y tarjeta. Venmo no apareció: la API de elegibilidad del sandbox
  (`POST /v2/payments/find-eligible-methods`, comprador US, USD, UA móvil y escritorio) no lista
  `venmo` para esta app; o la cuenta comercial sandbox no es de EE. UU. o no tiene Venmo activado.
  Sin overflow horizontal; etiquetas del SDK en es/en según el idioma.
- Pendiente conocido: el mensaje de Pay Later sigue el país del comprador, no el idioma de la
  interfaz (sale en inglés para un comprador US aunque la página esté en español).

## 2026-10-06 — Persistencia en Postgres (`feat/persistence`)

- `PostgresStore` (`server/db/postgres.ts`) se elige si hay `DATABASE_URL`; si no, `MemoryStore`
  (tests, modo jurado sin setup). La interfaz `Store` sigue síncrona: el store carga todo a memoria al
  arrancar y escribe a Postgres por una cola ordenada, un job por transacción. Así no se tocó ningún
  caller (ni `server/backoffice/agent.ts`). Riesgo aceptado: una escritura en vuelo se pierde si el
  proceso muere sin SIGTERM; con SIGTERM (`index.ts`) la cola se vacía antes de salir.
- `Store` ahora también guarda lo del cerrojo: uso diario de topes (por día y moneda), reembolsos por
  captura (antes un `Map` en `BackOffice`), audit log y estado de bloqueo del PIN. Un reinicio ya no
  libera presupuesto de reembolso ni desbloquea el PIN.
- Atomicidad: decide/commit son síncronos en un proceso (sin carreras); en SQL los contadores son
  `INSERT … ON CONFLICT DO UPDATE SET x = x + EXCLUDED.x`, así dos procesos no pierden incrementos;
  índice único parcial en `sales.capture_id`. Las reservas (tickets de 5 min) siguen en memoria: un
  pago en vuelo muere con el proceso. Con más de una instancia el tope por instancia podría sumar;
  Render free corre una sola.
- Migraciones versionadas (`schema_migrations`) bajo `pg_advisory_xact_lock`. Dinero en minor units
  `bigint` + `char(3)`. Pool `pg` de 3, timeouts de conexión/consulta, SSL según `sslmode`.
- Tests: la misma suite de contrato corre contra `MemoryStore` y `PostgresStore` sobre PGlite
  (Postgres en WASM, sin Docker) con un adaptador `test/pglite.ts`; más reinicio, concurrencia del
  tope (12 reembolsos concurrentes, pasan 5 = 1,000 MXN) y dos stores incrementando el mismo contador.
  `pgClient` (pool real) no se probó contra un servidor: ⏳ verificar en el primer deploy con Neon.
- Proveedor (consultado 2026-10-06):
  - Render Postgres free: expira a los 30 días de creada, 14 días de gracia y luego se borra —
    https://render.com/docs/free . Descartado.
  - Supabase free: 500 MB, pausa tras 1 semana de inactividad — https://supabase.com/pricing .
    Riesgoso para un deploy que debe vivir hasta el 15-dic sin tráfico.
  - **Neon free (elegido)**: 1 GB por proyecto, 100 CU-h/mes, scale-to-zero a los 5 min, sin
    expiración ni borrado por inactividad documentados — https://neon.com/docs/introduction/plans .
  - No se creó ninguna cuenta: falta crear el proyecto Neon y poner `DATABASE_URL` en Render.

## 2026-10-06 — Moneda por vendedora y onboarding (`feat/onboarding-currency`)

- Hechos verificados (leídos 2026-10-06):
  - https://developer.paypal.com/reference/currency-codes/ — 24 monedas cobrables; sin decimales
    para PayPal: JPY, HUF, TWD; BRL, CNY y MYR solo para cuentas del propio país. En LATAM solo MXN y
    BRL; COP, ARS, CLP, PEN, etc. no existen en PayPal: esas vendedoras cobran en USD.
  - https://developer.paypal.com/docs/checkout/apm/crypto/ — "Pay with Crypto" solo para comercios
    de EE. UU. (cuenta Business verificada), liquida en la moneda principal de la cuenta, reembolsos
    en PYUSD; la doc no ofrece sandbox. Decisión: cripto se muestra como "próximamente" con su razón;
    no se finge.
- `shared/currency.ts`: tabla de países (LATAM primero) → moneda local, moneda de cobro y zona.
  `Money` respeta el exponente de cada moneda (¥950, no ¥950.00).
- `PUT /api/backoffice/vendor` (sesión de vendedora, zod, auditado). Los precios no se convierten
  (no hay fuente FX): se conservan en su valor facial y se pide revisarlos.
- Cerrojo: topes por moneda (MXN conserva 200/1,000/500; USD y EUR 10/50/25). Contadores por
  moneda; si hoy ya se movió dinero en otra moneda, el presupuesto de la nueva cuenta como gastado.
- Pendiente conocido: el libro del día suma en la moneda actual; un día con cambio de moneda mezcla
  montos.

## 2026-10-06 — Bloque 4: el cerrojo (`server/policy/`)

- `decide(action, context)` es puro y falla cerrado: acción, actor, monto o zona horaria raros →
  denegado con código (`POLICY_ERROR`, `MALFORMED_ACTION`, …). Las razones van en es-MX con el
  nombre de la vendedora porque se dicen en voz alta.
- Reembolso/pago: solo `vendor` con PIN verificado; `customer` → `CUSTOMER_NOT_AUTHORIZED`.
  Topes MXN: 200 por reembolso, 1 000 al día, solo capturas del mismo día local
  (America/Mexico_City); pagos solo a allowlist (vacía por defecto), 500 al día. Aceptar disputa:
  siempre denegado, lo decide la vendedora a mano.
- El PIN lo verifica el `PolicyEngine`, no el agente: hash con sal + `timingSafeEqual`, bloqueo de
  5 min tras 5 fallos. El log de auditoría quita cualquier campo con forma de PIN/secreto.
- Presupuesto en dos pasos: `decide` reserva con un ticket (las reservas pendientes cuentan contra
  el tope diario y contra el saldo de la captura, para que dos reembolsos simultáneos no se
  cuelen), `commit` lo consume cuando PayPal confirma, `release` lo libera si PayPal falla. Los
  tickets vencen a los 5 min. Contadores reinician a medianoche local.
- Batería de inyección: 20 propuestas hostiles (más de 50 intentos) → 0 permitidas.
- ⏳ Pendiente para quien cablee el agente: pasar `actor` desde la sesión del servidor, nunca desde
  la salida del modelo; y los contadores viven en memoria (un reinicio los pone en cero).

## 2026-10-06 — Bloque 3 (núcleo): voz → carrito en `server/voice/`

- Parser por reglas determinista (`rules.ts`): números en español hasta «veinte», dígitos, «media
  docena», «un par», «otro»; plurales por un stem crudo (quita `s` y luego `e`: «atoles» = «atole»);
  gana el alias/nombre más largo contenido en el fragmento; empate = ambiguo → `unmatched`.
- «con» y «más» no separan fragmentos (rompían «rajas con queso»); un número a mitad de frase sí abre
  fragmento nuevo («dos de dulce tres verdes»).
- Camino Claude (`llm.ts`): Messages API por `fetch` inyectable, sin SDK; herramienta forzada
  `set_cart`, salida validada con zod y filtrada contra el catálogo; el texto dictado va dentro de
  `<order>` con `<`/`>` neutralizados. `index.ts` cae a reglas ante error, timeout (4 s) o vacío.
- Batería: 12/12 con el parser por reglas. ⏳ Falta la ruta HTTP y la UI (después de Bloque 1).

## 2026-10-06 — Bloque 0: scaffold

- La idea viene del repo `paygenty` (BRAINSTORM.md, §6–§7). Se congela en `docs/plan.md` con seis
  bloques; cada bloque es un PR que pasa `npm run check` antes del merge.
- Decisiones abiertas del BRAINSTORM resueltas por defecto para no bloquear: persona en México (MXN),
  hardware T0/T1 (QR y sticker), sin HCE ni soundbox hasta cerrar la rebanada.
- `docs/` se versiona mientras el repo sea privado. ⏳ Antes de hacerlo público, decidir si `docs/`
  sale del repo (el procedimiento de documentación lo trata como privado).
- Sin keys todo corre contra `MockPayPal`: el jurado no necesita configurar nada.
