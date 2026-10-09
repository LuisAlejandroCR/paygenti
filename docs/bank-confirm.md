<!-- docs/bank-confirm.md: spec para confirmar ventas Bre-B sin PIN usando el aviso del banco — Gmail de solo
     lectura (hackathon), notificación en Android (producción) y reenvío manual (iPhone). Formatos reales,
     criterios de aceptación y riesgos. No es la investigación de rieles (docs/payment-rails.md) ni la
     bitácora (docs/memoria.md); la fila resumida vive en docs/plan.md → Pendiente #12. -->

# Confirmación bancaria automática (Bre-B)

Estado: **spec, sin implementar** (revisado 2026-10-07).

## Problema

Una venta Bre-B queda en `pending_bank` hasta que la vendedora la confirma con su PIN. Eso es fricción
en plena venta. El banco de la vendedora ya le avisa cada abono por correo y por notificación; Paygent
puede leer ese aviso y confirmar solo.

## Decisión de canales

| Canal | Cuándo | Fricción |
|---|---|---|
| **1. Gmail solo lectura** (Google sign-in + push de Gmail) | Hackathon, web y móvil | Un toque |
| **2. Notificación del banco** (Android) | Producción, Android | Un interruptor |
| **3. Reenvío manual** a un buzón de entrada de Paygent | Producción, iPhone | ~2 min guiados |

Descartado: crear el reenvío automáticamente. `users.settings.forwardingAddresses.create` de la API de
Gmail "solo está disponible para cuentas de servicio con delegación de dominio" (Workspace), no para
cuentas @gmail.com. Fuente: developers.google.com, revisado 2026-10-07.

## Formatos reales (muestras del usuario, 2026-10-06/07)

| Aviso | Remitente | ¿Sirve? |
|---|---|---|
| Nequi "¡Recibiste plata por Bre-B!" | `notificaciones@nequi.com.co` | **Sí** — es el abono a la vendedora |
| Nequi "¡Enviaste plata por Bre-B!" | `notificaciones@nequi.com.co` | No — es dinero que ella envió; test negativo |
| Banco de Bogotá "Comprobante de Transferencia" | `NotificacionesBDB@bancodebogota.net` | No para confirmar — es el recibo de **quien envía**; la vendedora no lo recibe |

Línea útil de Nequi (forma, con datos ficticios):

```
Recibiste 70.000 de NOMBRE PAGADOR el 6 de octubre de 2026 a las 11:25 a.m, desde el banco Bco Bogotá.
```

- Monto con punto de miles, sin decimales ni símbolo (COP).
- Fecha en español con mes en letras; hora `h:mm a.m`/`p.m`.
- "desde el banco" puede venir vacío ("desde el banco .").
- Se extraen **solo monto, fecha y hora**. El nombre del pagador y el banco se descartan al parsear.

Los PDF originales tienen nombres, correos, una llave Bre-B y una IP reales: **no se versionan**
(`*.pdf` en `.gitignore`). Los tests usan muestras reescritas con datos ficticios.

## Canal 1 — Gmail solo lectura (hackathon)

1. Perfil → Ajustes → "Confirmación automática" → **Conectar con Google**.
2. Google sign-in con el permiso `gmail.readonly` (sin Clerk: Paygent no tiene login propio y solo
   necesita el token; agregar Clerk solo si más adelante hace falta login).
3. El servidor llama `users.watch` con un tema de Pub/Sub; Gmail avisa cada correo nuevo.
4. En cada aviso, el servidor busca solo `from:notificaciones@nequi.com.co subject:"Recibiste plata por Bre-B"`
   y lee únicamente esos mensajes. Nada más del buzón se lee ni se guarda.
5. `gmail.readonly` es un permiso restringido: en modo de prueba sirve hasta 100 usuarios. Publicarlo
   exige verificación de Google y auditoría de seguridad; por eso en producción se usan los canales 2 y 3.

## Canal 2 — Notificación en Android (producción)

1. App móvil → Ajustes → "Leer avisos del banco", con una línea de explicación.
2. Android abre "Acceso a notificaciones"; la vendedora activa Paygent.
3. `NotificationListenerService` (módulo nativo con config plugin de Expo, como `mobile/plugins/with-hce.js`)
   escucha solo el paquete de Nequi; todo lo demás se descarta sin guardarse.
4. Del texto saca monto y hora y llama a la API de conciliación.
5. Falta: una captura real de la notificación de Nequi (el texto puede diferir del correo).

## Canal 3 — Reenvío manual (iPhone)

1. Paygent da una dirección por puesto, `confirma+<puesto>@<dominio-paygent>`, recibida por **Resend
   Inbound** (ya está en el stack por defecto de `procedures`) con webhook al servidor.
2. Guía en 3 pasos: abrir Gmail → Reenvío → pegar la dirección.
3. Gmail manda un código de verificación a esa dirección; Paygent lo muestra en la app para que la
   vendedora lo pegue. Después, la guía crea el filtro por remitente y asunto.
4. Solo se aceptan correos reenviados cuyo original sea de `nequi.com.co` y pase DKIM (confirmar que
   Resend expone los resultados de autenticación o las cabeceras crudas).

## Conciliación (común a los 3 canales)

- Se busca una venta `pending_bank` del mismo puesto con **monto exacto** creada en los **30 min** previos
  a la hora del aviso.
  - Una sola coincidencia → `bank_confirmed`.
  - Cero o varias → sigue en `pending_bank` y pide PIN.
- `bank_confirmed`: "confirmado por banco, no verificado por proveedor". Aparte de lo verificado por
  PayPal y **nunca** `paid`.
- El historial guarda la fuente (gmail, notificación, reenvío), no el texto.

## Criterios de aceptación

1. Parser de Nequi "Recibiste": saca monto y hora de las muestras ficticias, incluso con "desde el banco ." vacío.
2. "Enviaste plata por Bre-B" y el comprobante de Banco de Bogotá no confirman nada (tests).
3. Dos ventas pendientes con el mismo monto en la ventana → ninguna se confirma sola (test).
4. Una venta así aparece como "Confirmado por banco" en web y móvil, separada de lo verificado, con la fuente.
5. Ningún nombre, llave, cuenta ni IP llega a la base ni a los logs (test de fuga).
6. Desconectar Google o el acceso a notificaciones desde Perfil corta el canal; con Google se llama `users.stop`.
7. Con todos los canales apagados, todo funciona como hoy (PIN).

## Pendientes antes de construir

- Captura real de la notificación de Nequi en Android.
- Proyecto de Google Cloud con Gmail API, Pub/Sub y pantalla de consentimiento en modo de prueba.
- Revisar la política de Google Play sobre `NotificationListenerService`.
- Dominio de entrada en Resend y cómo expone DKIM del correo original reenviado.
