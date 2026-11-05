<!-- docs/voice-box.md: spec (no construida) de la «caja de voz» de paygent: un dispositivo de mostrador
     al que la vendedora le habla («cóbrame 40 pesos de unos tacos», «¿cuánto llevo hoy?», «aconséjame»),
     en varios idiomas. Compara correrlo en la nube, en un equipo local o en el teléfono, con costos con
     fuente y fecha. Lo construido vive en README.md y docs/plan.md; las decisiones, en docs/memoria.md. -->

# Caja de voz: «Pay, cóbrame 40 pesos de unos tacos»

> **Spec, sin construir.** Escrita el 2026-11-05, a siete días del cierre (2026-11-12 12:00 PT). Los
> precios llevan fuente y fecha de lectura (§12). ⏳ marca lo que no está verificado. Aquí no hay
> latencias medidas: las que importan (soltar el botón → QR) se miden al construirlo. Los modelos
> abiertos y las APIs baratas, comparados con Claude, están en [open-models.md](open-models.md), que
> también corrige algunas cifras de aquí.

## 0. Si llegas con prisa

**Qué es.** Una cajita en el mostrador, con micrófono, bocina y un botón. Rosa aprieta el botón y habla:

| Rosa dice | La caja hace |
|---|---|
| «Cóbrame 40 pesos de unos tacos» o solo «cuarenta» | Abre una venta de 40 MXN y muestra el QR (o el sticker queda listo). Cuando PayPal captura, dice «Recibido: 40 pesos» |
| «¿Cuánto llevo hoy?» | «Llevas 1.240 pesos en 23 ventas» |
| «¿Qué es lo que más vendo?» | «Esta semana: tacos de pastor, 96; tamales de rajas, 54» |
| «Aconséjame» | Uno a tres consejos con números de sus propias ventas |
| *«Charge forty pesos for two tacos»* | Lo mismo, y contesta en inglés |

**La recomendación, en tres líneas.**

1. **El dispositivo es un cliente delgado.** Un ESP32-S3 con botón (push-to-talk) manda el audio al
   servidor de paygent. El ESP32 no entiende español: su reconocimiento de comandos solo trae chino e
   inglés (§7), así que el «todo en la cajita» no existe con este chip.
2. **Las reglas van primero y el modelo después.** El cobro, «cuánto llevo» y «lo más vendido» se
   resuelven con reglas y aritmética sobre el libro, sin LLM. Claude solo entra cuando la regla falla
   y para el consejo, que se calcula una vez al día y queda guardado.
3. **La nube optimizada cuesta menos de US$ 1 al mes por puesto (§8).** Un equipo 100 % local
   (Raspberry Pi 5) cuesta unos US$ 200–240 una sola vez, y nunca se paga solo frente a la nube
   optimizada. Lo local compra privacidad y menos dependencia de la red, no ahorro. **PayPal necesita
   internet siempre**: ningún modo cobra sin conexión.

**Para el hackathon:** la caja en un ESP32 que solo escucha (botón + micrófono). Responde el teléfono
que ya hace de bocina (`/soundbox`), y existe una «caja virtual» en `/judge` para quien no tenga el
hardware (§9).

---

## 1. Qué entiende la caja

Las intenciones son pocas y cerradas. Lo que no encaja en ninguna recibe «No te entendí, repítelo», y
nunca se adivina un monto.

| Intención | Ejemplos (es / en) | Qué hace | Quién la resuelve |
|---|---|---|---|
| `charge`: cobro por monto | «cóbrame 40 pesos de unos tacos», «cuarenta», «son 85 con 50» / «charge 40», «forty-five for the tamales» | Venta por monto con **etiqueta** (`tacos`) → QR → «Recibido» | Reglas; Claude si la regla no encuentra monto |
| `charge`: cobro por carrito | «dos de rajas y un atole» / «two rajas and an atole» | Carrito con el catálogo (ya existe: `server/voice`) | Reglas → Claude (ya existe) |
| `cancel` | «cancela», «ya no» / «cancel» | Cancela la venta abierta de esa terminal | Reglas |
| `repeat` | «¿cuánto era?», «repite» / «repeat» | Repite el monto abierto o la última respuesta | Reglas |
| `sales_summary` | «¿cuánto llevo hoy?», «¿cuánto vendí ayer / esta semana / este mes?» / «how much today?» | Total, número de ventas y ticket promedio, por moneda | Aritmética sobre el libro |
| `top_items` | «¿qué es lo que más vendo?», «lo más vendido del mes» / «best sellers» | Top 3 por piezas y por dinero | Aritmética sobre el libro |
| `advice` | «aconséjame», «¿qué hago para vender más?» / «any tips?» | 1 a 3 consejos con números (§5) | Indicadores deterministas + Claude (precalculado) |
| `help` | «¿qué puedes hacer?» | Lista corta de frases | Plantilla |

