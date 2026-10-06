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

## PayPal sandbox setup

1. Go to [developer.paypal.com](https://developer.paypal.com/) → **Apps & Credentials** →
   **Sandbox** → create an app; copy the client ID and secret into `PAYPAL_CLIENT_ID` /
   `PAYPAL_CLIENT_SECRET`.
2. Under **Sandbox accounts** use the generated *Personal* account to pay at checkout.
3. Optional webhooks: add `https://<your-host>/webhooks/paypal` to the app, subscribe to
   `PAYMENT.CAPTURE.*`, and put its ID in `PAYPAL_WEBHOOK_ID`.
4. Set `PUBLIC_URL` to the host customers will reach (QR codes and stickers point there).

With keys set, the checkout renders the real PayPal buttons and the server captures the order.

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

## License

[Apache-2.0](LICENSE).

---

## En español

**paygent** es el cajero con IA para vendedores ambulantes: dices el precio, el cliente toca o
escanea, y tu teléfono dice "Recibido: 95 pesos". La app está en inglés y español (sigue el idioma
del navegador; botón EN/ES arriba).

- **Prueba rápida:** abre `/judge` — vendedora a la izquierda, cliente a la derecha. Marca `95`,
  toca **Cobrar**, y en el panel del cliente toca **Pagar (simulado)**.
- **Correrlo:** `npm install`, luego `npm run dev` + `npm run dev:web`, o `npm run build` +
  `npm start`.
- **Sin llaves** funciona con un PayPal simulado; para sandbox llena `.env.local` según
  `.env.example`.
- **Candado:** la IA solo propone; las devoluciones exigen el PIN cada vez y tienen topes.

La spec y el plan por bloques están en [docs/plan.md](docs/plan.md).
