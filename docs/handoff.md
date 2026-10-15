<!-- docs/handoff.md: punto de arranque para un chat nuevo — estado de main, qué falta y en qué orden.
     No es la spec (docs/plan.md, criterios de aceptación) ni la bitácora de decisiones (docs/memoria.md).
     Se sobrescribe completo en cada traspaso; lo histórico vive en memoria y en git log. -->

# Traspaso — paygent (2026-10-14)

Entrega del hackathon: **12-nov-2026 12:00 PT** (15:00 en Bogotá; en noviembre rige PST). Hoy faltan 29 días.

## Cómo arrancar

1. Lee en este orden: este archivo → `docs/plan.md` (sección Pendiente) → `docs/memoria.md` (entradas de arriba).
2. `npm ci && npm run check` (biome + tsc + vitest). E2E: `npm run e2e` (Playwright, Chromium).
3. Sin ninguna key, la app corre en modo mock; `/api/health` dice el modo de cada tercero.
4. Dashboard: `cd paygent-dashboard && npm ci && npm test` (no corre en CI). Móvil: `cd mobile && npm ci && npm run check`.
5. Diseño y tokens: `docs/design.md`. Borrador de la entrega (Devpost, video, checklist): `docs/submission.md`.

## Estado de `main` (último merge: #40)

Todo está mergeado; la corrida de CI de `main` en #40 está verde (jobs `check`, `e2e`, `mobile`). Números y
títulos verificados con `gh pr list` el 2026-10-14. #38, #34, #39 y #40 entraron a `main` el 2026-10-08.

| PR | Qué |
|---|---|
| #28 | Terceros plug-and-play: `server/integrations.ts`; un tercero roto o sin config cae a su respaldo sin tumbar el arranque |
| #29 | PayPal Server SDK (`@paypal/paypal-server-sdk` 2.5.0) para OAuth, órdenes, captura y reembolsos; facturas, payouts y webhooks siguen con fetch |
| #30 | Rieles de pago: Pix, SPEI, Bre-B (`pending_bank` → `vendor_confirmed` con PIN, nunca `paid`); Apple Pay, Google Pay y OXXO vía PayPal |
| #31 | Varios paygents por dueño: PIN, topes y bandeja por puesto; selector web y móvil; conector MCP en `/mcp` (Claude solo propone reembolsos y payouts) |
| #32 | Huella financiera en el pasaporte + importación de estados de cuenta CSV/OFX (solo agregados mensuales, "autodeclarado") |
| #33 | Accesibilidad WCAG 2.2 AA: axe en e2e, modo voz, alto contraste, +5 min, lector de pantalla en móvil |
| #34 | Docs: traspaso anterior (2026-10-07) y tabla Pendiente |
| #35 | Importación de estados: las transferencias entre cuentas propias ya no cuentan como ingreso (`ownAccountMoves`) |
| #36 | Botones Apple Pay / Google Pay con el JS SDK v6; `/.well-known/apple-developer-merchantid-domain-association` sirve `APPLE_PAY_DOMAIN_ASSOCIATION` |
| #37 | Voz sin `SpeechRecognition` (Firefox): `MediaRecorder` + `POST /api/voice/transcribe` (`STT_API_KEY`, `STT_URL`, `STT_MODEL`, `STT_MOCK_TRANSCRIPT`) |
| #38 | Docs: spec de confirmación bancaria automática de Bre-B (`docs/bank-confirm.md`), **sin implementar** |
| #39 | Móvil: pantallas Resumen (mes verificado / autodeclarado / por confirmar) y Perfil (cambio de puesto) |
| #40 | Dashboard web `paygent-dashboard/` conectado al servidor (`npm run dev:live`); mock sin `VITE_PAYGENT_API` |

Migraciones Postgres (`server/db/migrations.ts`): v1 = ventas, catálogo, terminales, topes, auditoría y PIN;
v2 = `suppliers`, `payouts`; v3 = huella (`statement_months`, `savings_goals`); v4 = puestos (`vendor_id`,
`pin_states`, `mcp_tokens`, `approvals`).

