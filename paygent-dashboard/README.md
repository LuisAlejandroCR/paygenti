<!-- paygent-dashboard/README.md: guía del dashboard web de la vendedora (TanStack Start) — qué es, modo mock
     vs. modo real, comandos, la capa de datos (api.ts + adapter.ts), invariantes y lo que sigue simulado.
     No confundir con README.md de la raíz (servidor + app web) ni con mobile/README.md (app Expo); el estado
     del proyecto vive en un repo privado. -->

# paygent dashboard

The vendor's month at a glance, on the web: how much PayPal verified, how much she declared, what is
still waiting for her bank, and where it came from. It is a separate app from the vendor screen in
`web/`; it reads the same Paygent server.

Built first in [Lovable](https://lovable.dev) (TanStack Start, React 19, Tailwind CSS 4, Recharts,
AG Grid, Radix UI) and delivered as a source ZIP, then wired to the server in PR #40. Deployed to
Vercel in live mode against the Render server (see [Deploy](#deploy)); not part of CI.

## Screens

One route (`src/routes/index.tsx`); the state lives in search params (`tab`, `section`, `month`,
`stall`, `rail`, `filter`, `q`), so every view has a shareable URL.

- **Resumen**: wine card with the verified month total, KPIs, a day strip, shortcut pills (charge,
  confirm transfer, refund, payout, import, export), pace against last month, rails and top products.
- **Ventas**: sales count, ticket, best day and peak hour; daily chart with drag-to-zoom, weekday bars
  and an hour heatmap.
- **Movimientos**: month tiles that double as filters (verified in, self-declared, pending, out),
  search, AG Grid on desktop and swipeable cards on phones (confirm a pending transfer or refund, with
  the PIN).
- **Perfil**: stall card plus sections for payment rails, savings goals and preferences (language
  es / pt / en, dark mode, large text, privacy mode that hides amounts).

Every chart has a "view as table" toggle and PNG / CSV export. No horizontal scroll at 375 px.

## Mock vs live

| | Mock (default) | Live |
| --- | --- | --- |
| Start | `npm run dev` → <http://localhost:8080> | `npm run dev:live` → <http://localhost:5192> |
| Data | Seeded in `src/lib/mock.ts`; "today" is fixed at 2026-10-07 12:00 | The Paygent server through `src/lib/api.ts` |
| Header | "Sandbox" badge (amber) | "Live" badge (green) |
| PIN | `1234` for every stall, checked in the browser | The stall's real PIN, checked by the server |

Live mode is on when `VITE_PAYGENT_API` is set. `npm run dev:live` sets it to `http://localhost:8787`
unless you set another value, and the Vite dev server proxies `/api` there. The proxy is needed because
the Paygent server sends no CORS headers, so the browser has to stay on one origin. Start the server
first (`npm run dev` at the repo root).

In live mode the PIN opens an 8-hour session for that stall (`POST /api/stalls/:id/backoffice/session`).
The session token stays in `sessionStorage` for the tab only.

Endpoints the live mode uses: `GET /api/stalls`; under `/api/stalls/:id/backoffice/`: `session`,
`ledger?date=` (day by day for this month and last month, 6 at a time), `footprint`, `savings-goal`
(`PUT`), `refunds`, `suppliers`, `payouts`, `statement`, `approvals`; and
`POST /api/sales/:id/vendor-confirm`.

### Still simulated in live mode

- **Charge (Cobrar)**: the flow is a local simulation. It shows a made-up link and turns "paid" after
  3.5 seconds without calling the server or PayPal. Do not demo it as a real charge. Charges belong to
  the vendor screen (`web/`) or the mobile app.
- Rail metrics (conversion, time to confirm) are hidden, and the rail on/off switch is disabled: the
  server picks the rail per sale and has no endpoint for either.
- Goals: the server keeps one savings goal per stall, without a name or deadline.

## Commands

```bash
npm ci               # package-lock.json is the lockfile in use (bun.lock is left over from Lovable)
npm run dev          # mock mode on :8080
npm run dev:live     # live mode on :5192, proxy /api -> :8787
npm test             # Vitest (jsdom): src/test/adapter.test.ts and src/test/app-routing.test.tsx
npm run lint         # ESLint
npx tsc --noEmit     # typecheck (there is no script for it)
npm run build        # Nitro build; the Lovable config's default preset is cloudflare-module
```

A production build on another origin needs the server to allow it: set `CORS_ORIGINS` on the server
to the dashboard's exact origin (e.g. `https://dash.example.com`; comma-separated for several). Without
it the server sends no CORS headers, so serve the dashboard from the same origin or behind a proxy.

## Deploy

Vercel project `paygenti-dashboard`, root directory `paygent-dashboard/`, in **live mode**:
`vercel.json` builds with `VITE_PAYGENT_API=https://paygent-rirl.onrender.com` and
`NITRO_PRESET=vercel npm run build`, so the browser calls the Render server directly and each stall
logs in with its real PIN. The server must list the dashboard's origin in `CORS_ORIGINS`
(`https://paygenti-dashboard.vercel.app`), or every call fails. Nitro writes the Vercel
Build Output (`.vercel/output`) instead of the Cloudflare bundle. Preview: `npx vercel deploy --target=preview`
from this folder (plain `npx vercel deploy` goes to production with CLI 65). For mock mode, drop
`VITE_PAYGENT_API` from the build command. To try the same build locally: `NITRO_PRESET=node-server npm run build`, then
`node .output/server/index.mjs` (port 3000, or `PORT`).

## Data layer

- `src/lib/api.ts`: the only module that fetches. In mock mode it serves `mock.ts`; in live mode it
  calls the server with the stall's session token and caches the month per stall. A
  `401 SESSION_REQUIRED` drops the token and the UI asks for the PIN again.
- `src/lib/adapter.ts`: pure mapping from server JSON (stalls, ledger rows, payouts, footprint,
  statement months, savings goal, approvals) to the dashboard types in `src/lib/types.ts`. No fetch,
  so it is unit-tested.
- `src/lib/stats.ts`: month, day and hour aggregations for the charts.
- `src/lib/i18n.ts` and `src/lib/prefs.tsx`: texts in es / pt / en, money formatting and per-device
  preferences (stored in `localStorage`).

## Invariants

1. **Verified** means PayPal captured it. Cash, vendor-confirmed bank transfers and imported bank
   statements are **self-declared**. The two are shown side by side and never added together.
2. `pending_bank` never counts as paid or as a sale; it shows as "to confirm" in amber.
3. Money moves (refund, payout, statement import, confirming a transfer) send the stall PIN to the
   server, which checks it again. The dashboard has no policy rules of its own.
4. No payer names: the item label comes from the sale lines, and the server ledger carries none.
5. Claude's proposals (approvals) appear as notices without the model's note, which is untrusted text.
6. Amounts arrive in integer minor units and are converted with each currency's exponent.

Colours and tokens follow `src/styles.css`.

## Pending

- Test live mode with real sales on the server (so far: PIN login and loading with an empty ledger).
- Wire Charge to the server, or hide it in live mode.
- A monthly endpoint on the server would replace up to 62 ledger calls per load.
- Add the dashboard to CI (`npm test`, lint, typecheck).
- A UI/UX pass is in progress on `feat/dashboard-ux-pass` (2026-10-14, not merged).

Routing conventions for `src/routes/`: [src/routes/README.md](src/routes/README.md).

---

## Español

Panel web del mes de la vendedora: lo verificado por PayPal, lo autodeclarado y lo que espera
confirmación del banco, siempre por separado. Nació en Lovable y se conectó al servidor en el PR #40;
se despliega en Vercel en modo simulado (proyecto `paygenti-dashboard`) y aún no corre en CI.

- `npm ci`, luego `npm run dev` (datos simulados, puerto 8080, PIN `1234`) o `npm run dev:live` (datos
  reales del servidor en `:8787`, puerto 5192, PIN real de cada puesto).
- `npm test` corre las pruebas del adaptador y del ruteo.
- En modo real, **Cobrar sigue simulado**: marca "pagado" a los 3,5 s sin tocar el servidor. No usarlo en
  la demo como cobro real.
- Invariantes: verificado y autodeclarado nunca se suman; `pending_bank` nunca cuenta como pagado; el PIN
  viaja al servidor en cada movimiento de dinero; nunca hay nombres de pagador.
