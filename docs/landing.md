<!-- docs/landing.md: la landing pública de Paygenti y su despliegue en Vercel — qué archivos la forman,
     de dónde sale cada video (ElevenLabs y grabaciones reales), cómo reemplazarlos y los pasos y
     riesgos de Vercel frente a Render. No es la portada del repo (README.md) ni el razonamiento de
     decisiones (docs/memoria.md) ni el estado para un chat nuevo (docs/handoff.md). -->
# Landing de Paygenti

Página estática en español, mobile-first, que solo cuenta lo que la app ya hace.

| Dónde | URL |
| --- | --- |
| Render (app completa) | `/landing.html` — `/` sigue siendo la pantalla de cobro |
| Vercel | `/` es la landing; la app vive en `/app`, `/judge`, `/soundbox`… |

## Archivos

| Archivo | Qué es |
| --- | --- |
| `web/landing.html` | Marcado: hero, cómo funciona, producto, confianza, CTA final, Open Graph |
| `web/src/landing.css` | Estilos solo de la landing, sobre los tokens de `web/src/styles.css` |
| `web/src/landing.ts` | Videos: fallback, carga diferida, `prefers-reduced-motion` |
| `web/public/media/` | Videos y posters (abajo) |
| `e2e/landing.spec.ts` | axe AA claro/oscuro, sin desborde 320–1280, enlaces ≥44 px, fallbacks, teclado |
| `scripts/record-landing.ts` | `npm run landing:record`: vuelve a grabar la app real a tamaño teléfono |
| `scripts/vercel-pages.ts` + `vercel.json` | Build y rutas de Vercel |

## Videos

| Archivo | Origen | Nota |
| --- | --- | --- |
| `hero-person.mp4` / `.jpg` | ElevenLabs, Veo 3.1 Lite, 6 s, 9:16, 720p | Rosa (clip 1). Sin texto, pantallas ni logos |
| `hero-person.es.vtt` | A mano, tiempos con `silencedetect` | Subtítulos **apagados por defecto** |
| `app-charge.mp4` / `.jpg` | `npm run landing:record` | Pantalla de cobro real: PIN, $95, QR, PAGADO |
| `app-checkout.mp4` / `.jpg` | `npm run landing:record` | Checkout real del cliente (pago simulado) |
| `voicebox-real.mp4` / `.jpg` | Video del voice box grabado por el equipo | Estados reales del ESP32 |

- Flow de ElevenLabs: <https://elevenlabs.io/app/flows/nNqhJu0if1deP3suRZFb>. Los nodos de los clips
  2 (pasos, 8 s) y 3 (cierre, 6 s) ya están escritos y **sin generar** (~2.424 y ~1.818 créditos).
  Para que sea la misma Rosa, conectar un frame del clip 1 como `start_frame` antes de generarlos.
- **Reemplazar el video de Rosa:** sobrescribir `web/public/media/hero-person.mp4` (H.264, `+faststart`)
  y `hero-person.jpg`, y ajustar los tiempos de `hero-person.es.vtt`. Si `hero-person.mp4` falta o no
  es un video, el hero muestra solo la grabación real `app-charge.mp4` y cambia su pie de foto.

## Vercel

Vercel sirve la landing y la app web estática; `/api/*` y `/t/*` se reenvían al servidor de Render
(`https://paygent-rirl.onrender.com`), que guarda la base de datos, las llaves de PayPal y las passkeys.
Ningún secreto llega al front: Vercel no necesita variables de entorno.

1. `npm install`
2. `npm run check` (lint, typecheck, tests) y `npm run e2e`
3. `npm run build:vercel` (Vite + landing como `index.html`, app como `app.html`)
4. `vercel` (preview) y luego `vercel --prod`
5. En Render, poner `PASSKEY_ORIGINS=https://<tu-dominio>.vercel.app` para que Face ID / huella
   funcionen también desde Vercel.

Riesgos conocidos del proxy:

- **Bloqueo del PIN por IP:** detrás de Vercel, Render ve las IP de salida de Vercel. Varios jurados
  pueden compartir llave de bloqueo; con el PIN de demo correcto no pasa nada.
- **SSE (`/events`) por el proxy:** si Vercel corta la conexión, `EventSource` se reconecta solo.
- **Render free duerme:** la primera llamada tras 15 min tarda ~1 min.
- **Offline:** el service worker guarda `/` como shell; en Vercel `/` es la landing.
