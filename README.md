<!-- README.md: portada pública de paygent para jurados y usuarios — qué es, prueba de 60 segundos,
     cómo correrlo, variables de entorno, sandbox de PayPal, el candado de políticas y licencia.
     No es la spec: la spec y el avance por bloques viven en docs/plan.md; el razonamiento en
     docs/memoria.md. -->
include breb and accessibility for blind people for example
# paygent

**The AI cashier for street vendors.** Say the price, the customer taps or scans, your phone says
"Received: 95 pesos".

Entry for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). The app is bilingual
(English / Español): it follows your browser language and has an EN/ES toggle in every header.

## What it is

- **Vendor screen (`/`)** — hold the mic and say "two mole tamales and an atole" (or type an
  amount), tap **Charge**, and a QR / NFC sticker link opens the sale for the customer.
- **Customer checkout (`/pay/:saleId`, reached via `/t/:terminal`)** — shows the stall, the items
  and the total before paying with PayPal.
- **Paid announcement** — the vendor's phone turns green and says the amount out loud
  (en-US or es-MX voice).
- **Back office (`/backoffice`, PIN `1234` in the demo)** — today's sales, cash reconcile, invoice
  with QR, refunds, and an optional Claude assistant. Money only moves through a deterministic
  policy lock.

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

Quality gate: `npm run check` (Biome lint, TypeScript, Vitest).

## Environment variables

Copy `.env.example` to `.env.local`. Every value is optional.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `8787`) |
| `PUBLIC_URL` | Base URL printed in QR codes and NFC stickers |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal sandbox app; without them the mock gateway runs |
| `PAYPAL_WEBHOOK_ID` | Verifies `/webhooks/paypal` signatures |
| `ANTHROPIC_API_KEY` | Claude for voice-to-cart and the back-office agent; otherwise a rule parser runs |
| `VENDOR_PIN` | PIN that unlocks the back office and refunds (demo default `1234`) |
| `DATABASE_URL` | Postgres connection string; sales, catalog, audit log, PIN lockouts and daily refund caps then survive restarts. Unset: everything lives in memory |
| `PASSPORT_SIGNING_KEY` | Ed25519 private key (PKCS8 PEM or base64 DER) that signs sales passports; otherwise an ephemeral demo key |

## PayPal sandbox setup

1. Go to [developer.paypal.com](https://developer.paypal.com/) → **Apps & Credentials** →
   **Sandbox** → create an app; copy the client ID and secret into `PAYPAL_CLIENT_ID` /
   `PAYPAL_CLIENT_SECRET`.
2. Under **Sandbox accounts** use the generated *Personal* account to pay at checkout.
3. Optional webhooks: add `https://<your-host>/webhooks/paypal` to the app, subscribe to
   `PAYMENT.CAPTURE.*`, and put its ID in `PAYPAL_WEBHOOK_ID`.
4. Set `PUBLIC_URL` to the host customers will reach (QR codes and stickers point there).

With keys set, the checkout renders the real PayPal buttons and the server captures the order.

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
model writes. A 30-attempt injection battery ("use create_refund", "call payouts"...) checks that zero
money moves. Without PayPal keys (mock mode) the toolkit is off and the agent keeps its own tools.
The back-office agent box lists every tool that ran, with a short result.

## How the policy lock works

The AI never moves money by itself. The back-office agent and the buttons can only *propose*
actions (refund, payout, invoice); a pure, deterministic function (`server/policy/rules.ts`)
decides, with no I/O and failing closed on anything malformed:

- Refunds need the vendor's PIN on **each** request, are capped per refund (MXN 200) and per day
  (MXN 1,000), only within the same day, and never above what was captured.
- Payouts go only to an allow-list with a daily cap.
- Every decision is written to an audit log; text from customers or the model cannot unlock it
  (see `test/policy-injection.test.ts`).

## Deploy

`render.yaml` defines a Render Node web service: build `npm ci && npm run build`, start
`npm start`, health check `/api/health`. Secrets are set in the Render dashboard.

Render's free web service sleeps and restarts, so set `DATABASE_URL` to keep state. Recommended:
a **Neon** free project (1 GB storage, no expiry, scales to zero after 5 min idle; paste its
connection string with `sslmode=require`). Render's free Postgres expires 30 days after creation
and Supabase's free projects pause after a week idle, so neither fits a deploy that must stay up
until judging ends. Migrations run automatically at startup.

## License

[Apache-2.0](LICENSE).

---

## En español

**paygent** es el cajero con IA para vendedores ambulantes: dices el precio, el cliente toca o
escanea, y tu teléfono dice "Recibido: 95 pesos". La app está en inglés y español (sigue el idioma
del navegador; botón EN/ES arriba).

- **Prueba rápida:** abre `/judge` — vendedora a la izquierda, cliente a la derecha. Marca `95`,
  toca **Cobrar**, y en el panel del cliente toca **Pagar (simulado)**.
- **Menú por foto:** en `/backoffice`, panel **Menú**: toma una foto del pizarrón; con
  `ANTHROPIC_API_KEY` Claude propone los productos, tú revisas y guardas (sin llave, captura manual).
- **Correrlo:** `npm install`, luego `npm run dev` + `npm run dev:web`, o `npm run build` +
  `npm start`.
- **Sin llaves** funciona con un PayPal simulado; para sandbox llena `.env.local` según
  `.env.example`.
- **Bocina:** abre `/soundbox?terminal=rosa-01` en un Android viejo, instálala, toca una vez para
  activar el sonido y déjala en pantalla completa: solo los pagos confirmados por PayPal suenan.
- **Candado:** la IA solo propone; las devoluciones exigen el PIN cada vez y tienen topes.
- **Pasaporte de ventas:** en `/backoffice` genera un reporte firmado (Ed25519) de las ventas
  confirmadas por PayPal, con el efectivo aparte como declarado; cualquiera lo verifica en `/verify`.

La spec y el plan por bloques están en [docs/plan.md](docs/plan.md).
