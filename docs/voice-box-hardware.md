<!-- docs/voice-box-hardware.md: bitácora del hardware de la caja de voz — qué se compró en Bogotá el
     2026-11-09, por qué, cómo se conecta y qué falta decidir (el firmware). Complementa la spec
     docs/voice-box.md (qué hace la caja) y docs/open-models.md (qué modelos la mueven).
     Precios en COP leídos de las fichas de MercadoLibre ese día; ⏳ = no verificado. -->

# Caja de voz: hardware comprado y plan de armado

> Sesión del 2026-11-09 (Bogotá). La compra llega el martes 2026-11-10. La entrega del hackathon
> cierra el jueves 2026-11-12 a las 15:00 de Bogotá. **El firmware todavía no está decidido** (§6).

## 1. Qué cambió frente a la spec

La spec (`docs/voice-box.md`, §2.1) proponía una M5Stack Atom VoiceS3R o una ESP32-S3-BOX-3. **Ninguna
se consigue en tiendas colombianas**: solo por importadores (Desertcart, Ubuy), que no llegan antes
del cierre. Se armó la caja con piezas sueltas (la opción C de la spec, sin reusar el clip de Lente),
más una pantalla táctil para la cara y el monto.

Otras decisiones del día:

- **Botón para hablar, no palabra de activación.** Se mantiene lo de la spec (§2.2).
- **El QR va impreso, no en pantalla.** El QR de paygent es fijo por terminal (`/t/:terminal`), así
  que la pantalla muestra la cara, el monto y «PAGADO», no el QR. Junto al QR va un sticker NFC
  NTAG213 con la misma URL. El teléfono del cliente lo lee, y la caja no necesita módulo NFC.
- **Una cara en la pantalla**, inspirada en el robot «Jolly» que se vio en LinkedIn. Su pantalla es
  táctil y no se pudo identificar el modelo exacto. Cada estado de la caja tiene su cara (§5).
- **Didácticas Electrónicas no sirvió**: tenía agotados el INMP441 y el MAX98357A, y tarda de 2 a 4
  días hábiles en llegar a Bogotá. Todo se compró en MercadoLibre con entrega para el día siguiente.

## 2. Lo que se compró

### 2.1 MercadoLibre (pedido del 2026-11-09, «llega mañana» en los 5 envíos)

| Envío | Vendedor | Pieza | Cant. | COP |
|---|---|---|---|---|
| 1 (Full) | — | ESP32-S3 DevKitC **N16R8** (16 MB de flash, 8 MB de PSRAM, dos USB-C) | 2 | 80.000 |
| 1 (Full) | — | Cables dupont macho-hembra de 20 cm × 40 | 1 | 11.000 |
| 1 (Full) | — | Stickers NFC NTAG213 × 20 | 1 | 26.990 |
| 2 | Yorobotics | Micrófono INMP441 (I2S) | 1 | 48.195 |
| 3 | Mactrónica | Pantalla TFT táctil de 2,8", 240×320 (ver §2.3) | 1 | 67.000 |
| 4 | Electronilab | Amplificador MAX98357A (I2S, 3 W) | 1 | 29.990 + 9.700 de envío |
| 5 | Electrosena | Pulsadores de 12×12 con capuchón de colores × 3 | 1 | 12.000 |
| 5 | Electrosena | Caja plástica de 25 × 12 × 9 cm (con orejas y muesca para el cable) | 1 | 19.000 |
| 5 | Electrosena | Kit: protoboard de 830 puntos, jumpers macho-macho, LEDs, resistencias | 1 | 28.800 |
| | | **Total pagado** | | **332.675** |

Solo hay 1 micrófono y 1 amplificador: alcanzan para la demo, sin repuesto. La segunda ESP32-S3 es
el repuesto de la placa.

### 2.2 Comprado en un local de Bogotá

- Cautín y estaño. La crema para soldar no se consiguió; no hace falta si el estaño trae flux o
  núcleo de resina.
- Parlante de **4 Ω y 5 W**, con cables y conector. El MAX98357A le entrega como mucho unos 3 W a
  5 V, así que trabaja holgado. El mismo local tiene otro de repuesto.
- Cables dupont macho-macho (en la calle no había macho-hembra; esos vienen en el pedido Full).

### 2.3 La pantalla: dos dudas para resolver al recibirla

El anuncio de Mactrónica se contradice: el título dice **ILI9341** y la descripción dice
**ST7789**, y la descripción parece copiada de otra pantalla (la de Adafruit). Las dos dudas:

1. **El controlador: ILI9341 o ST7789.** Los dos funcionan por SPI con la ESP32-S3; cambia una línea
   de configuración del driver.
2. **El táctil.** La descripción habla de «2 pines digitales y 2 analógicos», que sería un táctil
   resistivo de 4 hilos sin chip. Las pantallas rojas como la de la foto suelen traer un chip
   XPT2046 por SPI (pines T_CLK, T_CS, T_DIN, T_DO, T_IRQ). Los dos sirven, pero cambian los pines.

