<!--
  docs/payment-rails.md: investigación de rieles de pago (Pix, SPEI, Bre-B, Yape, SINPE, FedNow, OXXO, wallets...)
  y qué hace paygent con cada uno. Es la referencia de producto/fuentes; el código vive en shared/rails.ts.
  No confundir con docs/memoria.md (bitácora de decisiones) ni docs/plan.md (plan general del proyecto).
-->
# Payment rails

Researched 2026-10-07. "PayPal supports" means a PayPal REST integration (Orders v2 / JS SDK) can
take the method for a small merchant today. "Server confirmation" means our server can learn,
from a party other than the vendor, that the money arrived.

**Core invariant in paygent: a sale becomes `paid` only on the payment provider's confirmation
(PayPal capture `COMPLETED` or a verified webhook).** A rail with no provider can at most become
`vendor_confirmed` — shown as "vendor-confirmed, not verified" in the ledger and passport.

| Rail | Country | How it settles | PayPal supports | Server can confirm |
|---|---|---|---|---|
| Pix | BR | Instant push, 24/7, Central Bank SPI; static/dynamic QR (BR Code, EMV) | Limited release in PPCP (BR merchants, BRL) | Only via a PSP/provider (PayPal Pix, a bank API). Static key QR: no |
| SPEI / CoDi | MX | Instant push, 24/7, Banxico; CLABE + reference; CoDi = QR/NFC over SPEI | No | Only via a bank/PSP API (CEP lookup is after-the-fact, manual) |
| Bre-B | CO | Instant push, 24/7 (live since 2025-10-06), keys (llaves): phone, email, ID, alias | No | Only via a participant entity's API |
| Yape / Plin | PE | Wallet push (BCP / Interbank+others); interoperable since 2023 | No | No public merchant API for a small vendor; "Yape Empresas" via BCP |
| SINPE Móvil | CR | Instant push by phone number, BCCR | No | Only the receiving bank; no public merchant API |
| Transferencias 3.0 | AR | Instant transfers to CBU/CVU, interoperable QR (BCRA) | No | Via the acceptor/PSP that issued the QR |
| FedNow / RTP | US | Instant credit transfers between banks (Fed / The Clearing House) | No | Only through the receiving bank's API |
| Zelle | US | Bank-to-bank push via Early Warning | No | No public API for merchants |
| Venmo | US | PayPal-owned wallet, USD only | **Yes** (JS SDK, US merchants) | **Yes**, PayPal capture — already in checkout |
| Cash App Pay | US | Block wallet | No (via Square / Adyen etc.) | Via that PSP only |
| OXXO | MX | Cash voucher paid at the store; settles later (async) | **Yes** where offered (MXN, voucher flow, max 10,000 MXN) | **Yes**, PayPal webhook when the voucher is paid |
| Apple Pay | global | Card tokenized in wallet, card networks | **Yes** (Orders v2 `payment_source.apple_pay`, needs domain registration) | **Yes**, PayPal capture |
| Google Pay | global | Card tokenized in wallet, card networks | **Yes** (Orders v2 `payment_source.google_pay`) | **Yes**, PayPal capture |

## What paygent does

- **PayPal-confirmed rails** (Apple Pay, Google Pay, OXXO in MXN): same PayPal order, same
  server capture/webhook. The sale is `paid` only when PayPal says so.
- **Push rails without a provider** (Pix, SPEI, Bre-B): the checkout shows a QR / payment data
  built from the vendor's configured key. The sale moves to `pending_bank` ("pending — check your
  bank app") and never becomes `paid` by itself. The vendor may confirm with her PIN; the sale
  then becomes `vendor_confirmed` ("vendor-confirmed, not verified"), counted apart from verified
  sales in the ledger and in the signed passport's self-reported section.
- **Not implemented** (research only): Yape/Plin, SINPE Móvil, Transferencias 3.0, FedNow/RTP,
  Zelle, Cash App. Each would be a push rail with the same "not verified" treatment until a
  provider integration exists.
