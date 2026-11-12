<!-- docs/handoff.md: punto de arranque para un chat nuevo — estado de main, qué falta y en qué orden.
     No es la spec (docs/plan.md, criterios de aceptación) ni la bitácora de decisiones (docs/memoria.md).
     Se sobrescribe completo en cada traspaso; lo histórico vive en memoria y en git log. -->

# Traspaso — paygent (2026-10-14, actualizado 2026-11-12, `main` en #59)

## Pendientes consolidados (2026-11-12) — la única lista vigente

Revisada contra `origin/main` (#59), `gh pr list --state merged` y
`GET https://paygent-rirl.onrender.com/api/health` (`database: off`, `speech-to-text: off`,
`device-tokens: on`, `paypal: sandbox`). El repo sigue **privado**. Entrega: **12-nov-2026 12:00 PT**
(15:00 en Bogotá). Las listas más abajo son historia: si contradicen esta, gana esta.

**Bloquean el envío a Devpost**

| # | Qué falta | Quién | Hecho cuando |
|---|---|---|---|
| 1 | Video < 3 min en inglés (guion v2 en `docs/submission.md`) | Usuario | Subido (YouTube/Vimeo), dura ≤ 3:00 y el enlace está en Devpost |
| 2 | Decidir qué docs privados salen (`docs/memoria.md`, `docs/handoff.md`, `docs/submission.md`) | Usuario | Decisión anotada; si salen, quitados y la tabla «Documentation» del README sin enlaces rotos |
| 3 | Repo público sin secretos | Usuario (el agente puede correr el escaneo) | `git ls-files` sin `.env*`, `secrets.h`, PDF, `CLAUDE.md`, `AGENTS.md`; escaneo del historial limpio; `gh repo view` dice `PUBLIC` |
| 4 | Texto de Devpost y envío | Usuario | Pegado de `docs/submission.md` con demo <https://paygent-rirl.onrender.com/judge>, PIN demo `1234`, sin llaves; Devpost muestra «Submitted» antes de las 12:00 PT |

**Recomendados (la demo funciona sin ellos)**

| # | Qué falta | Quién | Hecho cuando |
|---|---|---|---|
| 5 | Render: `DATABASE_URL` (Neon), `STALL_PINS`, `TRUSTED_IP_HEADER`, `PUBLIC_URL` | Usuario | `/api/health` dice `database: on`; una venta sobrevive a que Render duerma |
| 6 | «PAGADO» en la caja de voz (`docs/voice-box-hardware.md` §6.3.1) | Usuario (con el aparato) | Cobro por voz → pago sandbox desde el teléfono → pantalla verde y «Pagado, cuarenta pesos» una sola vez |
| 7 | Pago, reembolso y payout reales en sandbox después del Server SDK (#29) | Usuario | Captura + reembolso de 150 aceptado y 250 rechazado; payout de 10 MXN a la cuenta Personal; anotado en `docs/memoria.md` |
| 8 | Teléfonos reales: APK recompilado (voces de #57), passkey (#58), sticker NTAG215, iOS de EAS (#59) | Usuario | En un Android y un iPhone: tap en el sticker abre el pago, PAGADO suena con las voces de la caja, Face ID/huella desbloquea |
| 9 | Voz en Render: `STT_API_KEY`, `STT_URL`, `STT_MODEL` | Usuario | `/api/health` dice `speech-to-text: on`; Firefox dicta un pedido en el deploy |
| 10 | Caja de voz: token de dispositivo en `POST /api/terminals/:id/voice`, HTTPS en el firmware y caja virtual en `/judge` | Agente | `/voice` sin token responde 401 con prueba en vitest; el firmware manda el token; `/judge` cobra con el micrófono del navegador |

Fuera de la lista (decisiones sin fecha): Bre-B automático (`docs/bank-confirm.md`), desplegar el dashboard,
Yape, wallets en sandbox, limpiar worktrees viejos.

## Cómo arrancar

1. Lee en este orden: este archivo → `docs/plan.md` (sección Pendiente) → `docs/memoria.md` (entradas de arriba).
2. `npm ci && npm run check` (biome + tsc + vitest). E2E: `npm run e2e` (Playwright, Chromium).
3. Sin ninguna key, la app corre en modo mock; `/api/health` dice el modo de cada tercero.
4. Dashboard: `cd paygent-dashboard && npm ci && npm test` (no corre en CI). Móvil: `cd mobile && npm ci && npm run check`.
5. Diseño y tokens: `docs/design.md`. Borrador de la entrega (Devpost, video, checklist): `docs/submission.md`.

## Estado de `main` hasta #40 (histórico; lo posterior: #41–#59 en `gh pr list --state merged`)

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

## Actualización 2026-11-10 (histórico; reemplazada por la lista de arriba)

### PRs abiertos (apilados: mergear en este orden y cambiar la base del siguiente a `main`)

| PR | Rama | Qué |
|---|---|---|
| #49 | `claude/eloquent-brahmagupta-orlw1f` | Seguridad: el bloqueo del PIN ya no confía en `X-Forwarded-For` (`TRUSTED_IP_HEADER`, `TRUST_PROXY_HOPS`); freno global escalonado; `render.yaml` completo; CI con acciones v5 y `ubuntu-24.04` |
| #50 | `claude/sale-auth` | Seguridad: crear, cancelar y extender ventas piden un dispositivo desbloqueado con el PIN del puesto (`DEVICE_TOKEN_SECRET`, `CHARGE_AUTH`) |
| #51 | `claude/pending-fixes` | Libro del día en una sola moneda (`others`), Resumen del móvil con `/ledger-range` (2 llamadas, día del puesto), `/` sigue al puesto elegido, `CORS_ORIGINS` opcional |

Detalle y porqués: `docs/memoria.md`, entradas del 2026-11-10.

### Checklist hasta la entrega (12-nov 12:00 PT)

**Hoy, 10-nov (usuario):**

- [x] Revisar y mergear #49 → #50 → #51 (en `main` desde #52).
- [ ] Render → variables: `DATABASE_URL` (Neon; hoy `database: off`), `VENDOR_PIN`, `STALL_PINS`,
      `DEVICE_TOKEN_SECRET` (≥ 32 caracteres; el blueprint solo lo genera en servicios nuevos) y el header de IP:
      probar `TRUSTED_IP_HEADER=true-client-ip` o `cf-connecting-ip` y confirmar que llega la IP real. Sin él,
      todos los clientes comparten una llave de bloqueo del PIN. `CORS_ORIGINS` solo si el dashboard se
      despliega en otro origen.
- [ ] Build EAS del dev client Android (`mobile/README.md`); NFC y HCE no corren en Expo Go. iOS solo por EAS
      en la nube con cuenta de Apple Developer.
- [ ] Un pago sandbox real después del Server SDK (#29), con webhook recibido; payout real de 10 MXN a la
      cuenta Personal sandbox; probar `/mcp` con un cliente Claude real.

**11-nov, con el hardware:**

- [ ] Desbloquear con el PIN cada teléfono que cobra (vendedora y `/judge`).
- [ ] Sticker NTAG: grabar desde la pantalla NFC; tap en iPhone y Android → pago sandbox → el teléfono habla.
- [ ] HCE Android → iPhone (si falla, el video usa el sticker).
- [ ] Soundbox en el Android viejo: instalar, activar sonido, pantalla completa, fijar pantalla, corte de red.
- [ ] Voz con ruido real; si se puede, 10 ventas dictadas por otra persona (≥ 9 carritos correctos).
- [ ] Móvil con TalkBack/VoiceOver y texto grande (nunca probado); Resumen con datos reales.

**12-nov, antes de 12:00 PT:**

- [ ] Video < 3 min en inglés en dispositivos reales (`docs/submission.md`, guion y checklist).
- [ ] Decidir qué docs privados salen (`memoria`, `handoff`, `bank-confirm`) y hacer público el repo; borrar
      en un commit no los saca del historial.
- [ ] Texto de Devpost: `/judge`, PIN demo `1234` (el panel de la vendedora lo pide una vez), sin llaves.
- [ ] Deploy vivo hasta el 15-dic (Render free duerme: con `DATABASE_URL` no se pierden datos).

**Decisiones abiertas (no bloquean la demo):** Bre-B automático (spec en `docs/bank-confirm.md`), desplegar
el dashboard, Yape, tokens verificado/autodeclarado en web y móvil, wallets (Apple Pay / Google Pay) en sandbox.

**Riesgos conocidos:** e2e de onboarding inestable en CI (no se reprodujo en 3 corridas locales completas); el
móvil no se probó en dispositivo después de #50 y #51; sin `TRUSTED_IP_HEADER`, 5 PINs malos de cualquiera
bloquean a todos los clientes por un rato.

## Qué falta (lista del 2026-10-14, histórica; reemplazada por la de arriba)

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
12. **Dashboard**: ¿se despliega y entra en la demo? No está en `render.yaml`; su build de Lovable apunta a
    Cloudflare por defecto. ~~El servidor no manda CORS~~: ahora `CORS_ORIGINS` (orígenes exactos) lo permite
    (2026-11-10). CI ya lo corre (job `dashboard`, #43).
13. **Yape (parsers de Luca, MIT)**: la opción "solo transferencias" ya se resolvió con código propio en #35
    (sin usar Luca). Queda "yape sí" (riel + créditos en `THIRD_PARTY_NOTICES.md`) o "no". Bloqueo: PEN no es
    moneda PayPal.

### Huecos conocidos de lo ya mergeado

14. Dashboard (#40): ~~"Cobrar" simulado en modo real~~ (resuelto en #43: cobra en la terminal y espera la
    captura; desde el PR de autenticación de cobros manda la sesión del puesto). Sigue: sin probar con ventas
    reales; métricas por riel, interruptor de rieles y nombre/fecha de metas siguen en mock.
15. Móvil (#39): ~~62 llamadas al ledger y reloj del teléfono~~ (2026-11-10: dos llamadas a
    `/ledger-range`, que devuelve el "hoy" del puesto); sin probar con TalkBack/VoiceOver ni texto grande. Jest de
    `mobile/` no encuentra tests cuando el repo está bajo `.claude/` (worktrees).
16. Rieles: wallets sin probar en sandbox real ni en dispositivos; OXXO solo se lista (sin botón nativo);
    Bre-B nunca se ofrece (COP); panel de rieles sin probar en navegador con llaves reales.
17. MCP: solo JSON (sin stream ni session id); no hay pantalla para crear puestos. ~~La app de cobro (`/`) ignora
    el selector~~: sin `?terminal=`, `/` abre la primera terminal del puesto elegido en el back office (2026-11-10).
18. SDK de PayPal: depende de `unstable_httpClientOptions`; después de #29 no hay registro de un pago real en
    sandbox. `@paypal/agent-toolkit` trae su propia copia 1.1.0 del SDK.
19. Accesibilidad: el respaldo de Firefox (#37) existe pero el deploy no tiene transcriptor y no se probó en
    Firefox real; modo voz solo en la pantalla de venta; móvil sin "+5 min" ni comandos de voz; sin pruebas con
    vendedoras ciegas.
20. Diseño: verificado (verde) / autodeclarado (morado con trama) solo existen como tokens en el dashboard;
    la web y el móvil no los tienen. `--primary` no significa lo mismo en web y dashboard (`docs/design.md`).
21. Varios: un `XFER` sin concepto sigue contando como ingreso (decisión de #35); ~~el libro del día mezcla montos
    si ese día cambió la moneda~~ (2026-11-10: totales solo en la moneda actual, el resto en `others`);
    ~~`render.yaml` incompleto~~ (#49). CI: la corrida de `main` tras #39 falló por
    un timeout de `page.goto` en `e2e/onboarding.spec.ts` ("Mexico selects MXN", phone-es) y la de #40 pasó
    (inestable, sin investigar; en las corridas locales del 2026-11-10 pasó). ~~Avisos de Node 20 y Ubuntu 26~~ (#49).

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