Se resuelve con una foto de la parte de atrás de la pantalla al recibirla.

### 2.4 Lo que se descartó y por qué

| Pieza | Por qué no |
|---|---|
| M5Stack Atom VoiceS3R, ESP32-S3-BOX-3, M5Stack CoreS3 | No hay existencias en Colombia; solo importadas |
| Waveshare WS-28141 (ESP32-S3 con pantalla de 4,3" y carcasa) | Variante industrial (RS485, CAN), sin audio y casi sin pines libres |
| Waveshare WS-17344 (IPS de 2") | No es táctil |
| «Pantalla Touch TFT Arduino Uno R3» | Por el nombre, es un *shield* de bus paralelo (≈ 13 pines) |
| ESP32-S3 con conector de cámara (CAM) | Otro orden de pines y la cámara no se usa |
| ESP32-S3 Zero | Muy pocos pines, y solo 4 MB de flash y 2 MB de PSRAM |
| Parlantes de 8 Ω y 0,5 W | El MAX98357A a 5 V puede pasarles de lo que aguantan |
| Pulsador redondo de 2 pines | Parece de linterna, de enclavamiento; para hablar hace falta uno momentáneo |
| Llavero NFC de WhatsApp | Puede venir bloqueado; los stickers en blanco son más baratos y se reescriben |
| Kit de 135 piezas (60.000) | Lo que sirve para la caja ya viene en el kit de 28.800 |
| Cautín de 60 W regulable | Se compró en el local, con estaño |

## 3. Cómo se conecta

El primer paso es el diagrama «Conexión Voz a Texto» (ESP32-S3 DevKitC N16R8 + INMP441 + pulsador +
LED). Lo demás se suma después sin mover lo que ya está.

| Pieza | Señal | GPIO | Nota |
|---|---|---|---|
| INMP441 | SD / SCK / WS | 4 / 5 / 6 | L/R a GND (canal izquierdo), VDD a 3V3. Va en I2S0 (recepción) |
| Pulsador | — | 7 | A GND, con `INPUT_PULLUP`. Patas en diagonal |
| LED | — | 8 | Con resistencia de 330 Ω a GND |
| MAX98357A | BCLK / LRC / DIN | 15 / 16 / 17 | Va en I2S1 (transmisión). VIN a 5Vin (más volumen) o 3V3. SD y GAIN sin conectar |
| Pantalla SPI | SCK / MOSI / CS / DC / RST / luz | 12 / 11 / 10 / 9 / 13 / 18 | La luz de fondo por PWM |
| Táctil XPT2046 (si lo trae) | MISO / T_CS / T_IRQ | 13 / 41 / 42 | Comparte SCK y MOSI. Si MISO usa el 13, el reset de la pantalla pasa al 21 |
| Táctil de 4 hilos (si es así) | X / Y analógicos | 1 / 2 | Pines de ADC1 |

**Pines que no se usan:** 0, 3, 45 y 46 deciden cómo arranca la placa. 19 y 20 son el USB. En la
N16R8, 35 a 37 son de la PSRAM. 43 y 44 son el puerto serie. El LED RGB de la placa va en el 48 o
el 38, según la versión.

**Detalles de armado:**

- En varias de estas placas, el pin **5Vin** solo da 5 V si se une el puente de soldadura **IN-OUT**.
  Medir con multímetro antes de alimentar el amplificador desde ahí.
- La DevKitC es ancha: en una protoboard de 830 deja una sola fila libre de un lado. Hay que
  montarla entre dos protoboards o conectarla con los cables macho-hembra.
- Los pines del INMP441 y del MAX98357A vienen sin soldar. Sin soldarlos, el contacto falla y el
  micrófono mete ruido.
- El parlante va a la bornera del MAX98357A; para voz, la polaridad no importa.

**La caja (25 × 12 × 9 cm):**

- ventana para la pantalla en la tapa;
- agujero de 3–5 mm para el micrófono, con el INMP441 pegado por dentro (su orificio de sonido mira
  hacia la pared de la caja);
- rejilla de agujeros de 3 mm para el parlante;
- agujero para el pulsador, pegado por dentro con silicona caliente;
- el cable USB sale por la muesca.

El sticker NFC se pega por dentro de la tapa, lejos del imán del parlante, junto al QR impreso y un
texto «Toca o escanea para pagar». Si se forra la caja, el agujero del micrófono queda descubierto.

## 4. Plan hasta el cierre

| Día | Qué |
|---|---|
| Mar 10 | Recibir el pedido; foto de la parte de atrás de la pantalla. Soldar los pines del micrófono y del amplificador. Armar el diagrama base. **Decidir el firmware (§6)** y lograr la primera grabación con el botón |
| Mié 11 | Audio de vuelta por el parlante; la cara en la pantalla; probar contra paygent en sandbox |
| Jue 12 | En la mañana, grabar la toma del video en el aparato real. Enviar antes de las 15:00 |

Si algo falla, el respaldo de la demo es el mismo de la spec: la bocina y la cara en el teléfono
(`/soundbox`), y la caja virtual en `/judge`.

## 5. Las caras de la caja

Cara kawaii dibujada con figuras simples: ojos redondos con brillo, cachetes rosados y una boca en
arco. Cada estado reemplaza al LED de la spec (§2.3):

| Estado | Cara | Texto |
|---|---|---|
| En reposo | Ojos cerrados y sonrisa, con parpadeo lento | — |
| Escuchando (botón apretado) | Ojos bien abiertos | «Te escucho…» |
| Pensando | Ojos mirando hacia arriba | Puntos animados |
| Venta abierta | Ojos atentos | «40 pesos · tacos» |
| Pagado | Ojos felices, fondo verde | «PAGADO» |
| No entendió | Cejas confundidas | «Repítelo» |
| Sin internet | Ojos dormidos | «Sin internet» |

«Pagado» solo se muestra cuando el servidor capturó el pago con PayPal: la caja lo sabe por el canal
en vivo de la terminal (`GET /api/terminals/:id/events`), igual que la bocina. La cara no reemplaza
el monto: el monto va en texto grande y dicho en voz alta.

## 6. Firmware: pendiente de decidir

Lo único fijo es lo que la caja tiene que hacer: grabar mientras el botón está apretado, mandar el
audio a paygent, mostrar el estado (LED o cara) y reproducir la respuesta. Todavía no se elige cómo.
Las opciones conocidas:

| Opción | Qué es | A favor | En contra |
|---|---|---|---|
| **Firmware propio en Arduino** | Un sketch que graba por I2S, hace `POST /api/terminals/:id/voice` y escucha `/api/terminals/:id/events` | Habla directo con la API de paygent (§3 de la spec); simple de entender | Todo por escribir: audio, Wi-Fi, pantalla, cara |
| **Firmware propio en ESP-IDF** | Lo mismo con el framework de Espressif (`esp_lcd`, LVGL) | Más control del audio y la pantalla | Más lento de escribir esta semana |
| **XiaoZhi (`xiaozhi-esp32`)** | Firmware abierto de asistente de voz para ESP32-S3 que ya maneja INMP441, MAX98357A, pantallas y caras con emociones ⏳ | Mucho ya resuelto, incluida la cara | Está hecho para hablar con su propio servidor; habría que adaptarlo a paygent o imitar ese servidor. Licencia y protocolo por revisar ⏳ |
| **ESPHome (asistente de voz)** | Configuración en YAML con micrófono, parlante y pantalla | Rápido de configurar | Pensado para Home Assistant, no para la API de paygent |
| **Protocolo del clip de Lente** | TCP con PCM16 a 16 kHz (`docs/PROTOCOL.md` de Lente) | Ya probado con un ESP32-S3 | Paygent no tiene ese servidor; habría que portarlo |

Lo que hay que decidir: si la caja habla HTTP directo con paygent o un protocolo de streaming; si la
voz de respuesta sale de la bocina de la caja o del teléfono; y cuánto tiempo hay de aquí al jueves.

## 7. La competencia: Bold Sono QR

Bold vende en Colombia el **Sono QR** a COP 59.000: un soporte con pantalla que muestra un QR Bre-B y
confirma los pagos con sonido. Según una nota de septiembre de 2026, Bold cerró agosto con 161.468
llaves Bre-B activas de comercios, impulsadas por el Sono QR ⏳. Es la prueba de que una cajita de
cobro con sonido se vende.

Lo que paygent hace distinto:

- **El monto lo dice la vendedora**, en vez de que el cliente lo digite.
- **Cada pago queda ligado a una venta** con producto, de ahí salen «lo más vendido» y los consejos.
- **Cobra a quien no tiene Bre-B**: turistas y compradores del exterior, con PayPal, Venmo o tarjeta.

Lo que paygent no puede igualar en Colombia: el COP no es moneda de PayPal, y una venta Bre-B en
paygent queda confirmada por la vendedora con PIN, no verificada (`docs/payment-rails.md`).

## Fuentes

- Spec de la caja: [docs/voice-box.md](voice-box.md) · modelos: [docs/open-models.md](open-models.md)
- Lente (hardware de referencia): [hardware/README.md](https://github.com/ruloCode/lente/blob/main/hardware/README.md) · [docs/PROTOCOL.md](https://github.com/ruloCode/lente/blob/main/docs/PROTOCOL.md)
- Bold Sono QR: [manual (PDF)](https://www.bold.co/assets/documentos/Manual%20Sono%20QR.pdf) · [nota de Descubre.vc, 2026-09-14](https://www.descubre.vc/noticia/bold-reporta-crecimiento-r-cord-de-bre-b-en-comercios-colombianos-2026-09-14)
- Waveshare ESP32-S3-Touch-LCD-4.3 (pines ocupados por la pantalla): [wiki](https://waveshare.com/wiki/ESP32-S3-Touch-LCD-4.3)
