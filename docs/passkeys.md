<!-- docs/passkeys.md: spec para desbloquear la pantalla de cobro con Face ID / huella (passkeys WebAuthn en la
     web; expo-local-authentication en la app como paso siguiente). Criterios de aceptación, endpoints,
     límites y prueba manual en teléfono. No es la spec del PIN ni de la confirmación bancaria
     (docs/bank-confirm.md); el razonamiento y la bitácora van en docs/memoria.md. -->

# Desbloqueo con Face ID / huella (passkeys)

Estado: **web implementada** (rama `claude/great-wescoff-026805`, 2026-11-12). App Expo: paso siguiente.

## Problema

Para cobrar, el teléfono de la vendedora necesita un token de dispositivo (`pgd.…`, 7 días) que hoy sale
solo de `POST /api/terminals/:id/unlock` con el PIN del puesto. Teclear el PIN en plena venta es lento.
Face ID (iPhone) o la huella / cara (Android) son un toque.

## Decisión

| Plataforma | Mecanismo | Por qué |
|---|---|---|
| **Web** (Safari iPhone, Chrome Android) | Passkey de plataforma WebAuthn (`@simplewebauthn`) | Sin build de tienda; listo para el video |
| **App Expo** (`mobile/`) | `expo-local-authentication` + `expo-secure-store` | Passkeys nativas piden associated domains + otra librería |

El PIN sigue siendo **la única forma de enrolar** y el respaldo cuando la passkey falla.

## Flujo web

1. La vendedora desbloquea con el PIN → recibe el token de siempre.
2. Si `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` es `true`, la pantalla ofrece
   **"Usar Face ID / huella la próxima vez"**.
3. Enrolar: `POST /api/terminals/:id/passkey/register/options` (Bearer = token del PIN) →
   `navigator.credentials.create` → `POST …/passkey/register` (Bearer). Se guarda la credencial del
   terminal (`id`, llave pública, contador, transports).
4. Siguiente vez: botón **"Desbloquear con Face ID / huella"** → `POST …/passkey/options` →
   `navigator.credentials.get` → `POST …/passkey/unlock` → **el mismo token** que da el PIN.
5. Si la passkey falla o se cancela: mensaje y el formulario del PIN sigue ahí.

## Criterios de aceptación

1. Enrolar sin token válido del puesto dueño del terminal → `401 CHARGE_AUTH_REQUIRED`.
2. Registro: `authenticatorAttachment: "platform"`, `userVerification: "required"`,
   `residentKey: "preferred"`; RP ID = host de `PUBLIC_URL` (`paygent-rirl.onrender.com`) o `localhost`.
3. Assertion válida → `200 { token, expiresInMs }` con la misma forma que `/unlock` (`pgd.<stall>.…`) y
   el token abre ventas (`POST /api/terminals/:id/sales` → 201).
4. Origen o RP ID equivocado, credencial desconocida, credencial de otro terminal, reto reusado o
   vencido (5 min) → `401 PASSKEY_FAILED`; nunca token.
5. Límite: 5 fallos por cliente (IP) bloquean 5 min, duplicando hasta 1 h → `429 PASSKEY_LOCKED`.
   Si ese cliente ya está bloqueado por el PIN, la passkey también responde `429`.
6. La lockout del PIN no cambia (mismo `PinGuard`, mismas claves de cliente, fix X-Forwarded-For de #49).
7. Credenciales persistidas en el store (memoria y Postgres, migración 5); sobreviven reinicios.
8. Botón oculto si el navegador no tiene autenticador de plataforma con verificación de usuario.
9. Retos: un solo uso, guardados en memoria del servidor, máximo 1000 vivos.

## Endpoints

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `POST /api/terminals/:id/passkey/register/options` | Bearer token | `PublicKeyCredentialCreationOptionsJSON` |
| `POST /api/terminals/:id/passkey/register` | Bearer token | `{ ok: true }` / `401 PASSKEY_FAILED` |
| `POST /api/terminals/:id/passkey/options` | público | `PublicKeyCredentialRequestOptionsJSON` / `404 PASSKEY_NONE` |
| `POST /api/terminals/:id/passkey/unlock` | público | `{ token, expiresInMs }` / `401` / `429` |

## Prueba manual en teléfono

1. Abrir `https://paygent-rirl.onrender.com/v/rosa-01` en Safari (iPhone) o Chrome (Android).
2. Desbloquear con el PIN → tocar "Usar Face ID / huella la próxima vez" → aceptar Face ID / huella.
3. Abrir la misma URL en una pestaña privada (sin token guardado; la passkey vive en el llavero del
   teléfono, no en el sitio).
4. Tocar "Desbloquear con Face ID / huella" → el teclado de cobro aparece sin teclear PIN.
5. Cancelar el diálogo de Face ID → aparece el aviso y el PIN sigue funcionando.

## App Expo (paso siguiente, no hecho)

Las sesiones de APK y TestFlight son dueñas de `mobile/` ahora. Plan: tras el primer PIN, guardar el
token en `expo-secure-store` con `requireAuthentication: true`; al abrir, `authenticateAsync` y leerlo;
si el servidor lo rechaza (`CHARGE_AUTH_REQUIRED`), volver al PIN. iOS necesita
`NSFaceIDUsageDescription` en `app.config.ts` (plugin de `expo-local-authentication`).
