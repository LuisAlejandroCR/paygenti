<!-- README.md: portada pública de paygent para jurados y usuarios — qué es, arquitectura, prueba de
     60 segundos, cómo correr servidor, web, dashboard y móvil, todas las variables de entorno, rieles,
     accesibilidad, el candado de políticas y lo que falta verificar. No es la spec (docs/plan.md) ni
     el razonamiento (docs/memoria.md) ni el estado para un chat nuevo (docs/handoff.md). -->
# paygenty

**The AI cashier for street vendors.** Say the price, the customer taps or scans, your phone says
"Received: 95 pesos".

Entry for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). The app is bilingual
(English / Español): it follows your browser language and has an EN/ES toggle in every header.

## Architecture at a glance

| Piece | Folder | Stack | What it does |
| --- | --- | --- | --- |
| Server | `server/` | Node 22+, Hono, TypeScript | API, live events (SSE), PayPal gateway (real sandbox or in-memory mock), policy lock, Claude agent, MCP endpoint, Postgres or in-memory store; serves the built web app |
| Web app | `web/` | Preact + Vite | Vendor screen, customer checkout, back office, `/judge`, `/soundbox`, `/verify` |
| Dashboard | `paygent-dashboard/` | TanStack Start, React, Tailwind, Recharts, AG Grid | Month view for the vendor: sales, activity, payment rails, savings goals. Mock data or the live server; not deployed yet ([README](paygent-dashboard/README.md)) |
| Mobile app | `mobile/` | Expo SDK 57 (React Native) | Vendor app for iOS and Android: voice sale, PAID, soundbox, NFC sticker writer, Android phone-to-phone tap, back office, month summary ([README](mobile/README.md)) |
| Shared | `shared/` | TypeScript | Money in integer minor units, currencies, payment rails, passport types; used by server, web and mobile |

Two rules hold everywhere: only `server/paypal/` talks to PayPal, and the AI only *proposes* money
moves — a deterministic policy lock with the vendor's PIN decides.

## What it is

- **Vendor screen (`/`)** — hold the mic and say "two mole tamales and an atole" (or type an
  amount), tap **Charge**, and a QR / NFC sticker link opens the sale for the customer.
