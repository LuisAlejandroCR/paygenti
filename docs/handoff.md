<!-- docs/handoff.md: punto de arranque para un chat nuevo — estado de main, qué falta y en qué orden.
     No es la spec (docs/plan.md, criterios de aceptación) ni la bitácora de decisiones (docs/memoria.md).
     Se sobrescribe completo en cada traspaso; lo histórico vive en memoria y en git log. -->

# Traspaso — paygent (2026-10-07)

## Cómo arrancar

1. Lee en este orden: este archivo → `docs/plan.md` (sección Pendiente) → `docs/memoria.md` (entradas de arriba).
2. `npm ci && npm run check` (biome + tsc + vitest, ~20 s). E2E: `npm run e2e`.
3. Sin ninguna key, la app corre en modo mock; `/api/health` dice el modo de cada tercero.

## Estado de `main`

Todo lo de abajo está mergeado con CI verde (check, e2e, mobile):

| PR | Qué |
|---|---|
| #28 | Terceros plug-and-play: `server/integrations.ts`; un tercero roto o sin config cae a su respaldo sin tumbar el arranque |
| #29 | PayPal Server SDK (`@paypal/paypal-server-sdk` 2.5.0) para OAuth, órdenes, captura y reembolsos; facturas, payouts y webhooks siguen con fetch |
| #30 | Rieles de pago: Pix, SPEI, Bre-B (`pending_bank` → `vendor_confirmed` con PIN, nunca `paid`); Apple Pay, Google Pay y OXXO vía PayPal |
| #31 | Varios paygents por dueño: PIN, topes y bandeja por puesto; selector web y móvil; conector MCP en `/mcp` (Claude solo propone reembolsos y payouts) |
| #32 | Huella financiera en el pasaporte + importación de estados de cuenta CSV/OFX (solo agregados mensuales, "autodeclarado") |
| #33 | Accesibilidad WCAG 2.2 AA: axe en e2e, modo voz, alto contraste, +5 min, lector de pantalla en móvil |

Migraciones Postgres: v3 = huella (`statement_months`, `savings_goals`), v4 = puestos (`vendor_id`,
`pin_states`, `mcp_tokens`, `approvals`).

## Qué falta (en orden)

### Acciones del usuario (no las puede hacer un agente)

1. **Render → `DATABASE_URL`** de Neon. Sin esto, Render olvida todo al dormir.
2. **Render → `STALL_PINS`** (ej. `beto:XXXX`). Sin esto, Don Beto usa el PIN demo 5678.
3. **Payout real en sandbox**: `/backoffice` → Proveedores → email de la cuenta Personal sandbox → 10 MXN con PIN.
4. **Probar `/mcp` con un cliente Claude real** (token desde "Claude access" en el back office).
5. **Limpiar worktrees viejos y vacíos** (el clasificador bloqueó borrarlos):
   `for d in pg-a11y pg-multi pg-rails pg-sdk; do git worktree remove --force ../$d; done`
   y los de `.claude/worktrees/agent-*` ya mergeados.

### Decisiones abiertas

6. **Parsers de Yape de Luca** (MIT, Copyright (c) 2026 Joseph Robles, `github.com/JosephRobles23/luca`).
   Opciones: "yape sí" (riel Yape + parser como ayuda del PIN + créditos), "solo transferencias"
   (no contar transferencias P2P/internas como ingreso en la importación) o "no".
   Si se usa: cabecera de atribución en el archivo, `THIRD_PARTY_NOTICES.md` con el MIT completo,
   línea en README. Bloqueo: PEN no es moneda PayPal, así que una venta Yape aún no puede existir;
   el nombre del pagador debe descartarse al parsear.

### Huecos conocidos de lo ya mergeado

7. Importación de estados: suma toda entrada como ingreso (no separa transferencias internas).
8. Rieles: Apple Pay / Google Pay / OXXO solo se listan; faltan sus botones del JS SDK v6 y el
   registro de dominio de Apple Pay. Bre-B nunca se ofrece (COP no es moneda PayPal). Panel de
   rieles sin probar en navegador.
9. MCP: solo JSON (sin stream ni session id); no hay pantalla para crear puestos; la app web de
   cobro (`/`) elige terminal por `?terminal=`, el selector solo cambia el back office.
10. SDK de PayPal: depende de `unstable_httpClientOptions`; probado solo con stubs/mock, no contra
    el sandbox real. `@paypal/agent-toolkit` trae su propia copia 1.1.0 del SDK.
11. Accesibilidad: comandos de voz no funcionan en Firefox; modo voz solo en la pantalla de venta;
    móvil sin "+5 min" ni comandos de voz; sin pruebas con vendedoras ciegas.
12. Jest de `mobile/` no encuentra tests cuando el repo está bajo `.claude/` (worktrees en Windows).

### Del plan (sin cambios)

13. Pruebas en dispositivos reales (sticker NTAG, HCE Android, EAS para iOS).
14. Validación con personas (3 entrevistas, 10 ventas dictadas, jurado externo en `/judge`).
15. Entrega del hackathon: video < 3 min en inglés, repo público sin secretos ni docs privados,
    Devpost, deploy vivo hasta el 15-dic. **Envío antes del 12-nov 12:00 PT.**
    Ojo: el repo hoy aparece **privado**.

## Reglas que un chat nuevo debe respetar

- Nada queda `paid` sin confirmación del proveedor de pagos. Lo confirmado por la vendedora o
  importado es "autodeclarado, no verificado" y nunca se suma a lo verificado.
- La IA propone; reembolsos y payouts solo con el PIN del puesto dueño.
- Commits: una línea, Conventional Commits, inglés, sin cuerpo ni trailers.
- Cabeceras: código `// <archivo>: <qué hace>`; `.md` con comentario HTML en español de 3–4 líneas.
- Los PR los mergea el usuario (el clasificador bloquea mergear sin revisión).