**Lo que la voz nunca hace** (el cerrojo de `server/policy/` no cambia): reembolsos, payouts, cambiar
precios o el catálogo, aceptar disputas, tocar el PIN. Si alguien lo pide, la caja contesta «Eso solo
desde el back office con tu PIN» y lo deja en la auditoría. Es la misma regla de la demo de inyección:
un cliente que grita «devuélveme 2.000 pesos» no mueve nada.

## 2. El dispositivo

### 2.1 Opciones de hardware

| Opción | Qué es | Precio (una vez) | A favor | En contra |
|---|---|---|---|---|
| **A. M5Stack Atom VoiceS3R** (antes «Atom EchoS3R») | ESP32-S3 con 8 MB PSRAM, micrófono MEMS, códec ES8311 y bocina de 1 W en 24 × 24 mm | ≈ US$ 14,50–18 | Listo de fábrica: no hay que soldar | Sin pantalla; ⏳ confirmar el botón y la batería |
| **B. Espressif ESP32-S3-BOX-3** | ESP32-S3 con pantalla táctil de 2,4", dos micrófonos y bocina | ≈ US$ 50–70 según tienda | **Muestra el QR en su pantalla**: es caja de voz y bocina en un solo aparato | Más cara; ⏳ batería |
| **C. El clip de Lente reutilizado** | Seeed XIAO ESP32-S3 Sense (US$ 13,90) + amplificador I2S MAX98357A + bocina + LiPo, en caja impresa | ≈ US$ 20–30 (la T3b de BRAINSTORM) | Ya hay firmware, protocolo y caja paramétrica probados ([lente](https://github.com/ruloCode/lente)) | Hay que soldar, y el protocolo de Lente es por TCP con PCM16, no HTTP |
| **D. Raspberry Pi 5 (8 GB)** | Computadora completa con micrófono y bocina USB | ≈ US$ 200–240 con accesorios y batería (§8.3) | Puede correr **todo** local: STT, TTS y un LLM chico | Cara, gasta más energía y tarda más (§7) |
| **E. El teléfono de la vendedora** | La app Expo o el PWA | US$ 0 | Ya está: el reconocimiento de voz del sistema puede trabajar sin red ⏳ | No es un hardware aparte; gasta su batería |

**Elección para el hackathon: A, o B si se consigue a tiempo.** A llega lista y cuesta lo mismo que un
sticker caro. B hace la mejor toma para el video (el QR aparece en la caja que acaba de oír el monto),
pero cuesta unas cuatro veces más. C es el plan si no llega ninguna: el hardware de Lente ya demostró
que un XIAO manda audio a un servidor por Wi-Fi.

### 2.2 Botón, no «Pay» como palabra de activación

La idea original era decir «Pay, cóbrame…». Como palabra de activación, «Pay» es mala:

- **Tiene una sola sílaba.** Las palabras cortas disparan falsos positivos; por eso los asistentes
  usan dos o tres sílabas.
- **La dicen los clientes.** «Can I pay with card?» o «¿le pago con…?» se oyen todo el día en un
  puesto con turistas.
- **Un disparo falso es una venta falsa.** Cada terminal tiene **una sola venta abierta**, y una nueva
  expira la anterior (`server/sales.ts`). Cualquiera que diga «Pay, cóbrame un peso» le reemplaza el
  cobro a Rosa mientras su cliente está pagando.
- **Español no es de primera clase en el ESP32.** El entrenamiento de palabras propias de Espressif
  (ESP-SR) solo tenía chino, inglés, japonés y francés al 23-abr-2026; el español está «planeado».
  microWakeWord (ESPHome) puede entrenarse en español, pero con datos propios y sin una receta probada
  (§12).

**Decisión: push-to-talk.** Rosa aprieta el botón, habla y lo suelta. Que el botón esté en el lado de
la vendedora equivale a «solo Rosa da órdenes», sin reconocer su voz. La palabra de activación
(«Oye caja», tres sílabas) queda para una v2. Aun con ella, cobrar exigiría el botón o una
confirmación.

### 2.3 Lo que la caja muestra y dice

| Estado | LED / pantalla | Sonido |
|---|---|---|
| Escuchando (botón apretado) | Azul | Clic corto |
| Pensando | Azul parpadeante | — |
| Venta abierta | Ámbar (B: QR + monto) | «Cobrando 40 pesos, tacos» |
| Pagado (captura de PayPal) | Verde | «Recibido: 40 pesos» (+ campanita) |
| No entendió / error | Rojo | «No te entendí, repítelo» |
| Sin conexión | Rojo fijo | «Sin internet: no puedo cobrar con PayPal» |

Igual que la bocina de hoy, solo una captura del servidor hace sonar «Recibido». Una captura de
pantalla falsa sigue en silencio.

## 3. Cómo viaja una frase

```text
[botón] ─► ESP32 graba (16 kHz mono) ─► POST /api/terminals/:id/voice  (Authorization: Bearer pgd_…)
                                              │
                                   STT (§7) ──► texto + idioma
                                              │
                  router de intenciones: reglas ──(si no alcanza)──► Claude (herramienta forzada, validado)
                                              │
        ┌──────────────┬──────────────────────┼─────────────────────────┬───────────────┐
     charge          cancel             sales_summary / top_items       advice          otra cosa
  createSale()     cancelSale()          aritmética sobre el libro    consejo guardado   «no te entendí»
        │                                      │                         del día
        └──────────────────────► respuesta { intent, lang, text, sale? }
                                              │
                    SSE `voice.reply` a la terminal ─► /soundbox (el teléfono) la dice en voz alta
                    y/o audio en la respuesta HTTP ─► la bocina de la caja (P1)
```

Piezas nuevas en el servidor (todo dentro de las reglas de `docs/plan.md`):

| Pieza | Qué hace | Nota |
|---|---|---|
| `POST /api/terminals/:id/voice` | Recibe `audio/wav` (o `text` para la caja virtual) y devuelve `{ intent, lang, text, sale? }` | Reusa `createTranscriber` y el límite de 2 MB de `server/voice/transcribe.ts` |
| Token de dispositivo `pgd_…` | La caja se autentica por terminal; se guarda solo su SHA-256, igual que los tokens MCP | Hoy `POST /api/terminals/:id/sales` es abierto (modo jurado); la caja no debería serlo |
| `server/voice/intent.ts` | Router puro: frase → intención + parámetros, en es/en, con tests | Extiende `rules.ts` (números en palabra, «con 50», «y medio») |
| Etiqueta en ventas por monto | `{ amount, label }` en `CreateSaleInput`; si la etiqueta coincide con un alias del catálogo, guarda también su `sku` | **Hoy una venta por monto se guarda como `sku: "monto"` / «Sale»**, así que «lo más vendido» no tiene con qué contarse |
| `server/insights.ts` | Indicadores del periodo: por producto, por hora, por día de la semana, tendencia y reembolsos | Puro y determinista; alimenta `top_items` y `advice` |
| Evento SSE `voice.reply` | La bocina ya conectada a la terminal dice la respuesta | Reusa `speechSynthesis`, sin costo y con voces por idioma |

## 4. Entender «cóbrame 40 pesos de unos tacos»

1. **El monto.** Cifras («40», «85.50») y palabras en es/en («cuarenta y cinco», «ochenta con
   cincuenta», «forty-five»). La moneda es **siempre la del puesto**: si Rosa (MXN) dice «diez
   dólares», la caja contesta «Este puesto cobra en pesos» y no cobra. Las monedas nunca se mezclan ni
   se convierten, como en el resto de paygent.
2. **La etiqueta.** Lo que viene después de «de», «por» o «for» («unos tacos» → `tacos`). Se normaliza
   contra los alias del catálogo. Si coincide y el monto es múltiplo del precio, se puede proponer el
   carrito (40 ÷ 20 = «2 tacos»); si no, queda como venta por monto con etiqueta.
3. **La red de seguridad.** Un monto mayor que 10 veces el ticket promedio del puesto (o que un tope
   que ella fije) pide confirmación: «¿Cuatrocientos pesos? Aprieta otra vez para confirmar». Es el
   error típico de STT (*cuarenta* / *cuatrocientos*). El cliente igual ve el total antes de pagar, en
   `/pay/:saleId`.
4. **El texto es dato, nunca instrucciones.** Es la regla que ya sigue `server/voice/llm.ts`: el modelo
   solo puede elegir SKUs del catálogo y devolver un monto que se valida con zod.

**Sobre el modelo.** La ruta de voz usa hoy `claude-haiku-4-5-20251001`. Claude Haiku 5.5 cuesta una
décima parte (US$ 0,10 / 0,50 por millón de tokens de entrada / salida, frente a US$ 1 / 5). Migrar
tiene cambios que rompen: el pensamiento viene encendido por defecto y conviene apagarlo en esta ruta,
los parámetros de muestreo distintos del valor por defecto dan 400 y el prefill también da 400. Hay
que revisar la guía de migración antes de cambiar el ID ⏳.

## 5. Ventas, lo más vendido y consejos

**`sales_summary` y `top_items` no usan LLM.** Salen del mismo libro que ya alimenta el back office
(`server/backoffice/tools.ts`): ventas `paid`, con los reembolsos restados, por moneda y con el día
local del puesto (`timeZone`). Los cobros de rieles confirmados por la vendedora (Pix, SPEI, Bre-B)
se dicen aparte, como «además, 300 por confirmar», igual que en el pasaporte. La frase sale de una
plantilla por idioma, así que es instantánea y no cuesta nada.

**`advice` tiene dos capas:**

1. **Indicadores deterministas** (`server/insights.ts`), por ejemplo:
   - la mejor hora y la hora muerta;
   - el producto que crece y el que cae frente a la semana anterior;
   - el día flojo de la semana;
   - el ticket promedio contra el de hace un mes;
   - cuántas ventas fueron por monto sin etiqueta.

   Esto ya sirve sin modelo, con plantillas como «Los martes vendes 40 % menos que el resto».
2. **Claude redacta** (Sonnet 5.5, o Haiku 5.5 para abaratar). Recibe **solo agregados**: ningún dato
   de compradores, emails ni IDs de PayPal. Las reglas de su prompt:
   - máximo tres consejos, cada uno con su número;
   - sin crédito, préstamos ni inversiones;
   - con menos de 7 días de datos, dice «aún tengo pocos datos».

   Se genera **una vez al día** (de noche o con la primera petición) y se guarda. «Aconséjame» contesta
   al instante y el costo es por día, no por pregunta.

**Modo discreto (por defecto).** Decir en voz alta «llevas 3.450 pesos» en un puesto de la calle avisa
a quien esté cerca de cuánto dinero hay en la caja. Por eso, por defecto, la caja dice «Te lo mandé al
teléfono» y el monto aparece en la app. Rosa puede activar «decir montos en voz alta».

## 6. Varios idiomas

| Tema | Decisión |
|---|---|
| Idiomas del día uno | `es-MX` y `en-US`, igual que el resto de la app |
| Siguientes | `pt-BR` y `fr`: el STT (§7) los cubre y solo faltan las plantillas de respuesta y las palabras de números |
| Lenguas originarias (zapoteco, mixteco…) | **No se prometen**: ningún STT de §7 las lista ⏳. Es honesto decirlo en el video si Rosa es de Oaxaca |
| Detectar el idioma | Por frase. El STT lo detecta cuando lo ofrece (`whisper-1` con `verbose_json`, `detect_language` en Deepgram) ⏳; si no, se usa el idioma del puesto. La caja **contesta en el idioma en que le hablaron** |
| Mezcla («cóbrame forty») | Es lo más débil del STT: Whisper turbo quedó último en un benchmark de mezcla es/en (jun-2026) ⏳. Nova-3 Multilingual de Deepgram y Muse Voice Transcribe de Meta la anuncian ⏳ ([open-models.md](open-models.md)). Las reglas aceptan números de los dos idiomas en la misma frase |
| Formato | Montos con el locale del idioma de la respuesta («1.240 pesos» en es-MX, «1,240 pesos» en en-US) y siempre la moneda del puesto |
| Voz | Teléfono: `speechSynthesis`, con la voz del sistema para ese idioma. Caja con bocina: TTS del servidor (§8) o Piper, que tiene voces `es_MX` y `en_US` (el motor ahora es `piper1-gpl`, GPL-3.0; la licencia de cada voz está por leer) |

## 7. ¿Todo local? Qué se puede y qué no

**Lo que nunca es local: el cobro.** Crear la orden, aprobarla en el teléfono del cliente y capturarla
pasa en los servidores de PayPal. Sin internet, la caja solo puede **anotar efectivo dictado** («vendí
50 en efectivo»), que entra al cuadre de caja como autodeclarado al volver la señal. Esto pide una
cola local de pendientes en la app; no existe hoy.

Dónde puede correr cada pieza:

| Pieza | ESP32-S3 (la caja) | Teléfono | Raspberry Pi 5 | Nube |
|---|---|---|---|---|
| Botón / palabra de activación | ✅ (botón; palabra solo con datos propios en español) | ✅ | ✅ | — |
| Voz → texto (STT) | ❌ MultiNet solo trae comandos en chino o inglés | ✅ reconocimiento del sistema, sin red si el idioma está descargado ⏳ | ✅ Moonshine Spanish Small (MIT); whisper.cpp `base` casi en tiempo real, `small` más lento; o Vosk con gramática ⏳ | ✅ `gpt-4o-mini-transcribe`, `whisper-1`, Deepgram |
| Intención y monto | ❌ | ✅ reglas en TS (las mismas de `shared/`) | ✅ | ✅ |
| Ventas y lo más vendido | ❌ | ✅ con el libro en caché | ✅ con su propia copia | ✅ (hoy) |
| Consejo (LLM) | ❌ | ⏳ modelos en el dispositivo, según el teléfono | ⚠️ Lee el prompt a ≈ 26–40 tokens/s y genera a 3–8: un consejo tarda 1,5–5 min. Sirve precalculado de noche; los cobros, solo por reglas | ✅ Claude |
| Texto → voz (TTS) | ⚠️ solo reproduce audio ya hecho (esp-tts no trae español ⏳) | ✅ `speechSynthesis` | ✅ Piper | ✅ Google, OpenAI |
| Cobrar con PayPal | ❌ red | ❌ red | ❌ red | ✅ (siempre) |

**Conclusión.** «El mismo hardware hace todo» solo es cierto con algo del tamaño de una Raspberry Pi 5
(u otra placa con más GPU, como una Jetson Orin Nano, que aquí sobra). Un ESP32 hace bien su papel:
escuchar, mostrar, sonar y gastar poca batería. El cerebro local más barato ya existe: **el teléfono
de Rosa**.

## 8. Cuánto cuesta cada camino

### 8.1 Supuestos: un puesto, un mes

| Supuesto | Valor |
|---|---|
| Días de venta | 26 |
| Cobros por voz | 80 al día → 2.080 al mes |
| Preguntas («cuánto llevo», «lo más vendido») | 6 al día → 156 al mes |
| Consejos | 1 al día → 26 al mes |
| Duración de cada frase | 4 s → 2.262 frases × 4 s ≈ **151 min de audio al mes** |
| Texto hablado de vuelta | ≈ 55 caracteres por cobro, 160 por pregunta y 600 por consejo → **≈ 155.000 caracteres al mes** (≈ 185 min de audio) |
| Frases que Claude interpreta | 25 % de los cobros caen de las reglas al modelo ⏳ medirlo con el eval de 10 ventas de S2 |
| Tokens por interpretación | ≈ 1.200 de entrada (catálogo + herramienta) y 80 de salida |
| Tokens por consejo | ≈ 4.000 de entrada (agregados) y 1.000 de salida (con margen para el pensamiento) |

Sin capas gratuitas: son por cuenta, no por puesto, y con muchos puestos se acaban. Para un piloto de
diez puestos, la capa gratuita de TTS de Google cubriría todo.

### 8.2 La nube, pieza por pieza (US$ por puesto al mes)

| Pieza | Opción | Precio de lista (leído 2026-11-05) | Costo al mes |
|---|---|---|---|
| STT | `gpt-4o-mini-transcribe` | ≈ US$ 0,003 / min | **0,45** |
| STT | `whisper-1` (el que usa `STT_MODEL` por defecto hoy) | US$ 0,006 / min ⏳ | 0,91 |
| STT | Deepgram Nova-3 Multilingual, en streaming | US$ 0,0092 / min (promoción ≈ 0,0058) | 1,39 |
| Intención | Claude Haiku 4.5 (hoy), en **todas** las frases | US$ 1 / 5 por millón de tokens | 3,62 |
| Intención | Claude Haiku 5.5, solo en el 25 % que fallan las reglas | US$ 0,10 / 0,50 por millón de tokens | **0,09** |
| Consejo | Claude Sonnet 5.5, una vez al día | US$ 2 / 10 por millón de tokens | 0,47 |
| Consejo | Claude Haiku 5.5, una vez al día | US$ 0,10 / 0,50 por millón de tokens | 0,02 |
| TTS | En el teléfono (`speechSynthesis`) o Piper en el servidor | — | **0** |
| TTS | Google Standard / WaveNet | US$ 4 / millón de caracteres (4 M gratis al mes por cuenta) | 0,62 |
| TTS | Google Neural2 | US$ 16 / millón de caracteres | 2,48 |
| TTS | Google Chirp 3 HD | US$ 30 / millón de caracteres | 4,65 |
| TTS | OpenAI `gpt-4o-mini-tts` | ≈ US$ 0,015 / min de audio | 2,78 |
| Servidor | Render Starter (US$ 7) + Postgres básico, ≈ US$ 13 al mes **por todos los puestos** | — | 1,30 con 10 puestos; 0,13 con 100 |

**El STT de esta tabla tiene fecha de apagado.** OpenAI marcó `gpt-4o-mini-transcribe` y `whisper-1`
como obsoletos y los apaga el 2027-02-26 ⏳. Su reemplazo, `gpt-transcribe`, cuesta ≈ US$ 0,0045/min
(0,68 al mes) ⏳; Groq, Fireworks y Muse Voice Transcribe cuestan 0,14–0,45 ([open-models.md](open-models.md)).

**El TTS se puede cachear.** «Recibido: 40 pesos» se repite todo el día. Guardar el audio por
(texto, voz) o armarlo con clips de números lleva el TTS de nube casi a cero después de la primera
semana ⏳.

**Datos móviles de la caja.** El audio PCM de 16 kHz pesa ≈ 32 KB/s: 151 min son **≈ 290 MB al
mes**, mucho para un plan de prepago en el hotspot del teléfono. Con ADPCM (4:1) bajan a ≈ 72 MB, y
con Opus a 16 kbps, a ≈ 18 MB. Lente nunca implementó Opus ⏳. El primer firmware manda ADPCM o
PCM, y comprimir queda como P1.

### 8.3 Hardware, una sola vez (US$)

| Equipo | Partes | Total |
|---|---|---|
| A. Atom VoiceS3R | Módulo + cable USB-C | ≈ 15–20 |
| B. ESP32-S3-BOX-3 | Kit | ≈ 50–70 |
| C. Clip de Lente adaptado | XIAO ESP32-S3 Sense 13,90 + MAX98357A + bocina + LiPo + cargador + impresión | ≈ 20–30 |
| D. Raspberry Pi 5 local | Pi 5 de 8 GB ≈ 130 (tras las subidas de 2026 ⏳) + fuente, disipador, caja y microSD ≈ 35–45 ⏳ + altavoz con micrófono USB ≈ 25–40 ⏳ + powerbank USB-PD de 20.000 mAh ≈ 30 ⏳ | ≈ 220–245 |
| D′. Jetson Orin Nano Super | Kit de US$ 249 en su lanzamiento (un boletín de ago-2026 dice US$ 399 ⏳) + accesorios | ≈ 300–450 |
| E. Teléfono | Ya lo tiene | 0 |

Energía: un ESP32 dura un día con una batería chica. Una Pi 5 con micrófono, bocina y un LLM ocasional
gasta unos pocos watts ⏳. Un powerbank de 20.000 mAh (≈ 74 Wh) debería durar una jornada; hay que
medirlo. En un puesto sin enchufe, esa es la diferencia que más importa.

### 8.4 Los cinco caminos, completos

| Camino | Qué corre dónde | Hardware (una vez) | Variable al mes por puesto | Pros | Contras |
|---|---|---|---|---|---|
| 1. **Nube como está hoy** | Caja → `whisper-1` → Haiku 4.5 en cada frase → Sonnet 5.5 → TTS Neural2 | 15–70 | ≈ **7,50** | No hay código nuevo de IA | Paga modelo en cosas que una regla resuelve |
| 2. **Nube optimizada** | Caja → `gpt-4o-mini-transcribe` → reglas + Haiku 5.5 si fallan → consejo diario con Sonnet 5.5 → TTS Google Standard | 15–70 | ≈ **1,60** (menos con el caché de TTS) | Calidad de nube, 4–5 veces más barato | Depende de la red para todo |
| 3. **Híbrido (recomendado)** | Caja → STT en la nube; reglas en el servidor; consejo diario con Claude; **la voz la pone el teléfono** o Piper | 15–70 | ≈ **0,37–0,79** con Haiku 5.5 en el consejo (0,81–1,24 con Sonnet 5.5) | Lo más barato con buena calidad; voces gratis por idioma | El teléfono tiene que estar cerca y encendido (ya lo está: es la bocina) |
| 4. **Todo local en una Pi 5** | Moonshine o Vosk + solo reglas en el cobro + Gemma 4 E2B o Qwen3.5-2B de noche + Piper, en el puesto | ≈ 220–245 | ≈ 0 (solo PayPal usa la red) | La voz nunca sale del puesto; funciona con señal mala | Cara, más lenta ⏳, consejos más pobres y una batería grande que cargar |
| 5. **Teléfono como cerebro** | Reconocimiento del sistema + reglas + TTS del sistema; consejo en la nube | 0 | ≈ 0–0,50 | Gratis, ya instalado | No es «un hardware»; manos ocupadas con el teléfono |

**Cómo leerlo:**

- **La IA cuesta menos de 0,05 centavos de dólar por venta en el camino 3** (≈ US$ 0,80 / 2.080
  cobros). La comisión de PayPal de cada cobro pesa mucho más.
- **La Pi 5 nunca se paga sola frente al camino 3.** A US$ 0,80 al mes, US$ 230 tardan más de 20 años.
  Frente al camino 1 (US$ 7,50 al mes) tardan unos 30 meses. Lo que ahorra plata es **optimizar la
  nube**: cambiar de modelos, poner reglas primero y hablar desde el teléfono. El equipo local se
  justifica por privacidad, por una latencia sin viaje a la red o por un piloto sin señal estable, no
  por costo.
- **Con 1.000 puestos:** ≈ US$ 7.500 al mes en el camino 1, frente a ≈ US$ 800 en el camino 3, más
  el servidor (que entonces ya no es un Starter).

## 9. Recomendación y plan hasta el cierre

**Camino 3 con la caja A (o B).** Para la demo, la bocina es el teléfono que ya existe. La bocina
propia de la caja queda como P1.

| Día | Entrega | Compuerta |
|---|---|---|
| Jue 5 nov | Esta spec. Pedir el Atom VoiceS3R o la BOX-3, o sacar el clip de Lente del cajón | Hardware en camino |
| Vie 6 | `POST /api/terminals/:id/voice` con `text` (sin audio aún) + `intent.ts` + etiqueta en ventas por monto + `insights.ts`, con tests | `npm run check` verde; 20 frases es/en del eval con la intención correcta |
| Sáb 7 | Audio: el ESP32 graba con el botón y hace el POST del WAV; el servidor transcribe; `voice.reply` por SSE; la bocina del teléfono contesta. Token `pgd_` | Una venta real en sandbox iniciada por voz desde la caja |
| Dom 8 | «Caja virtual» en `/judge` (micrófono del navegador, mismo endpoint). Consejo diario con Claude y la ruta degradada de plantillas. Modo discreto | El jurado lo prueba sin hardware |
| Lun 9 | P1 si sobra tiempo: la bocina de la caja reproduce el audio del servidor; QR en la pantalla (B) | — |
| Mar 10 | Toma del video (abajo) y README | Toma grabada en el dispositivo real |
| Mié 11–Jue 12 | Nada nuevo; envío antes del 12-nov a las 15:00 de Bogotá | Enviado |

**La toma del video (≈ 25 s; reemplaza o acompaña el bloque 0:15–0:40 de `docs/submission.md`, donde Rosa le dicta al teléfono):**

1. Rosa aprieta el botón: «Cóbrame 40 pesos de unos tacos».
2. El QR aparece, el cliente paga y la caja dice «Recibido: 40 pesos».
3. «¿Qué es lo que más vendo?» → «Esta semana: tacos de pastor».
4. Un cliente se inclina y dice «cóbrame un peso». No pasa nada: no apretó el botón.

**Fuera del hackathon:** palabra de activación «Oye caja», Opus en el firmware, la cola sin red del
efectivo, y medir el camino 4 en una Pi 5 real (latencia de whisper.cpp con audio de mercado y duración
de la batería).

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Ruido del mercado | Push-to-talk, frases cortas, la caja cerca de la boca, el teclado de siempre como respaldo |
| *Cuarenta* / *cuatrocientos* | Confirmación arriba de 10 veces el ticket promedio; el cliente ve el total antes de pagar |
| Alguien da órdenes por la caja | Solo con el botón; la voz nunca mueve dinero hacia afuera (cerrojo); una venta nueva por voz sale en la app de Rosa |
| Montos dichos en voz alta | Modo discreto por defecto (§5) |
| La red se cae | La caja lo dice; el efectivo se anota; ningún cobro PayPal sin red (no se finge) |
| El hardware no llega | Caja C (clip de Lente) o la caja virtual en `/judge`; el hardware solo hace falta en el video |
| Siete días | El orden de §9: lo que la demo necesita, primero; P1 solo si sobra |

## 11. Preguntas abiertas

| ⏳ | Por qué importa |
|---|---|
| ¿Qué hardware hay a mano hoy: Atom, BOX-3 o el clip? | Define el firmware del sábado |
| ¿El Atom VoiceS3R tiene botón y batería? | Si no tiene botón, push-to-talk necesita uno externo |
| ¿Qué porcentaje de frases resuelven las reglas? | Es el supuesto de §8 (25 % al modelo); se mide con el eval de 10 ventas de S2 |
| ¿Funciona el reconocimiento sin red de `expo-speech-recognition` en el Android de la demo? | Define si el camino 5 sirve como respaldo sin red |
| Licencia de cada voz `es_MX` de Piper | El motor ya es GPL-3.0 (`piper1-gpl`, correrlo como proceso aparte); cada voz trae su licencia en su MODEL_CARD y algunas no permiten uso comercial |
| ¿La demo tiene una persona en EE. UU. (USD, inglés)? | Define el idioma de la segunda toma |

## 12. Fuentes (leídas 2026-11-05)

Modelos y servicios en la nube:

- Claude, precios por millón de tokens: [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) (tabla en caché del SDK, 2026-10-06)
- OpenAI `gpt-4o-mini-transcribe`, ≈ US$ 0,003/min: [Neowin, lanzamiento](https://www.neowin.net/news/openai-announces-next-generation-audio-models-to-power-voice-agents/) · [costgoat](https://costgoat.com/pricing/openai-transcription)
- OpenAI `gpt-4o-mini-tts`, US$ 0,60 / 12 por millón de tokens (≈ 1,5 ¢/min): [página del modelo](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- Deepgram Nova-3: [deepgram.com/pricing](https://www.deepgram.com/pricing) · [resumen 2026](https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/)
- Google Cloud Text-to-Speech: [precios](https://cloud.google.com/text-to-speech/pricing)
- Render: [precios](https://render.com/pricing) · [costo típico Starter + Postgres, jul-2026](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses)

Hardware:

- M5Stack Atom VoiceS3R (antes EchoS3R): [Switch Science](https://www.switch-science.com/products/10808) · [The Pi Hut](https://thepihut.com/products/atom-echos3r-smart-speaker-dev-kit)
- ESP32-S3-BOX-3: [Octopart](https://octopart.com/part/espressif-systems/ESP32-S3-BOX-3) · [Bits and Parts](https://www.bitsandparts.nl/en/esp32-s3-espressif-esp32-s3-box-3-p1925984) · [Hackster, lanzamiento](https://hackster.io/news/espressif-s-new-esp32-s3-box-3-demonstrates-next-generation-iot-with-chatgpt-example-31083b826fac)
- Seeed XIAO ESP32-S3 Sense a US$ 13,90, piezas y cableado: [lente/README](https://github.com/ruloCode/lente) · [lente/hardware](https://github.com/ruloCode/lente/blob/main/hardware/README.md) · [protocolo clip ↔ hub](https://github.com/ruloCode/lente/blob/main/docs/PROTOCOL.md)
- Raspberry Pi 5, subidas de precio de 2026: [Tom's Hardware](https://www.tomshardware.com/raspberry-pi/component-shortages-drive-raspberry-pi-prices-up-by-up-to-23-percent-escalating-lpddr4-lpddr5-costs-trigger-the-third-price-hike-of-the-year) · [Tom's Hardware, feb-2026](https://www.tomshardware.com/raspberry-pi/raspberry-pi-5-price-increases-drastically-as-ai-shortage-bites-16gb-version-now-usd205-second-price-increase-in-three-months-over-70-percent-more-expensive-than-original-msrp)
- Jetson Orin Nano Super: [DFRobot](https://www.dfrobot.com/product-2900.html) · [JetsonHacks, ago-2026](https://jetsonhacks.com/2026/08/26/jetsonhacks-august-2026-newsletter/amp/)

Voz en el dispositivo y local:

- ESP-SR (WakeNet / MultiNet, idiomas): [github.com/espressif/esp-sr](https://github.com/espressif/esp-sr) · [README 2.5.0](https://components.espressif.com/components/espressif/esp-sr/versions/2.5.0/readme)
- microWakeWord en ESPHome: [documentación](https://esphome.io/components/micro_wake_word/) · [hilo sobre entrenarlo en español](https://community.home-assistant.io/t/discussion-esp32-s3-wake-word-strategy-hybrid-dataset-real-voice-applio-rvc-classic-tts-for-spanish/976868)
- whisper.cpp en la Pi 5: [comparativa 2026](https://www.promptquorum.com/es/power-local-llm/local-whisper-stt-comparison-2026) · [discusión #166](https://github.com/ggml-org/whisper.cpp/discussions/166)
- LLM en la Pi 5 (clase 4B: 3–5 tok/s; Gemma 3 1B ≈ 8–12; Qwen3 1.7B ≈ 8): [potato-os, Gemma 4](https://github.com/potato-os/core/blob/main/docs/benchmarks/gemma4-pi-benchmark-2026-04-04.md) · [Jeff Geerling](https://github.com/geerlingguy/ai-benchmarks) · [Stratosphere](https://stratospherelinuxips.readthedocs.io/en/develop/immune/research_rpi_llm_performance.html) · [Gemma 3 en la Pi 5](https://www.kunalganglani.com/blog/gemma-3-raspberry-pi-5-benchmark.md)
- Vosk: [github.com/alphacep/vosk-api](https://github.com/alphacep/vosk-api)
- Piper (voces `es_MX`): [voces en Hugging Face](https://huggingface.co/rhasspy/piper-voices)