Deploy en Render (`https://paygent-rirl.onrender.com/api/health`, consultado 2026-10-14): `paypal: sandbox`,
`passport: on`, `claude: on`, `claude-vision: on`, `paypal-agent-toolkit: on`, **`database: off`**,
**`speech-to-text: off`**.

## Hecho después del traspaso (2026-10-14)

- #41 esta revisión de documentación, #42 pasada de UI/UX web, #43 pasada de UI/UX del dashboard (Cobrar en
  vivo real + job de CI `dashboard`): mergeadas.
- Paleta "Cempasúchil" aplicada en web, dashboard y móvil (`feat/palette-cempasuchil`, ver `docs/design.md`).

## Qué falta (en orden)

### Acciones del usuario (no las puede hacer un agente)

1. **Render → `DATABASE_URL`** de Neon. Hoy `database: off`: Render olvida ventas, auditoría y topes al dormir.
   Es también la primera prueba del pool `pg` real (solo se probó con PGlite).
2. **Render → `STALL_PINS`** (ej. `beto:XXXX`). Sin esto, Don Beto usa el PIN demo 5678.
3. **Payout real en sandbox**: `/backoffice` → Proveedores → email de la cuenta Personal sandbox → 10 MXN con PIN.
4. **Probar `/mcp` con un cliente Claude real** (token desde "Claude access" en el back office).
5. **Wallets**: activar Apple Pay y Google Pay en la app sandbox de PayPal, registrar el dominio de Render,
   poner `APPLE_PAY_DOMAIN_ASSOCIATION`, `RAIL_APPLE_PAY=1` y `RAIL_GOOGLE_PAY=1` en Render y probar en
   Safari/iPhone y Chrome/Android.
6. **Voz en Firefox en el deploy**: `STT_API_KEY` en Render (hoy `speech-to-text: off`) y probar en Firefox real.
7. **Build de EAS** (dev client Android y iOS) para las pruebas en dispositivos (`mobile/README.md`).
8. **Limpiar worktrees viejos**: `git worktree prune` (los `pg-a11y`, `pg-multi`, `pg-rails`, `pg-sdk` ya
   figuran como *prunable*) y los `.claude/worktrees/agent-*` ya mergeados.

### Decisiones abiertas

9. ~~**Paleta**~~: resuelta el 2026-10-14, "Cempasúchil" (`docs/memoria.md`). Las tres copias de tokens se
   cambian siempre juntas (`docs/design.md`).
10. **Repo público**: qué docs salen antes de abrirlo (memoria 2026-10-06 lo dejó pendiente): `docs/memoria.md`,
    `docs/handoff.md`, `docs/bank-confirm.md`. Si salen, quitar los enlaces del README. Borrarlos en un commit
    no los saca del historial de git.
11. **Confirmación bancaria de Bre-B** (`docs/bank-confirm.md`): ¿se construye antes del 12-nov o queda como
    spec? Hoy ninguna venta en COP puede existir (COP no es moneda PayPal), así que no cambia la demo.
12. **Dashboard**: ¿se despliega y entra en la demo? No está en `render.yaml` ni en CI; su build de Lovable
    apunta a Cloudflare por defecto y el servidor no manda CORS.
13. **Yape (parsers de Luca, MIT)**: la opción "solo transferencias" ya se resolvió con código propio en #35
    (sin usar Luca). Queda "yape sí" (riel + créditos en `THIRD_PARTY_NOTICES.md`) o "no". Bloqueo: PEN no es
    moneda PayPal.

### Huecos conocidos de lo ya mergeado

