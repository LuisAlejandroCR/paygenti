<!-- docs/memoria.md: bitácora de paygent — decisiones tomadas, por qué, y qué pasó en cada bloque.
     No es la spec (docs/plan.md, criterios de aceptación) ni la portada (README.md).
     Entradas nuevas arriba, fechadas; nunca se reescribe una entrada vieja, se corrige con otra. -->

# Memoria — paygent

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