- **Customer checkout (`/pay/:saleId`, reached via `/t/:terminal`)** — shows the stall, the items
  and the total before paying with PayPal, Venmo, Pay Later or a card, whichever PayPal offers
  for that currency and buyer (see [Payment methods at checkout](#payment-methods-at-checkout)).
- **Paid announcement** — the vendor's phone turns green and says the amount out loud
  (en-US or es-MX voice).
- **Back office (`/backoffice`, PIN `1234` in the demo)** — today's sales, cash reconcile, invoice
  with QR, refunds, payouts to suppliers, and an optional Claude assistant. Money only moves
  through a deterministic policy lock.

## Try it in 60 seconds

Open **`/judge`** (locally: <http://localhost:8787/judge>). One screen, two panels:

1. Vendor (left): type `95` or dictate an order, then tap **Charge**.
2. Customer (right): the checkout appears — tap **Pay (simulated)** or **Simulate decline**.
3. Vendor: the screen turns **PAID** and announces it.
4. Bonus: open `/backoffice`, enter PIN `1234`, refund a sale — the lock asks for the PIN again.

No keys are needed: without PayPal credentials the server runs against an in-memory mock gateway.

## Soundbox: an old phone on the counter

Open **`/soundbox?terminal=rosa-01`** (also linked from `/judge` as **Open soundbox**). It shows the
stall QR while idle, the open amount during a sale, and a huge **PAID** that it says out loud. Only a
payment the server captured with PayPal makes a sound, so a fake "payment sent" screenshot stays silent.

1. On an old Android phone, open the soundbox URL in Chrome and choose **Add to Home screen** / **Install app**.
2. Open it from the home screen and tap **Tap to enable sound** once (browsers block audio until a tap).
3. Tap **Full screen**; the page keeps the screen awake (Wake Lock) where supported. Keep it plugged in.
4. Optional kiosk: Android *Screen pinning* (Settings > Security) keeps it on this app.

If the connection drops it shows a red offline badge and reconnects by itself, and it never repeats an
announcement it already made.

## Menu photo → catalog

In `/backoffice` (after the PIN), the **Menu** panel lets the vendor snap or upload a photo of
her menu board. The phone downscales it (max 1600 px JPEG) and, with `ANTHROPIC_API_KEY` set,
Claude vision **proposes** items (names in English and Spanish, price, aliases). Text in the photo
is treated as data, never instructions; the proposal is validated and is never saved on its own.
She reviews the table, edits, adds or removes rows and taps **Save** — the voice parser and the
vendor app use the new catalog immediately, and the save is written to the audit log. Without a
key the same table works for manual entry.

## Sales passport (signed)

A vendor paid mostly in cash has no record a lender trusts. In `/backoffice` the **Sales passport**
panel issues one for a date range (default: last 30 days): PayPal-captured sales count, totals,
refunds, net, days active, average ticket and a per-day series. Only captured PayPal payments
count as verified; cash she declares is shown apart, labelled self-reported. No buyer data is
included. The report is canonical JSON (sorted keys) signed with Ed25519; the panel shows a QR
and a link to `/verify#<payload>`. The payload lives in the URL fragment, so it never reaches
server logs; anyone can open it without logging in, and the browser checks the signature with
WebCrypto against `GET /api/passport/public-key` (fallback: `POST /api/passport/verify`).
Changing any number makes it INVALID. Set `PASSPORT_SIGNING_KEY` (Ed25519 PKCS8, PEM or base64
DER) for a stable key; without it each start uses an ephemeral key and the report says
"demo key".

### Financial footprint

"No bank history? Your sales are your history." The passport (report version 2) also carries a
footprint of descriptive indicators — days with sales, months selling, weeks with sales out of
total weeks, monthly income per currency (never mixed) with its last-month trend, and an optional
savings goal the vendor sets. It is never a single score, and the page says so: not a credit score,
not a loan offer. The vendor can import a bank statement (CSV with date/amount or debit/credit
columns, comma or semicolon, dd/mm/yyyy or yyyy-mm-dd; or OFX/QFX; up to 1 MB and 5000 rows) in
`/backoffice` with her PIN. The server keeps only month, currency, total inflow and inflow count;
the file, account numbers, names and descriptions are discarded and never logged. Transfers between
her own accounts (a "traspaso" / "own account" concept, or a matching debit in another account of the
same OFX within 3 days) are left out of inflow. Imported data is labelled "self-reported, not
verified", shown apart from PayPal-verified figures, signed with the rest of the passport, and can
be deleted with the PIN.

## Suppliers & payouts (money out)

"Pay the masa supplier": in `/backoffice` the **Suppliers & payouts** panel keeps an allowlist of
suppliers (name, PayPal email or phone, currency) and pays them from the PayPal balance with the
[Payouts API](https://developer.paypal.com/docs/api/payments.payouts-batch/v1/) (one batch, one item).

- Adding or removing a supplier, and every payout, needs the vendor's PIN; the policy lock decides
  and writes each decision to the audit log.
- Caps per currency: MXN 300 per payout and MXN 500 per day (USD 15 / 25, and so on). Budget is
  committed only after PayPal accepts the payout and released if it refuses; if PayPal's answer is
  lost (timeout) the budget stays spent, because the payout may exist.
- Each payout's id is PayPal's `sender_batch_id` and `PayPal-Request-Id`, so a retried submit pays
  once. The history shows PayPal's status (Pending, Paid, Denied, Unclaimed...); payout webhooks and
  a **Refresh status** button keep it current. The daily ledger lists payouts in their own section.
- The Claude assistant can only **propose** a payout (`propose_payout`): the proposal fills the pay
  form and the vendor confirms it with her PIN. The model never sees a PIN and has no tool that pays.
- Mock mode pays instantly (a receiver containing `denied` simulates a denied payout). In the sandbox,
  the app needs **Payouts** enabled (developer.paypal.com → your app → Features); otherwise the panel
  shows `PAYOUTS_NOT_ENABLED`. The sandbox does not support phone payouts: use an email.

## Several paygents, one owner (and Claude over MCP)

- One owner can run several stalls. The demo seeds a second one, **Don Beto — Tacos** (PIN `5678`,
  terminal `beto-01`). Each stall has its own PIN, caps, catalog, suppliers and records: one stall's
  refund or payout budget can never be spent from another.
- With 2+ stalls the back office (web and phone) shows a stall switcher and **All my paygents**
  (`/backoffice/all`): today's totals per currency, never converted or mixed.
- **Claude:** create a token in `/backoffice` → *Claude access (MCP)* (only its SHA-256 is stored; it
  reaches the stalls you are signed in to; revoke any time) and connect Claude to `<your-url>/mcp`
  (streamable HTTP, `Authorization: Bearer pgt_…`). Tools: `list_stalls`, `get_ledger`,
  `list_suppliers`, `create_charge`, `cancel_open_sale`, `propose_refund`, `propose_payout`.
  Refunds and payouts are only **proposed**: they wait in the stall's approvals inbox until you approve
  them on the web or phone with that stall's PIN. Claude never receives the PIN.

## Run locally

Requires Node 22+.

```bash
npm install
npm run dev        # API on :8787 (tsx watch)
npm run dev:web    # Vite UI on :5173, proxies /api and /t to :8787
```

Production-like (one process serving the built web app):

```bash
npm run build      # builds web/ into dist/web
npm start          # http://localhost:8787 — /, /judge, /backoffice, /pay/*
```

Quality gate: `npm run check` (Biome lint, TypeScript, Vitest). End-to-end: `npm run e2e`
(Playwright in Chromium; it builds the web app and starts the server in mock mode, with an axe
accessibility gate). CI runs both, plus the mobile checks.

### Dashboard (`paygent-dashboard/`)

```bash
cd paygent-dashboard
npm ci
npm run dev        # seeded mock data on http://localhost:8080 (header shows "Sandbox")
npm run dev:live   # real data from the server on :8787, served on http://localhost:5192
npm test           # Vitest: server-JSON adapter and routing
```

For live mode, start the server first (`npm run dev` at the root) and unlock a stall with its PIN
(demo: Rosa `1234`, Don Beto `5678`). Details: [paygent-dashboard/README.md](paygent-dashboard/README.md).

### Mobile app (`mobile/`)

```bash
cd mobile
npm ci
npm run check            # typecheck + lint + jest
npx expo run:android     # builds and installs the dev client on a USB-connected Android phone
```

It needs a dev client, not Expo Go (NFC, HCE and speech recognition are native modules). The phone
cannot reach `localhost`: set the server URL in the app's **Settings** to your computer's LAN IP
(for example `http://192.168.1.20:8787`). iOS builds run only on EAS cloud with an Apple Developer
account. Details: [mobile/README.md](mobile/README.md).

## Environment variables

Copy `.env.example` to `.env.local` (the `dev` and `start` scripts load it). Every value is optional:
with none set, the server runs on the mock PayPal gateway with an in-memory store.

**Core**

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `8787`) |
| `PUBLIC_URL` | Base URL printed in QR codes and NFC stickers. On Render, when unset, the server uses `RENDER_EXTERNAL_URL` (set by Render) |
| `DATABASE_URL` | Postgres connection string; sales, catalog, suppliers, payouts, audit log, PIN lockouts and daily refund/payout caps then survive restarts. Unset: everything lives in memory |
| `PASSPORT_SIGNING_KEY` | Ed25519 private key (PKCS8 PEM or base64 DER) that signs sales passports; otherwise an ephemeral demo key |
| `VENDOR_PIN` | PIN of the main stall (Rosa): back office, refunds, payouts (demo default `1234`) |
| `STALL_PINS` | PIN per extra stall, e.g. `beto:5678,luz:2468` (demo stall "Don Beto — Tacos" defaults to `5678`) |

**PayPal**

| Variable | Purpose |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal sandbox app; without both the mock gateway runs and the Agent Toolkit is off |
| `PAYPAL_WEBHOOK_ID` | Verifies `/webhooks/paypal` signatures |
| `PAYPAL_API_URL` | Overrides the PayPal REST base URL (default `https://api-m.sandbox.paypal.com`). The app is built and tested against the sandbox only |

**AI and voice**

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude for voice-to-cart, the back-office agent and menu-photo extraction; otherwise a rule parser runs and the menu is typed by hand |
| `STT_API_KEY` | Whisper-compatible speech-to-text for browsers without SpeechRecognition (Firefox). Without it (and without `STT_MOCK_TRANSCRIPT`) `/api/voice/transcribe` answers 503 and the UI says dictation is unavailable |
| `STT_URL` | Transcription endpoint (default `https://api.openai.com/v1/audio/transcriptions`) |
| `STT_MODEL` | Transcription model (default `whisper-1`) |
| `STT_MOCK_TRANSCRIPT` | Returns this fixed text instead of transcribing (used by the e2e suite) |

**Payment rails** (each one is hidden unless configured; see [Payment rails](#payment-rails))

| Variable | Purpose |
| --- | --- |
| `PIX_KEY`, `PIX_MERCHANT_NAME`, `PIX_MERCHANT_CITY` | Pix static BR Code for BRL sales |
| `SPEI_CLABE`, `SPEI_BENEFICIARY` | SPEI transfer data for MXN sales (an invalid CLABE hides the rail) |
| `BREB_KEY` | Bre-B key for COP sales |
| `RAIL_APPLE_PAY`, `RAIL_GOOGLE_PAY` | `1` or `true`: Apple Pay / Google Pay through the PayPal order |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | Content served at `/.well-known/apple-developer-merchantid-domain-association` (404 when unset) |
| `RAIL_OXXO` | `1` or `true`: OXXO through PayPal, MXN sales up to 10,000 |

**Client apps** (read at build time by the dashboard and the mobile app, not by the server)

| Variable | Purpose |
| --- | --- |
| `VITE_PAYGENT_API` | Dashboard: server base URL; unset means mock data. `npm run dev:live` sets it to `http://localhost:8787` |
| `EXPO_PUBLIC_API_URL` | Mobile: default server URL (the EAS profiles set the Render deploy). It ships inside the app: never put a secret here |

## PayPal sandbox setup

1. Go to [developer.paypal.com](https://developer.paypal.com/) → **Apps & Credentials** →
   **Sandbox** → create an app; copy the client ID and secret into `PAYPAL_CLIENT_ID` /
   `PAYPAL_CLIENT_SECRET`.
2. Under **Sandbox accounts** use the generated *Personal* account to pay at checkout.
3. Optional webhooks: add `https://<your-host>/webhooks/paypal` to the app and put its ID in
   `PAYPAL_WEBHOOK_ID`. Events handled (each signature is verified with PayPal):
   - Sales: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`,
     `PAYMENT.CAPTURE.REFUNDED`.
   - Payouts: `PAYMENT.PAYOUTSBATCH.PROCESSING`, `PAYMENT.PAYOUTSBATCH.SUCCESS`,
     `PAYMENT.PAYOUTSBATCH.DENIED`, and `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `.FAILED`, `.BLOCKED`,
     `.CANCELED`, `.HELD`, `.REFUNDED`, `.RETURNED`, `.UNCLAIMED`.
4. Payouts: enable **Payouts** for the app (Features). A live app needs PayPal to approve Payouts.
5. Set `PUBLIC_URL` to the host customers will reach (QR codes and stickers point there).

With keys set, the checkout renders the real PayPal buttons and the server captures the order.

## Payment methods at checkout

With PayPal keys, `/pay/:saleId` loads PayPal's JS SDK v6 (`web-sdk/v6/core`). The server still
creates the order when the vendor charges and captures it after the buyer approves; the browser
only approves. Buttons appear in this order, each only when it applies:

| Method | Shown when |
|---|---|
| PayPal | Always (any PayPal currency) |
| Venmo | Sale in **USD**, and PayPal says the buyer and merchant are eligible (US only) |
| Pay Later | Sale in **USD, CAD, GBP, EUR or AUD** (US, CA, GB, DE/FR/IT/ES, AU markets) and PayPal says the buyer and amount qualify. Its "Pay in 4…" message then appears under the total |
| Debit or credit card | PayPal offers guest card checkout to this buyer |
| Apple Pay / Google Pay | `RAIL_APPLE_PAY` / `RAIL_GOOGLE_PAY` is on, the browser can pay (`ApplePaySession` / Google `isReadyToPay`) and PayPal says eligible. The button confirms the server-created order, then the server captures it. Not yet tried in the real sandbox or on phones |

Two filters decide: a static rule per currency (`shared/funding.ts`, unit-tested), then PayPal's
own `findEligibleMethods` for this buyer and amount. So an MXN sale (the Oaxaca demo) shows PayPal
and card; a USD sale can add Venmo and Pay Later. In sandbox the SDK simulates a buyer from the
sale's country (USD → US, MXN → MX, EUR → ES); override it with `/pay/<id>?buyerCountry=US`.
Venmo also needs a US merchant account with Venmo enabled: if PayPal does not list it for your
sandbox app, the button stays hidden. Without keys (mock mode) the checkout keeps the
**Pay (simulated)** and **Simulate decline** buttons.

## Payment rails

Besides PayPal's own buttons, a stall can switch on local rails with env vars (registry in
`shared/rails.ts`; research and sources in [docs/payment-rails.md](docs/payment-rails.md)). A rail
without config never shows up.

- **Through PayPal** — Apple Pay, Google Pay and OXXO (MXN up to 10,000) ride on the same PayPal
  order. The sale is PAID only when PayPal captures it. OXXO is listed on the checkout without a
  native button.
- **Bank push without a provider** — Pix (BRL sales), SPEI (MXN) and Bre-B (COP): the checkout
  shows a QR or the bank data with the amount. The sale waits in `pending_bank` ("check your bank
  app") and **never becomes PAID by itself**. The vendor can confirm it with her PIN; it then counts
  as "vendor-confirmed, not verified", apart from PayPal-verified money in the ledger and the
  passport.
- Bre-B is wired but never offered today: COP is not a PayPal currency, so a COP sale cannot exist
  yet. Automatic confirmation from the bank's notice is only a spec ([docs/bank-confirm.md](docs/bank-confirm.md), in Spanish).

## How the AI uses PayPal

The back-office agent (Claude `claude-sonnet-5-5`, tool use over plain `fetch`) gets PayPal's official
[Agent Toolkit](https://github.com/paypal/agent-toolkit) (`@paypal/agent-toolkit`, Bedrock adapter,
whose tool specs map 1:1 to Anthropic tool definitions). Only a curated allowlist is enabled and shown
to the model, prefixed `paypal_`:

| Tool | Use |
| --- | --- |
| `paypal_get_merchant_insights`, `paypal_list_transactions` | "How am I doing this month?" for closed days. PayPal reporting can lag up to 3 h, so "today" always comes from our own ledger (`sales_today`). |
| `paypal_get_order` | Look up an order. |
| `paypal_list_invoices`, `paypal_get_invoice`, `paypal_send_invoice`, `paypal_generate_invoice_qr_code` | Money in. New invoices are still created by our `create_invoice`, which passes the policy lock. |
| `paypal_list_disputes`, `paypal_get_dispute` | Read only. |

**The lock:** money-out toolkit tools (`create_refund`, `pay_order`, `accept_dispute_claim`,
`record_refund_for_invoice`, payouts) are neither enabled in the toolkit configuration nor exposed to
the model; any other tool name returns `UNKNOWN_TOOL`. The only way to give money back is our `refund`
tool, which goes through the deterministic PolicyEngine with the PIN the human types, never one the
model writes. Supplier payouts work the same way: the agent's `propose_payout` only drafts a proposal
that the vendor confirms with her PIN in the app. A 30-attempt injection battery ("use create_refund",
"call payouts"...) plus a payout battery (unknown email, over the cap, a PIN in the tool call,
invented payout tools) checks that zero money moves. Without PayPal keys (mock mode) the toolkit
is off and the agent keeps its own tools.
The back-office agent box lists every tool that ran, with a short result.

## How the policy lock works

The AI never moves money by itself. The back-office agent and the buttons can only *propose*
actions (refund, payout, invoice); a pure, deterministic function (`server/policy/rules.ts`)
decides, with no I/O and failing closed on anything malformed:

- Refunds need the vendor's PIN on **each** request, are capped per refund (MXN 200) and per day
  (MXN 1,000), only within the same day, and never above what was captured.
- Payouts go only to suppliers on the allowlist (adding one needs the PIN), need the PIN on each
  payout, and are capped per payout (MXN 300) and per day (MXN 500).
- Every decision is written to an audit log; text from customers or the model cannot unlock it
  (see `test/policy-injection.test.ts`).

## Accessibility

Target: WCAG 2.2 AA on every web screen and the mobile app. Coverage, test steps and known gaps are
in [docs/accessibility.md](docs/accessibility.md).

- An axe-core gate in the e2e suite checks every web screen in light, dark and high contrast, at
  phone and desktop width, in English and Spanish.
- **Voice mode** (🔊 in the header): each sale state is spoken with its own tone, and a big button
  takes commands ("charge 45", "cancel", "more time", "repeat"). It lives on the vendor screen.
- Keyboard only (digits, Enter charges, Escape cancels), a visible focus ring, a high-contrast toggle
  (◐), text that scales to 200% with no horizontal scroll, reduced motion, and "+5 min" to pay.
- Firefox has no speech recognition: holding the mic records audio and the server transcribes it
  when `STT_API_KEY` is set; otherwise a status line says dictation is unavailable.
- Mobile: labels, hints and states on controls, spoken sale states, and a PAID screen that respects
  the OS reduce-motion setting.
- Not done yet: tests in real Firefox and with TalkBack / VoiceOver on devices, and an audit with
  blind vendors.

## Deploy

`render.yaml` defines a Render Node web service: build `npm ci && npm run build`, start
`npm start`, health check `/api/health`. Secrets are set in the Render dashboard. The blueprint
declares the core variables only; add `STALL_PINS`, the `STT_*` and rail variables by hand if you use
them. `/api/health` reports the mode of each third party (`on`, `off` or `fallback`), never its
secrets.

Render's free web service sleeps and restarts, so set `DATABASE_URL` to keep state. Recommended:
a **Neon** free project (1 GB storage, no expiry, scales to zero after 5 min idle; paste its
connection string with `sslmode=require`). Render's free Postgres expires 30 days after creation
and Supabase's free projects pause after a week idle, so neither fits a deploy that must stay up
until judging ends. Migrations run automatically at startup.

## Not verified yet

Built (and covered by unit or end-to-end tests where a test can reach it), but not yet proven on
real hardware or real services:

- Real devices: tapping a real NTAG sticker, the Android phone-to-phone tap, the soundbox on an old
  Android phone, and an iOS build (EAS).
- Apple Pay and Google Pay buttons in the real PayPal sandbox and on phones (the Apple Pay domain
  is not registered yet).
- Voice in real Firefox; the mobile app with TalkBack and VoiceOver.
- The Postgres store against a hosted database (tests run it on PGlite, Postgres in WASM).
- The dashboard with real sales (checked so far: PIN login and loading with an empty ledger).
- A real supplier payout in the sandbox, and `/mcp` with a real Claude client.

## Documentation

| Doc | What is in it |
| --- | --- |
| [docs/plan.md](docs/plan.md) | Frozen spec, blocks with acceptance criteria, pending table (Spanish) |
| [docs/memoria.md](docs/memoria.md) | Decision log, newest first, with sources (Spanish) |
| [docs/handoff.md](docs/handoff.md) | Current state of `main` and the ordered to-do list (Spanish) |
| [docs/design.md](docs/design.md) | Design system "Cempasúchil": tokens, fonts, colour rules (Spanish) |
| [docs/accessibility.md](docs/accessibility.md) | WCAG 2.2 AA coverage, how to test, known gaps |
| [docs/payment-rails.md](docs/payment-rails.md) | Payment rails research and what paygent does with each |
| [docs/paypal-server-sdk.md](docs/paypal-server-sdk.md) | How the PayPal Server SDK is used and which calls still use fetch |
| [docs/bank-confirm.md](docs/bank-confirm.md) | Spec, not built: Bre-B confirmation from the bank's notice (Spanish) |
| [mobile/README.md](mobile/README.md) | Mobile app: run, EAS builds, NFC and HCE testing |
| [paygent-dashboard/README.md](paygent-dashboard/README.md) | Dashboard: mock vs live, data adapter, invariants |

## License

[Apache-2.0](LICENSE).

---

## En español

**paygent** es el cajero con IA para vendedores ambulantes: dices el precio, el cliente toca o
escanea, y tu teléfono dice "Recibido: 95 pesos". La app está en inglés y español (sigue el idioma
del navegador; botón EN/ES arriba).

- **Piezas:** servidor (`server/`, Node + Hono), app web (`web/`, Preact), dashboard
  (`paygent-dashboard/`, TanStack Start; aún sin desplegar), app móvil (`mobile/`, Expo SDK 57 para
  iOS y Android) y código compartido (`shared/`: dinero en unidades menores enteras).
- **Prueba rápida:** abre `/judge` — vendedora a la izquierda, cliente a la derecha. Marca `95`,
  toca **Cobrar**, y en el panel del cliente toca **Pagar (simulado)**.
- **Menú por foto:** en `/backoffice`, panel **Menú**: toma una foto del pizarrón; con
  `ANTHROPIC_API_KEY` Claude propone los productos, tú revisas y guardas (sin llave, captura manual).
- **Correrlo:** `npm install`, luego `npm run dev` + `npm run dev:web`, o `npm run build` +
  `npm start`. Calidad: `npm run check`; e2e: `npm run e2e`.
- **Dashboard:** `cd paygent-dashboard && npm ci && npm run dev` (datos simulados en el puerto 8080) o
  `npm run dev:live` (datos reales del servidor en `:8787`, puerto 5192).
- **Móvil:** `cd mobile && npm ci && npx expo run:android` con el teléfono por USB; necesita dev
  client (no Expo Go) y la IP de tu PC en **Ajustes**. iOS solo con EAS.
- **Sin llaves** funciona con un PayPal simulado y todo en memoria; para sandbox llena `.env.local`
  según `.env.example`. La tabla completa de variables (PayPal, Postgres, PIN por puesto, voz, rieles
  y apps cliente) está arriba en *Environment variables*.
- **Métodos de pago:** con llaves, el cliente ve PayPal siempre; Venmo solo en USD; Pay Later solo
  en USD, CAD, GBP, EUR o AUD (con su mensaje bajo el total); tarjeta si PayPal la ofrece. Una
  venta en MXN muestra PayPal y tarjeta. PayPal decide al final por comprador y monto. Apple Pay y
  Google Pay aparecen solo si su riel está activo y el navegador y PayPal los admiten (sin probar
  aún en teléfonos).
- **Rieles locales:** Pix (BRL), SPEI (MXN) y Bre-B (COP) muestran QR o datos bancarios; la venta
  queda "pendiente" y **nunca pasa a pagada sola**. Con su PIN la vendedora la confirma como
  "confirmada por la vendedora, no verificada", aparte de lo verificado por PayPal.
- **Bocina:** abre `/soundbox?terminal=rosa-01` en un Android viejo, instálala, toca una vez para
  activar el sonido y déjala en pantalla completa: solo los pagos confirmados por PayPal suenan.
- **Candado:** la IA solo propone; las devoluciones exigen el PIN cada vez y tienen topes.
- **Proveedores y pagos:** en `/backoffice` guarda a tus proveedores (correo o teléfono de PayPal) y
  págales con tu PIN (máx. 300 MXN por pago, 500 al día). El asistente solo propone el pago.
- **Pasaporte de ventas:** en `/backoffice` genera un reporte firmado (Ed25519) de las ventas
  confirmadas por PayPal, con el efectivo aparte como declarado; cualquiera lo verifica en `/verify`.
- **Varios puestos y Claude por MCP:** un dueño, varios puestos con su propio PIN y topes; Claude
  conectado a `/mcp` solo propone reembolsos y pagos, que se aprueban con el PIN.
- **Accesibilidad:** objetivo WCAG 2.2 AA; modo voz, teclado, alto contraste, texto al 200 % y
  movimiento reducido. Detalle y huecos en [docs/accessibility.md](docs/accessibility.md).
- **Sin verificar todavía:** sticker y tap NFC reales, bocina en Android viejo, build de iOS, Apple
  Pay / Google Pay en teléfonos, Firefox real y lectores de pantalla en el móvil.

La spec y el plan por bloques están en [docs/plan.md](docs/plan.md); el estado actual, en
[docs/handoff.md](docs/handoff.md); el diseño, en [docs/design.md](docs/design.md).