14. Dashboard (#40): **"Cobrar" sigue simulado también en modo real** — muestra un enlace inventado y marca
    "pagado" a los 3,5 s sin llamar al servidor ni a PayPal (`Overlays.tsx`, `Cobrar`); no usarlo en la demo
    y conectarlo o esconderlo en modo real. Además: sin probar con ventas reales; métricas por riel,
    interruptor de rieles y nombre/fecha de metas siguen en mock; sus tests (vitest) no corren en CI.
15. Móvil (#39): el mes se arma con hasta 62 llamadas al ledger; el día usa el reloj del teléfono (cerca de
    medianoche puede sobrar o faltar un día); sin probar con TalkBack/VoiceOver ni texto grande. Jest de
    `mobile/` no encuentra tests cuando el repo está bajo `.claude/` (worktrees).
16. Rieles: wallets sin probar en sandbox real ni en dispositivos; OXXO solo se lista (sin botón nativo);
    Bre-B nunca se ofrece (COP); panel de rieles sin probar en navegador con llaves reales.
17. MCP: solo JSON (sin stream ni session id); no hay pantalla para crear puestos; la app de cobro (`/`)
    elige terminal por `?terminal=`, el selector solo cambia el back office.
18. SDK de PayPal: depende de `unstable_httpClientOptions`; después de #29 no hay registro de un pago real en
    sandbox. `@paypal/agent-toolkit` trae su propia copia 1.1.0 del SDK.
19. Accesibilidad: el respaldo de Firefox (#37) existe pero el deploy no tiene transcriptor y no se probó en
    Firefox real; modo voz solo en la pantalla de venta; móvil sin "+5 min" ni comandos de voz; sin pruebas con
    vendedoras ciegas.
20. Diseño: verificado (verde) / autodeclarado (morado con trama) solo existen como tokens en el dashboard;
    la web y el móvil no los tienen. `--primary` no significa lo mismo en web y dashboard (`docs/design.md`).
21. Varios: un `XFER` sin concepto sigue contando como ingreso (decisión de #35); el libro del día mezcla montos
    si ese día cambió la moneda; `render.yaml` no declara `STALL_PINS`, `STT_*`, rieles ni
    `APPLE_PAY_DOMAIN_ASSOCIATION` (se agregan a mano en Render). CI: la corrida de `main` tras #39 falló por
    un timeout de `page.goto` en `e2e/onboarding.spec.ts` ("Mexico selects MXN", phone-es) y la de #40 pasó
    (inestable, sin investigar); GitHub avisa que `actions/checkout@v4` y `setup-node@v4` corren sobre Node 20
    (obsoleto) y que `ubuntu-latest` pasa a Ubuntu 26 desde el 19-oct-2026.

### Del plan (sin cambios de criterio)

22. Pruebas en dispositivos reales: sticker NTAG, HCE Android, soundbox en Android viejo, build iOS (plan #2, #4).
23. Validación con personas: 3 entrevistas, 10 ventas dictadas por otra persona, jurado externo en `/judge` (plan #7).
24. Entrega (plan #8): video < 3 min en inglés en dispositivos reales, repo público sin secretos ni docs
    privados, texto de Devpost, deploy vivo hasta el 15-dic. Borrador y checklist en `docs/submission.md`.
    **El repo sigue privado** (`gh repo view`, 2026-10-14).

## Reglas que un chat nuevo debe respetar

- Nada queda `paid` sin confirmación del proveedor de pagos. Lo confirmado por la vendedora o
  importado es "autodeclarado, no verificado" y nunca se suma a lo verificado.
- La IA propone; reembolsos y payouts solo con el PIN del puesto dueño.
- Commits: una línea, Conventional Commits, inglés, sin cuerpo ni trailers (nunca `Co-Authored-By`).
- Cabeceras: código `// <archivo>: <qué hace>`; `.md` con comentario HTML en español de 3–4 líneas.
- `docs/` en español, salvo `README.md` (inglés primero, sección en español) y `docs/submission.md` (inglés).
- `docs/memoria.md`: entradas nuevas arriba; nunca se reescribe una vieja, se corrige con otra.
- Nunca versionar `CLAUDE.md`, `AGENTS.md`, `.env*`, PDFs ni `LEARNINGS.md` (privado, sin seguimiento). Los
  PDF de la raíz tienen datos personales: no se citan.
- Tokens de diseño: tres copias (web, dashboard, móvil) que se cambian juntas.
- Los PR los mergea el usuario (el clasificador bloquea mergear sin revisión). Ningún agente hace push sin pedirlo.