- Apple Pay / Google Pay buttons (PR #36; sandbox only, `web/src/wallet-buttons.ts`): SDK v6 components
  `applepay-payments` / `googlepay-payments`. Each button mounts only when its `RAIL_*` is on, the
  browser can pay (`ApplePaySession.canMakePayments()` / Google `isReadyToPay`) and PayPal's
  `findEligibleMethods` says eligible; otherwise nothing renders. The button confirms the order the
  server already created (`confirmOrder`) and then calls our `/api/sales/:id/capture`: the sale is
  `paid` only after PayPal's capture. Mock mode shows no wallet buttons and loads no wallet script.
- **Apple Pay domain registration (required):** enable Apple Pay on the PayPal app, then register
  the domain in the PayPal dashboard. Apple fetches
  `https://<domain>/.well-known/apple-developer-merchantid-domain-association`; set
  `APPLE_PAY_DOMAIN_ASSOCIATION` to that file's content (downloaded from PayPal) and the server
  serves it as text (404 when unset). Google Pay needs no file, but live requires enabling it on the
  PayPal app and Google's production approval.
- Known gaps (reviewed 2026-10-14):
  - The wallet logic has unit tests (eligibility, Apple/Google payment requests, the `.well-known`
    route) and e2e checks that mock mode renders no wallets, but the buttons have not been tried in
    the real sandbox or on devices (Safari on iPhone, Chrome on Android), and the Render domain is
    not registered with PayPal for Apple Pay yet.
  - OXXO is listed on the checkout as "through PayPal" with no native button.
  - Bre-B is wired but never offered today: sales are in PayPal currencies and COP is not one, so a
    COP sale cannot exist yet. Confirming Bre-B from the bank's notice instead of the PIN is a spec
    only: [bank-confirm.md](bank-confirm.md).
  - The rails panel on the checkout has not been tried in a browser with real rail config.
- Rails are a registry (`shared/rails.ts`): each one is enabled by config; missing config hides it.

| Env var | Enables |
|---|---|
| `PIX_KEY` (+ `PIX_MERCHANT_NAME`, `PIX_MERCHANT_CITY`) | Pix static BR Code with amount (BRL sales) |
| `SPEI_CLABE` (+ `SPEI_BENEFICIARY`) | SPEI transfer data (CLABE, amount, reference) for MXN sales; an invalid CLABE hides the rail |
| `BREB_KEY` | Bre-B key + amount (COP sales) |
| `RAIL_APPLE_PAY=1`, `RAIL_GOOGLE_PAY=1` (`1` or `true`) | Wallets through the PayPal flow; native buttons in sandbox when eligible |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | Content served at `/.well-known/apple-developer-merchantid-domain-association` |
| `RAIL_OXXO=1` | OXXO through PayPal, only for MXN sales up to 10,000 MXN |

## Sources

- Pix: https://www.bcb.gov.br/estabilidadefinanceira/pix ; BR Code manual: https://www.bcb.gov.br/estabilidadefinanceira/spb_brcode
- PayPal Pix (limited release): https://developer.paypal.com/limited-release/alternative-payment-methods/pix/overview/ ; https://newsroom.paypal-corp.com/2026-04-PayPal-Adds-Pix-to-Power-Growth-for-Millions-of-Small-Businesses-in-Brazil
- SPEI / CoDi: https://www.banxico.org.mx/servicios/sistema-pagos-electronicos-interbancarios-spei.html ; https://www.banxico.org.mx/sistemas-de-pago/codi-cobro-digital-banco-me.html
- Bre-B: https://banrep.gov.co/es/noticias/bre-b-semana-crece-expectativa-entrada-operacion-bre-b ; https://www.elheraldo.co/economia/2025/09/19/las-llaves-de-bre-b-del-banco-de-la-republica-empezaran-su-funcion-oficial-desde-el-6-de-octubre/
- Yape / Plin interoperability (BCRP): https://www.bcrp.gob.pe/sistema-de-pagos/interoperabilidad.html
- SINPE Móvil: https://www.bccr.fi.cr/sistema-de-pagos/sinpe-movil
- Transferencias 3.0: https://www.bcra.gob.ar/noticias/transferencias-3-0-se-completa-la-puesta-en-marcha-del-sistema-de-pagos-con-qr-interoperable/
- FedNow: https://www.frbservices.org/financial-services/fednow ; RTP: https://www.theclearinghouse.org/payment-systems/rtp
- Zelle: https://www.zellepay.com/
- Venmo via PayPal: https://developer.paypal.com/venmo
- Cash App Pay: https://developers.cash.app/cash-app-pay-partner-api/guides/welcome
- OXXO via PayPal: https://developer.paypal.com/oxxo
- Apple Pay / Google Pay via PayPal: https://developer.paypal.com/docs/checkout/apm/apple-pay/ ; https://developer.paypal.com/docs/checkout/apm/google-pay/
- Orders v2 alternative payment methods: https://developer.paypal.com/api/rest/integration/orders-api/api-use-cases/alternative-payment-methods

Links for BCRP, BCCR, Banxico, FedNow/RTP, Zelle and Cash App are the issuers' canonical pages and
were not re-read on 2026-10-07; re-check before relying on fine details.
