<!-- docs/submission.md: BORRADOR en inglés de la entrega al PayPal AI Hackathon — texto para Devpost, guion
     del video (< 3 min) con lista de tomas y checklist previa al envío. Lo edita el dueño antes de enviar.
     No es la portada pública (README.md) ni el estado del proyecto (docs/handoff.md); cada afirmación sale
     de README, docs/plan.md, docs/memoria.md o docs/handoff.md. No es devpost_draft.md (copia local sin versionar). -->

# paygent — hackathon submission (DRAFT)

> **DRAFT for the owner to edit.** Written 2026-10-14, re-checked against `main` (#59) on 2026-11-12, from `README.md`, `docs/plan.md`,
> `docs/memoria.md` and `docs/handoff.md`; nothing here claims more than those say. Lines marked **[OWNER]** need your
> input. Deadline: **2026-11-12 12:00 PT** (PST, UTC−8: 20:00 UTC, 15:00 in Bogotá).

## Devpost text

**Tagline:** The AI cashier for street vendors: say the price, the customer taps, your phone or counter box says "paid".

### Inspiration

A street vendor works with her hands full. She cannot stop to type on a card terminal, a "payment sent"
screenshot can be faked, and when most of her income is cash she has no record a lender trusts. Our demo
vendor is Rosa, who sells tamales and atole in Oaxaca.

**[OWNER]** Add one real sentence from the vendor interviews (plan item 7) once they happen. Do not
publish a quote before then.

### What it does

- **Voice to cart.** Rosa holds the mic and says "two mole tamales and an atole". Claude turns it into a
  cart from her own catalog. Every item and price is checked against that catalog, so the model cannot
  invent either. Without an API key, a rule-based parser does the same job.
- **Tap or scan to pay.** The customer taps an NFC sticker or scans a QR and pays on their own phone. The
  checkout uses PayPal's JS SDK v6 and shows PayPal, Venmo (USD), Pay Later (where PayPal offers it) and
  card, plus Apple Pay and Google Pay when they are enabled and eligible.
- **"¡Pagado! Ninety-five pesos".** The server captures the order with PayPal, and only then does the
  vendor's phone turn green and say the amount, with a chime and recorded voice clips in Spanish or
  English. An old Android phone on the counter can act as a soundbox. A fake screenshot stays silent,
  because only a server-side capture makes a sound.
- **A voice box on the counter.** An ESP32-S3 box we built this week with a microphone, a speaker and a
  2.8" screen: hold the button, say "cóbrame cuarenta pesos de unos tacos", and it opens a sandbox sale and
  shows the amount; it speaks every result (paid, no amount, no internet...) with the same recordings as
  the web and the app.
- **A back office that cannot be talked into moving money.** It has the day's ledger, cash reconcile,
  invoices with QR, refunds and payouts to suppliers, plus a Claude assistant with an allowlisted subset
  of PayPal's Agent Toolkit. Every money move goes through a deterministic policy lock: the vendor's PIN
  on every request, caps per refund and per day, and payouts only to allowlisted suppliers. The AI
  proposes and the lock decides.
- **A sales passport.** It is a signed (Ed25519) report of PayPal-verified sales that anyone can check at
  `/verify` without logging in. Self-reported cash and imported bank statements are shown apart, never
  added in. It holds descriptive indicators, never a credit score.
- **Unlock with Face ID or a fingerprint.** Charging needs an unlocked device; after one PIN unlock the
  vendor can save a passkey on that phone, and the PIN stays as the fallback.
- **One owner, several stalls.** Each stall has its own PIN, caps and records. Claude can connect over MCP
  and only *propose* refunds and payouts into an approvals inbox.
- **Local rails without pretending.** Pix and SPEI show a QR or bank data. The sale stays "pending" and
  is never marked paid until the vendor confirms it, and even then it is labelled "not verified".
- **For everyone.** The app is in English and Spanish and targets WCAG 2.2 AA, with a voice mode,
  keyboard-only use, high contrast and 200% text. There is also a native Expo app with an NFC sticker
  writer and an Android phone-to-phone tap.
- **Zero-setup judge mode.** `/judge` puts vendor and customer side by side and runs on a mock PayPal
  gateway with no keys.

### How we built it

- **Server:** Node + Hono in one process (API, live events over SSE, webhooks, MCP), with money in
  integer minor units shared with the web and mobile apps. Postgres with versioned migrations, or memory
  with no setup. Each third party plugs in with a safe fallback, and `/api/health` reports which mode
  each one is in.
- **PayPal:** Orders v2 through `@paypal/paypal-server-sdk` (OAuth, create, capture, refund); the JS SDK
  v6 checkout with `findEligibleMethods`; Payouts v1 with `sender_batch_id` idempotency; Invoicing v2;
  verified webhooks; and `@paypal/agent-toolkit` behind an allowlist. Only `server/paypal/` talks to
  PayPal.
- **Claude:** Haiku 4.5 for voice-to-cart (forced tool output validated with zod, falling back to rules
  after 4 s); Sonnet 5.5 for the back-office agent and for reading a photo of the menu board, whose text
  is treated as data and never saved without the vendor's review.
- **Clients:** Preact + Vite web app; Expo SDK 57 app for iOS and Android (Android APK and iOS EAS
  build); a TanStack Start dashboard for the month view (not deployed yet).
- **Voice box:** Arduino firmware on an ESP32-S3 N16R8 with an INMP441 mic, a MAX98357A amplifier and an
  ILI9341-class screen. It posts a WAV to `POST /api/terminals/:id/voice`; the server transcribes it with
  a Whisper-compatible endpoint and returns the amount in words, which the box says with µ-law clips
  generated once by `scripts/voice-clips.ts`.
- **Tests:** Vitest (388 tests on 2026-11-12), Playwright end-to-end with an axe
  accessibility gate, and prompt-injection batteries against the lock and the agent where no money may
  move.

### Challenges we ran into

- **Keeping the AI away from money.** Toolkit tools that move money are neither enabled nor shown to the
  model, and the PIN never enters its context. Refund and payout budgets are reserved, committed only
  when PayPal accepts, and released if it refuses. If PayPal's answer to a payout is lost, the budget
  stays spent, because the payout may exist.
- **Payment methods depend on currency and country.** Venmo is USD and US only, and Pay Later is not
  offered in MXN, so a Mexican sale shows PayPal and card. A static rule per currency comes first, then
  PayPal's eligibility check for the buyer and amount.
- **Rails with no provider cannot be verified.** We added a `pending_bank` → `vendor_confirmed` path that
  never reaches "paid" and is always reported apart from verified money.
- **Firefox has no speech recognition.** The mic records audio and the server transcribes it, and when no
  transcriber is configured the UI says so instead of failing silently.
- **Several stalls.** While merging the multi-stall work we found that one stall's PIN could confirm
  another stall's bank transfer. Each confirmation now uses the owning stall's PIN, and a test pins it.

### Accomplishments that we're proud of

- The money rule holds everywhere: nothing is "paid" without PayPal's confirmation, and verified and
  self-declared money are never added together.
- In the injection batteries, zero money moves.
- On the hosted deploy with the real PayPal sandbox we saw a captured payment, delivered webhooks,
  refunds of 1 and 150 accepted and a refund of 250 rejected by the cap. (This check predates the switch
  to the Server SDK; **[OWNER]** repeat it before submitting.)
- A judge can try the whole flow in 60 seconds with no account and no keys.

### What we learned

- A screenshot is not a payment: the server-side capture is the confirmation, and the webhook is the
  backup.
- PayPal availability is shaped by currency: COP, PEN and other Latin American currencies are not PayPal
  currencies, so those vendors charge in USD, and a Bre-B (COP) sale cannot exist yet.
- The Payouts sandbox does not accept phone receivers (email only), and a lost Payouts response must
  never free the budget.
- Free hosting choices matter for a deploy that must stay up for judging: Render's free Postgres expires
  after 30 days, so we chose Neon.

### What's next

- Real-device trials: NFC sticker, Android tap, soundbox on an old phone, the iOS app on an iPhone.
- Interviews with vendors, and ten sales dictated by someone else.
- Confirming Bre-B transfers from the bank's own notice instead of the PIN (spec written, not built).
- The voice box: a device token on the voice endpoint, HTTPS to the hosted deploy, and the "sales today"
  and "advice" intents. Deploying the month dashboard.

### Built with

TypeScript · Node.js · Hono · Preact · Vite · React · TanStack Start · Tailwind CSS · Recharts ·
AG Grid · Expo · React Native · PayPal Orders v2 · PayPal Server SDK · PayPal JS SDK v6 · PayPal Payouts ·
PayPal Invoicing · PayPal webhooks · PayPal Agent Toolkit · Venmo · Pay Later · Apple Pay · Google Pay ·
Claude (Anthropic API) · Model Context Protocol · PostgreSQL · Neon · PGlite · zod · Web NFC · Web Speech
API · MediaRecorder · WebCrypto (Ed25519) · WebAuthn (SimpleWebAuthn) · ESP32 · Arduino · Vitest ·
Playwright · axe-core · Biome · GitHub Actions · Render · EAS

**[OWNER]** Check that every tag is one Devpost offers. Drop Neon if `DATABASE_URL` is still unset on
submission day. Venmo never showed in our sandbox (memoria 2026-10-07: the sandbox merchant is not
listed as Venmo-eligible), and Apple Pay / Google Pay are untested on phones: keep those tags only if the
video or a test shows them working.

## Video script (English, under 3 minutes) — v2, 2026-11-12

Rewritten on 2026-11-12 around the physical voice box (`docs/voice-box-hardware.md`), using three
reference videos the owner picked. Directions are in Spanish (for whoever shoots); the spoken lines and
captions are the English that goes in the video. Rows marked ⚠ depend on something not yet verified on
the device: test it first and use the fallback if it fails.

### Qué se toma de cada referencia

| Referencia | Qué copiar | Dónde va |
| --- | --- | --- |
| Cyclon (84 s) | Abre con el producto funcionando, sin explicar; luego el fundador a cámara con fondo oscuro y **una palabra clave** animada al lado por frase; cierra con «What you just saw was… running on a working prototype» | Tomas A, B y E |
| Orshot (36 s) | Tarjeta blanca de 1,5 s con un paso y **una palabra en color** («First, connect your *Buffer*»), seguida de la grabación de pantalla de ese paso, con zoom y cursor grande, sobre un fondo de color | Tomas C1–C5 |
| HeyClicky (60 s) | Cámara en mano, tono casual, subtítulos grandes en blanco quemados en todo el video, título enorme en minúsculas sobre la toma, montaje rápido de «lo que armamos esta semana» | Toma D y los subtítulos de todo el video |

### Guion

| Tiempo | Toma (qué ve la cámara) | Lo que se dice (EN) | Texto en pantalla |
| --- | --- | --- | --- |
| 0:00–0:20 | **A. En frío, una sola toma sin cortes.** La caja de voz en una mesa con tacos o tamales. Una mano aprieta HABLAR. La pantalla pasa por «Te escucho…» → «40 MXN · Escanea para pagar». El teléfono del cliente escanea el QR impreso y paga con el comprador del sandbox. ⚠ La caja se pone verde: «PAGADO». Respaldo: el teléfono con `/soundbox` al lado dice «¡Pagado! Cuarenta pesos» con las mismas voces de la caja (#57) | (en vivo, en español) «Cóbrame cuarenta pesos de unos tacos.» | Subtítulo: *"Charge forty pesos for some tacos."* Al final: **No typing. No screenshots. Paid.** |
| 0:20–0:45 | **B. A cámara**, fondo oscuro liso, de la cintura para arriba. Una palabra clave aparece al lado en cada frase | "Street vendors work with their hands full. They can't stop to type on a card terminal. A 'payment sent' screenshot can be faked. And when most of the money is cash, no lender can see it. So we built Paygenty: an AI cashier you just talk to." | **hands full** · **faked** · **no lender** · **talk to** |
| 0:45–1:02 | **C1.** Tarjeta: «First, **say** the order.» Pantalla del teléfono de la vendedora: mantiene el micrófono, dice «dos tamales de mole y un atole», el carrito se llena, toca **Cobrar** | "The vendor says the order. Claude turns it into a cart from the stall's own menu, and every item and price is checked against that menu, so it can't invent either." | Claude → cart, checked against the menu |
| 1:02–1:17 | **C2.** Tarjeta: «Then the customer **taps**.» ⚠ El cliente toca el sticker NFC con su teléfono (respaldo: escanea el QR); el checkout muestra puesto, productos y total; paga con PayPal | "The customer taps the sticker or scans the QR, sees exactly what they're paying for, and pays on their own phone, with PayPal or a card." | Tap or scan → PayPal checkout |
| 1:17–1:35 | **C3.** Tarjeta: «Only PayPal makes it say **paid**.» Pantalla partida: a la izquierda el pago real → verde y la voz; a la derecha alguien le muestra a la caja una captura falsa de «pago enviado» → no pasa nada | "It turns green only after our server captures the payment with PayPal. A fake screenshot? Silence." | Server capture = confirmation |
| 1:35–1:55 | **C4.** Tarjeta: «The AI **proposes**. The lock decides.» Back office: se le pide al asistente devolver 250 pesos → el candado lo rechaza (tope de 200 por devolución); luego 150 → pide el PIN (fuera de cuadro) → pasa | "The assistant can propose a refund, but it can't move money. A deterministic lock checks the vendor's PIN every time and enforces the caps." | Over the cap → refused · PIN → refunded |
| 1:55–2:10 | **C5.** Tarjeta: «Sales become a **passport**.» El QR del pasaporte; otro teléfono abre `/verify` → VALID; se pega el mismo enlace con un carácter cambiado → INVALID | "And the vendor's PayPal-verified sales become a signed passport anyone can check, kept apart from the cash they declare." | Signed · verified ≠ self-reported |
| 2:10–2:30 | **D. Montaje en mano.** Título enorme en minúsculas: «built this week in bogotá». Tomas de 1–2 s: soldar los pines del micrófono, `arduino-cli` cargando el firmware, la pantalla de lado y luego derecha, las caras de la caja | "This week I bought the parts in Bogotá: an ESP32, a microphone, a speaker and a tiny screen. I soldered them and wrote the firmware. The screen turned out to be sideways from the factory." | built this week in bogotá |
| 2:30–2:50 | **E. A cámara**, mismo fondo que B, con la caja en la mano | "What you just saw was Paygenty running on a working prototype, against the real PayPal sandbox. Next, we take it to real vendors. Try it yourself: the link is in the description." | **working prototype** · **next** |
| 2:50–2:55 | Cierre: logo, URL del demo y del repo | — | Paygenty · Built with PayPal + Claude |

Son unas 230 palabras en inglés: a ritmo normal (unas 140 por minuto) dan cerca de 1:40 de voz, y con la toma A,
las tarjetas y las pausas el video queda cerca de 2:40. Si se pasa, se corta primero C5 y después D.

### Estilo de edición

- **Tarjetas (Orshot):** fondo crema `#F6EEDC`, texto `#34211E`, la palabra clave en vino `#7D1439`
  (paleta Cempasúchil, `docs/design.md`); 1,5 s cada una, entrada suave.
- **Pantallas:** grabación del teléfono sobre fondo vino o crema, zoom al toque o al tap, sin barra de
  estado con notificaciones.
- **A cámara (Cyclon):** fondo oscuro liso, luz de un lado, una palabra clave por frase al lado del cuerpo.
- **Subtítulos (HeyClicky):** quemados en todo el video, blancos, gruesos, con sombra, abajo al centro.
  Si se generan solos (por ejemplo en CapCut), corregir «Paygenty», «Claude» y «PayPal». También sirven
  para la accesibilidad que el proyecto promete.
- **Música:** suave y baja bajo la voz; en la toma A se sube el sonido en vivo de la caja.

### Antes de grabar (en orden)

1. ⚠ Probar «PAGADO» en la caja (`docs/voice-box-hardware.md` §6.3, punto 1). Si falla, la toma A usa
   la caja para cobrar y el teléfono con `/soundbox` para el «¡Pagado!»: sigue siendo real.
2. Servidor local en el PC con el sandbox real (la caja habla `http` con `http://<IP del PC>:8787`);
   el comprador del sandbox con sesión abierta en el teléfono del cliente.
3. Para C4: una venta capturada de 300 pesos o más, porque 150 tiene que caber dentro de la venta.
4. ⚠ Sticker NFC grabado con la URL de la terminal; si el tap falla, C2 usa el QR.
5. PIN fuera de cuadro; correos del sandbox difuminados; nada de los PDF de la raíz ni datos personales.

**Orden de grabación:** primero las pantallas C1–C5 (no dependen de la caja), luego la toma A, luego
B y E juntas (mismo fondo y luz) y al final el montaje D.

**[OWNER]** El nombre: Devpost y el README dicen «Paygenty»; la app y la caja dicen «paygent». El guion
usa «Paygenty»: cambiarlo si Devpost queda con otro.

## Pre-submission checklist

Re-checked 2026-11-12 against `main` (#59) and `GET https://paygent-rirl.onrender.com/api/health`
(`database: off`, `speech-to-text: off`, `device-tokens: on`, `paypal: sandbox`). The repo is still
**private**. The full ordered list, with who does what, is at the top of `docs/handoff.md`.

**Blocking the submission**

- [ ] **Repo public, no secrets.** Before flipping visibility: confirm no `.env*`, keys, `CLAUDE.md`,
      `AGENTS.md`, PDFs or `firmware/voice-box/secrets.h` are tracked (`git ls-files`), and run a secret
      scan over the full history, since deleting a file in a commit does not remove it from history.
- [ ] **Private docs decided.** Choose what stays out of the public repo (`docs/memoria.md`,
      `docs/handoff.md`, this file). `LEARNINGS.md` is untracked and stays that way. If docs are removed,
      prune the README "Documentation" table.
- [ ] **Video** under 3 minutes, in English, on real devices, uploaded where Devpost accepts it.
- [ ] **Devpost** text pasted from above, tags checked, screenshots, repo link, demo link
      (<https://paygent-rirl.onrender.com/judge>) and judge notes (`/judge`, demo PIN `1234` — the vendor
      panel asks for it once to unlock charging — no keys needed).
- [ ] **Submit before 2026-11-12 12:00 PT.**

**Strongly recommended (the demo works without them)**

- [ ] **Deploy keeps data.** `DATABASE_URL` (Neon) on Render so `/api/health` shows `database: on`; with
      `off`, a Render sleep wipes the judge's sales. Also `STALL_PINS`, `TRUSTED_IP_HEADER` and
      `PUBLIC_URL`; `DEVICE_TOKEN_SECRET` is already set (`device-tokens: on`).
- [ ] **"PAGADO" on the voice box** after a real sandbox capture (`docs/voice-box-hardware.md` §6.3.1);
      the video's shot A depends on it (fallback: `/soundbox` on a phone).
- [ ] **Sandbox re-check.** One real sandbox sale captured and refunded after the Server SDK switch; one
      supplier payout to a sandbox personal account.
- [ ] **Clean-browser run.** Someone outside the team opens `/judge` in a fresh browser and completes the
      60-second flow (plan item 7).
