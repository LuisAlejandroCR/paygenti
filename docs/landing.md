<!-- docs/landing.md: la landing pública de Paygenti y su despliegue en Vercel — qué archivos la forman,
     de dónde sale cada video (ElevenLabs y grabaciones reales), cómo reemplazarlos y los pasos y
     riesgos de Vercel frente a Render. No es la portada del repo (README.md) ni el razonamiento de
     decisiones (docs/memoria.md) ni el estado para un chat nuevo (docs/handoff.md). -->
# Landing de Paygenti

Página estática en español e inglés (botón ES / EN en el encabezado), mobile-first, que solo cuenta
lo que la app ya hace. Primera visita: idioma del navegador (`es*` → ES, si no EN); la elección se
guarda en `localStorage` (`paygent.locale`, la misma llave que usan las apps vía `web/src/i18n.ts`).

| Dónde | URL |
| --- | --- |
| Render (app completa) | `/landing.html` — `/` sigue siendo la pantalla de cobro |
| Vercel | `/` es la landing; la app vive en `/app`, `/judge`, `/soundbox`… |

## Archivos

| Archivo | Qué es |
| --- | --- |
| `web/landing.html` | Marcado: hero, cómo funciona, producto, confianza, CTA final, Open Graph |
| `web/src/landing.css` | Estilos solo de la landing, sobre los tokens de `web/src/styles.css` |
| `web/src/landing.ts` | Videos: fallback, carga diferida, `prefers-reduced-motion`; botón ES / EN |
| `web/src/landing-strings.ts` | Textos ES/EN, por llave `data-i18n*` de `landing.html` |
| `web/public/qr-judge.svg` | QR estático a `https://paygenti.vercel.app/judge` (tarjeta "Ábrelo en tu teléfono" y simulador) |

El hero incluye un **simulador de venta** de 4 pasos (solo front-end, rotulado como simulación, sin
llamadas a la API): "Siguiente paso" a mano, "Reproducir solo" con temporizador, oculto con
`prefers-reduced-motion`.
| `web/public/media/` | Videos y posters (abajo) |
| `e2e/landing.spec.ts` | axe AA claro/oscuro, sin desborde 320–1280, enlaces ≥44 px, fallbacks, teclado |
| `scripts/record-landing.ts` | `npm run landing:record`: vuelve a grabar la app real a tamaño teléfono |
| `scripts/vercel-pages.ts` + `vercel.json` | Build y rutas de Vercel |

## Videos

| Archivo | Origen | Nota |
| --- | --- | --- |
| `hero-person.mp4` / `.jpg` | ElevenLabs, Veo 3.1 Lite, 6 s, 9:16, 720p | Rosa (clip 1). Sin texto, pantallas ni logos |
| `hero-person.es.vtt` / `.en.vtt` | A mano, tiempos con `silencedetect` | Subtítulos **apagados por defecto**; si se encienden, siguen el idioma elegido |
| `app-charge.mp4` / `.jpg` | `npm run landing:record` | Pantalla de cobro real: PIN, $95, QR, PAGADO |
| `app-checkout.mp4` / `.jpg` | `npm run landing:record` | Checkout real del cliente (pago simulado) |
| `voicebox-real.mp4` / `.jpg` | Video del voice box grabado por el equipo | Estados reales del ESP32 |

- Flow de ElevenLabs: <https://elevenlabs.io/app/flows/nNqhJu0if1deP3suRZFb>. Los nodos de los clips
  2 (pasos, 8 s) y 3 (cierre, 6 s) ya están escritos y **sin generar** (~2.424 y ~1.818 créditos).
  Para que sea la misma Rosa, conectar un frame del clip 1 como `start_frame` antes de generarlos.
- **Reemplazar el video de Rosa:** sobrescribir `web/public/media/hero-person.mp4` (H.264, `+faststart`)
  y `hero-person.jpg`, y ajustar los tiempos de `hero-person.es.vtt`. Si `hero-person.mp4` falta o no
  es un video, el hero muestra solo la grabación real `app-charge.mp4` y cambia su pie de foto.

### Video de la demo (hueco listo)

- **Dónde:** `web/public/media/demo.mp4` y su póster `web/public/media/demo.jpg` (mismos nombres
  exactos). Se muestra en la sección "Mira la demo completa" (`#demo`), debajo del hero.
- **Formato:** MP4 H.264 + AAC, 16:9 (1280×720), `+faststart`, idealmente < 15 MB (máx. ~25 MB).
  `ffmpeg -i grabacion.mov -vf scale=1280:-2 -c:v libx264 -crf 26 -preset slow -c:a aac -b:a 96k -movflags +faststart web/public/media/demo.mp4`
  y el póster: `ffmpeg -ss 2 -i web/public/media/demo.mp4 -frames:v 1 -q:v 4 web/public/media/demo.jpg`.
- **Comportamiento:** la sección está `hidden` y solo aparece si `/media/demo.mp4` responde como
  video. Sin archivo, la página no muestra nada roto. No autoplay: el usuario la reproduce con sonido.
- Tras copiar el archivo: `npm run build:vercel`, commit y push (Vercel redespliega solo).

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
