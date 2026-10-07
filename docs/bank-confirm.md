<!-- docs/bank-confirm.md: spec para confirmar transferencias Bre-B sin PIN — por correo del banco (Google sign-in
     + reenvío) y, en Android, leyendo la notificación de la app del banco. Criterios de aceptación y riesgos.
     No es la investigación de rieles (docs/payment-rails.md) ni la bitácora (docs/memoria.md); la fila
     resumida vive en docs/plan.md → Pendiente #12. -->

# Confirmación bancaria automática (Bre-B)

Estado: **spec, sin implementar** (2026-10-07).

## Problema

Una venta Bre-B queda en `pending_bank` hasta que la vendedora la confirma con su PIN. Eso es fricción
en plena venta. Los bancos ya avisan cada abono, por correo o con una notificación del celular.
Paygent puede leer ese aviso y confirmar solo.

## Fuentes (v1)

| Fuente | Señal | Canal |
|---|---|---|
| Banco de Bogotá | Correo "Comprobante de Transferencia" | Reenvío de correo |
| Nequi | "Recibiste plata por Bre-B" | Reenvío de correo, o notificación en Android |

Los remitentes, asuntos y formatos exactos salen de **muestras reales** que da el usuario. Hasta tenerlas,
el parser no se escribe: inventar el formato sería adivinar.

## Flujo A — correo (web y móvil, sin fricción)

1. En Perfil → Ajustes → "Confirmación automática", la vendedora toca **Conectar con Google**.
2. Paygent pide los permisos de Gmail para configurar reenvío y filtros (no de lectura del buzón).
3. Por la API de Gmail, Paygent:
   - agrega `confirma+<puesto>@<dominio-paygent>` como dirección de reenvío;
   - crea un filtro que reenvía **solo** los correos del remitente del banco con ese asunto.
4. Gmail manda un correo de verificación a esa dirección. Llega al servidor de entrada de Paygent, que
   abre el enlace de verificación solo. La vendedora no hace nada más.
5. Cada correo reenviado entra por el webhook de correo entrante (Cloudflare Email Routing o Postmark).

Paygent nunca lee el buzón: solo recibe lo que el filtro reenvía.

## Flujo B — notificación (solo Android, opcional)

1. En la app móvil, Ajustes → "Leer avisos del banco", con una explicación de una línea.
2. Android abre la pantalla del sistema "Acceso a notificaciones"; la vendedora activa Paygent.
3. Un `NotificationListenerService` (módulo nativo con config plugin de Expo, como `mobile/plugins/with-hce.js`)
   escucha **solo** los paquetes de Nequi y Banco de Bogotá; descarta todo lo demás sin guardarlo.
4. Del aviso saca monto y hora, y llama a la misma API de conciliación que el flujo A.

iOS no permite leer notificaciones de otras apps; en iPhone solo aplica el flujo A.

## Conciliación (común a A y B)

- Del aviso solo se extraen **monto, moneda y hora**. El nombre del pagador y el resto del texto se
  descartan al parsear; nunca se guardan.
- Se busca una venta `pending_bank` del mismo puesto con **monto exacto** creada en los **30 min** previos.
  - Una sola coincidencia → pasa a `bank_confirmed`.
  - Cero o varias → queda en `pending_bank` y sigue pidiendo PIN (nada se adivina).
- `bank_confirmed` es un estado nuevo: "confirmado por banco, no verificado por proveedor". Se muestra
  aparte de lo verificado por PayPal y **nunca** cuenta como `paid`.
- Correo: solo se acepta si pasa DKIM con el dominio del banco y llega por la dirección del puesto.
  Notificación: solo si el paquete emisor es el de la app del banco.

## Criterios de aceptación

1. Con muestras reales de Banco de Bogotá y Nequi, el parser saca monto y hora; tests con esas muestras
   anonimizadas (sin nombres ni cuentas).
2. Un correo sin DKIM válido del banco no cambia ninguna venta (test).
3. Dos ventas pendientes con el mismo monto en la ventana → ninguna se confirma sola (test).
4. Una venta confirmada así aparece como "Confirmado por banco" en web y móvil, separada de lo verificado,
   con la fuente (correo o aviso) en el historial.
5. Ningún texto del aviso más allá de monto, moneda y hora llega a la base ni a los logs (test de fuga).
6. La vendedora puede desconectar Google o el acceso a notificaciones desde Perfil; al hacerlo, Paygent
   borra el filtro y la dirección de reenvío que creó.
7. Flujo B: con el acceso a notificaciones apagado, la app funciona igual que hoy (PIN).

## Riesgos y pendientes antes de construir

- **Permisos de Gmail:** Google clasifica los permisos de Gmail como sensibles o restringidos. Una app
  pública necesita verificación de Google y posiblemente una auditoría de seguridad. En modo de prueba
  sirve para hasta 100 usuarios. Confirmar la clasificación exacta en la documentación de Google antes
  de implementar.
- **Google Play:** revisar su política sobre `NotificationListenerService` antes de publicar el flujo B.
- **Muestras:** faltan un correo real de cada banco y una notificación real de Nequi.
