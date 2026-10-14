<!-- docs/submission.md: BORRADOR en inglés de la entrega al PayPal AI Hackathon — texto para Devpost, guion
     del video (< 3 min) con lista de tomas y checklist previa al envío. Lo edita el dueño antes de enviar.
     No es la portada pública (README.md) ni el estado del proyecto (docs/handoff.md); cada afirmación sale
     de README, docs/plan.md, docs/memoria.md o docs/handoff.md. -->

# paygent — hackathon submission (DRAFT)

> **DRAFT for the owner to edit.** Written 2026-10-14 from `README.md`, `docs/plan.md`,
> `docs/memoria.md` and `docs/handoff.md`; nothing here claims more than those say. Lines marked **[OWNER]** need your
> input. Deadline: **2026-11-12 12:00 PT** (PST, UTC−8: 20:00 UTC, 15:00 in Bogotá).

## Devpost text

**Tagline:** The AI cashier for street vendors: say the price, the customer taps, your phone says "paid".

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
- **"Received: 95 pesos".** The server captures the order with PayPal, and only then does the vendor's
  phone turn green and say the amount. An old Android phone on the counter can act as a soundbox. A fake
  screenshot stays silent, because only a server-side capture makes a sound.
- **A back office that cannot be talked into moving money.** It has the day's ledger, cash reconcile,
  invoices with QR, refunds and payouts to suppliers, plus a Claude assistant with an allowlisted subset
  of PayPal's Agent Toolkit. Every money move goes through a deterministic policy lock: the vendor's PIN
  on every request, caps per refund and per day, and payouts only to allowlisted suppliers. The AI
  proposes and the lock decides.
- **A sales passport.** It is a signed (Ed25519) report of PayPal-verified sales that anyone can check at
  `/verify` without logging in. Self-reported cash and imported bank statements are shown apart, never
  added in. It holds descriptive indicators, never a credit score.
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
- **Clients:** Preact + Vite web app; Expo SDK 57 app for iOS and Android; a TanStack Start dashboard for
  the month view (not deployed yet).
- **Tests:** Vitest (348 tests at the last merge, PR #40), Playwright end-to-end with an axe
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

- Real-device trials: NFC sticker, Android tap, soundbox on an old phone, iOS build.
- Interviews with vendors, and ten sales dictated by someone else.
- Confirming Bre-B transfers from the bank's own notice instead of the PIN (spec written, not built).
- An ESP32 soundbox, and deploying the month dashboard.

### Built with

TypeScript · Node.js · Hono · Preact · Vite · React · TanStack Start · Tailwind CSS · Recharts ·
AG Grid · Expo · React Native · PayPal Orders v2 · PayPal Server SDK · PayPal JS SDK v6 · PayPal Payouts ·
PayPal Invoicing · PayPal webhooks · PayPal Agent Toolkit · Venmo · Pay Later · Apple Pay · Google Pay ·
Claude (Anthropic API) · Model Context Protocol · PostgreSQL · Neon · PGlite · zod · Web NFC · Web Speech
API · MediaRecorder · WebCrypto (Ed25519) · Vitest · Playwright · axe-core · Biome · GitHub Actions ·
Render

**[OWNER]** Check that every tag is one Devpost offers. Drop Neon if `DATABASE_URL` is still unset on
submission day. Venmo never showed in our sandbox (memoria 2026-10-07: the sandbox merchant is not
listed as Venmo-eligible), and Apple Pay / Google Pay are untested on phones: keep those tags only if the
video or a test shows them working.

## Video script (English, under 3 minutes)

Shoot on real devices. Each row marked ⚠ depends on something not yet verified on hardware (see
`docs/handoff.md`); test it before the shoot day.

| Time | Shot (what the camera sees) | Voice-over | On screen |
| --- | --- | --- | --- |
| 0:00–0:15 | A stall at a market; the vendor's hands busy; her phone propped on the counter | "Street vendors work with their hands full, and most of their money is cash that no lender can see." | paygent: the AI cashier for street vendors |
| 0:15–0:40 | Close-up of the vendor's phone: she holds the mic and says "dos tamales de mole y un atole"; the cart fills; she taps **Cobrar** | "Rosa just says the order. Claude turns it into a cart from her own menu — it can't invent an item or a price." | Claude Haiku → cart, checked against the catalog |
| 0:40–1:05 | ⚠ The customer taps the NFC sticker with their own phone; the checkout opens with stall, items and total; they pay with a PayPal sandbox account | "The customer taps the sticker and pays on their own phone, with PayPal, card, or whatever PayPal offers them." | Tap → PayPal checkout (JS SDK v6) |
| 1:05–1:25 | ⚠ The old Android soundbox on the counter turns green: **PAID**, "Recibido: 95 pesos" | "Only a payment our server captured with PayPal makes a sound. A fake screenshot stays silent." | Server capture = confirmation |
| 1:25–2:00 | Back office on the phone: the vendor asks the assistant to refund 2,000 pesos; the lock refuses (over the cap); then a 150-peso refund asks for her PIN again and goes through | "The assistant can propose a refund, but it can't move money. A deterministic lock checks the PIN every time and enforces the caps." | The AI proposes. The lock decides. |
| 2:00–2:30 | The sales passport QR on the vendor's phone; a second phone scans it → `/verify` shows VALID; one number edited → INVALID | "Her sales become a signed passport anyone can check — PayPal-verified sales apart from the cash she declares." | Ed25519-signed · verified ≠ self-reported |
| 2:30–2:50 | Quick montage: a payout to the masa supplier with the PIN, the stall switcher, Claude over MCP proposing a refund into the approvals inbox, voice mode | "Payouts to suppliers, several stalls, Claude over MCP — and the same rule everywhere: AI proposes, the vendor decides." | paygent · repo and demo links |

**[OWNER]** Record on a sandbox setup with `DATABASE_URL` set so nothing vanishes between takes; keep
PINs off camera; blur any real email; do not film the root PDFs or anything with personal data.

## Pre-submission checklist

- [ ] **Repo public, no secrets.** Before flipping visibility: confirm no `.env*`, keys, `CLAUDE.md`,
      `AGENTS.md` or PDFs are tracked (`git ls-files`), and run a secret scan over the full history, since
      deleting a file in a commit does not remove it from history.
- [ ] **Private docs decided.** Choose what stays out of the public repo (`docs/memoria.md`,
      `docs/handoff.md`, this file). `LEARNINGS.md` is untracked and stays that way. If docs are removed,
      prune the README "Documentation" table.
- [ ] **Deploy live until 2026-12-15.** `DATABASE_URL` (Neon) set on Render and `/api/health` shows
      `database: on` (it showed `off` on 2026-10-14). `PASSPORT_SIGNING_KEY`, `STALL_PINS` and
      `PUBLIC_URL` set. Optional: `STT_API_KEY`, wallet rails and `APPLE_PAY_DOMAIN_ASSOCIATION`.
- [ ] **Sandbox re-check.** One real sandbox sale captured and refunded after the Server SDK switch; one
      supplier payout to a sandbox personal account.
- [ ] **Clean-browser run.** Someone outside the team opens `/judge` in a fresh browser and completes the
      60-second flow (plan item 7).
- [ ] **Video** under 3 minutes, in English, on real devices, uploaded where Devpost accepts it.
- [ ] **Devpost** text pasted from above, tags checked, screenshots, repo link, demo link, and judge notes
      (`/judge`, demo PIN `1234`, no keys needed).
- [ ] **Submit before 2026-11-12 12:00 PT.**
