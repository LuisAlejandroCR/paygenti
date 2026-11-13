<!-- mobile/README.md: guía de la app nativa (Expo, iOS + Android) — pantallas, cómo correrla, compilar con
     EAS (APK y TestFlight), probar NFC/HCE y sus límites. Primero en inglés, luego sección en español.
     No confundir con README.md de la raíz (servidor + web) ni con docs/handoff.md (estado y pendientes). -->

# Paygenti mobile (iOS + Android)

React Native + Expo SDK 57 vendor app: push-to-talk sale, QR, live PAID (haptics + the voice box's
recorded chime, "¡Pagado!" and amount via `expo-audio`, #57),
soundbox mode, NFC sticker writer, Android phone-to-phone tap (HCE), a PIN back office and a month
summary. It talks to the existing Paygenti server API; money, currency and types come from the repo's
`shared/` (Metro `watchFolders` + the `@shared/*` alias), never copied.

Needs a **dev client** (not Expo Go): NFC, HCE and speech recognition are native modules.

## Screens (`app/`)

| Screen | What it does |
| --- | --- |
| `index.tsx` | Sale: push-to-talk or typed cart, keypad, Charge → QR of `PUBLIC_URL/t/:terminal`, countdown, live status, PAID flood; first run goes to onboarding |
| `resumen.tsx` | Month at a glance (#39): verified big, self-declared and "to confirm" apart (never summed), delta vs last month, day strip, bank transfers to confirm with the stall PIN |
| `perfil.tsx` | Stall switcher (#31) and links to settings, stall setup and back office. Goals, rails and statement import stay on the web |
| `backoffice.tsx` | PIN login, today's sales, refund with the PIN re-entered, today's ledger; with 2+ stalls: switcher, "All my Paygentis" and Claude's proposals to approve |
| `soundbox.tsx` | Kiosk mode: screen awake, one big state, each paid sale announced once even across reconnects |
| `nfc.tsx` | Write the sticker; Android tap mode (HCE) |
| `onboarding.tsx` | Stall name, country and charge currency |
| `settings.tsx` | Server URL, terminal id, language |

The month summary makes two `/ledger-range` calls (this month and last) and uses the stall's own
"today" from the server, not the phone's clock.

## Commands

```sh
cd mobile && npm ci
cd mobile && npm run check            # typecheck + lint + jest
cd mobile && npx expo-doctor
cd mobile && npx expo export --platform android   # JS bundle builds
```

CI runs typecheck, lint and jest for this folder (job `mobile` in `.github/workflows/ci.yml`). Known
local quirk: jest finds no tests when the repo sits under a `.claude/` folder (agent worktrees on
Windows); copy `mobile/` and `shared/` to a plain directory to run them there.

Server URL: `EXPO_PUBLIC_API_URL` (default `https://paygent-rirl.onrender.com`), also editable in the
app under **Settings** — for local dev use your computer's LAN IP, e.g. `http://192.168.1.20:8787`
(the phone cannot reach `localhost`). `EXPO_PUBLIC_*` values ship in the bundle: never put secrets there.

Charging: the sale screen asks for the stall PIN once and keeps a 7-day device token per server and
terminal (AsyncStorage); a back-office session of the same stall also works. Changing the server or
terminal asks again.

## Run on an Android device (Windows works)

1. Enable USB debugging, plug the phone in, check `adb devices`.
2. `cd mobile && npx expo run:android` — prebuilds `android/` (gitignored), builds and installs the dev
   client, starts Metro. Stop Metro with Ctrl+C when done.

## EAS runbook (for the human; the agent never logs in or builds)

Before any build, confirm the tree equals `origin/main`:

```sh
git fetch && git status --short && git log --oneline -1 && git log --oneline -1 origin/main
```

`git status --short` must print nothing and both log lines must match.

```sh
cd mobile && npx eas-cli login                       # Expo account alejoooo-team
# eas-cli init is already done: projectId lives in app.config.ts (EAS project @alejoooo-team/paygent, #59)
cd mobile && npx eas-cli build -p android --profile development   # dev client APK
cd mobile && npx eas-cli build -p android --profile preview       # internal APK
cd mobile && npx eas-cli build -p ios --profile development       # needs Apple Developer account
cd mobile && npx eas-cli build -p ios --profile production
cd mobile && npx eas-cli submit -p ios --profile production       # ascAppId/appleTeamId already in eas.json
```

- Profiles (`eas.json`): `development` (dev client, internal), `preview` (internal; Android APK),
  `production` (store, `autoIncrement`, version source remote). Every profile sets
  `EXPO_PUBLIC_API_URL` because EAS builds do not read `.env` files.
- **iOS has no local path here** (no Mac): it builds only on EAS cloud and needs a paid Apple
  Developer account with the NFC Tag Reading capability (the config plugin adds the `TAG` reader
  entitlement and `NFCReaderUsageDescription`; no `NDEF` entry, App Store Connect rejects it). The HCE
  pod is not linked on iOS. The iOS EAS build finished on 2026-11-12 (#59); not yet run on a device.
- iOS bundle id `com.alejoooo.paygent`; Android package `com.paygent.app`.
- The voice clips (#57) need one APK rebuild to ship `expo-audio`; if a clip cannot play, the app falls back to `expo-speech`.

## NFC testing

Sticker (iOS + Android): **NFC** screen → *Write sticker* → hold an NTAG213/215/216 to the phone.
The app writes one NDEF URI record with `PUBLIC_URL/t/:terminal` (from `GET /api/config`); it refuses
links larger than an NTAG215's 504 bytes (the sticker on the voice box). Check with any phone: tapping the sticker opens the pay page.

Phone-to-phone tap (Android only): **NFC** → *Start tap mode*; keep the screen on and unlocked; the
customer holds their phone to the back. The app emulates an NFC Forum Type 4 tag (AID
`D2760000850101`) holding the same URL.

HCE limits:
- **iOS cannot emulate tags** — Apple does not allow it; the app says so and offers sticker/QR.
- Readers: iPhones (XS and later) read Type 4 NDEF tags in background reading; older iPhones need an
  app. Android readers must have NFC on. Some phones route HCE only with the screen on.
- Other HCE apps (wallets) can win the AID routing; if the tap opens nothing, stop other NFC apps.
- `react-native-nfc-manager` and `react-native-hce` are excluded from expo-doctor's React Native
  Directory check (no New Architecture metadata); they must be verified on a real device.

---

## Español

App de la vendedora en Expo SDK 57 (iOS + Android): venta por voz, QR, PAGADO en vivo con vibración
y las grabaciones de la caja de voz (`expo-audio`), modo bocina, grabado de stickers NFC, tap teléfono a teléfono en Android (HCE),
administración con PIN, Resumen del mes (verificado, autodeclarado y por confirmar, nunca sumados) y
Perfil con cambio de puesto. Usa la API existente y el código de `shared/` (dinero, monedas, tipos).

- Requiere **dev client**, no Expo Go.
- Pruebas: `cd mobile && npm run check`. Jest no encuentra pruebas si el repo está bajo `.claude/`
  (worktrees de agentes); en ese caso copiar `mobile/` y `shared/` a otra carpeta.
- ⏳ No hay registro de pruebas en un dispositivo real (NFC, HCE, TalkBack/VoiceOver, texto grande).
- Android en Windows: `cd mobile && npx expo run:android` con el teléfono conectado por USB.
- iOS: solo con EAS en la nube y una cuenta de Apple Developer; aquí no hay Mac. El build de iOS en EAS
  terminó el 2026-11-12 (#59), sin probar en un iPhone. Las voces (#57) piden recompilar el APK.
- Antes de compilar: `git status --short && git log --oneline -1` debe coincidir con `origin/main`.
- Servidor: `EXPO_PUBLIC_API_URL` o **Ajustes** en la app (para desarrollo local usa la IP de la PC).
- Cobrar: la pantalla de venta pide el PIN del puesto una vez y guarda un token de dispositivo por 7 días
  (por servidor y terminal); una sesión del back office del mismo puesto también sirve.
- NFC: *Grabar sticker* escribe `PUBLIC_URL/t/:terminal` en un NTAG213/215/216. El *modo tap* solo
  existe en Android; el iPhone no puede emular tags (restricción de Apple) y la app ofrece sticker o QR.
