<!--
  paypal-server-sdk.md: cómo server/paypal/rest.ts usa el SDK oficial @paypal/paypal-server-sdk
  y qué skills paypal:typescript-* se usaron en cada parte (evidencia para el sponsor).
  No es el contrato del gateway (eso es server/paypal/gateway.ts) ni el registro de decisiones (docs/memoria.md).
-->
# PayPal Server SDK in paygent

`server/paypal/rest.ts` (`RestPayPal`, behind the unchanged `PayPalGateway` interface) now calls PayPal
through the official APIMatic-generated SDK `@paypal/paypal-server-sdk`, pinned to `2.5.0`.
`MockPayPal` is untouched and is still used when no keys are set.

## What goes through the SDK

| Gateway method | SDK call |
| --- | --- |
| OAuth token | `OAuthAuthorizationController.requestToken` |
| `createOrder` | `OrdersController.createOrder` |
| `getOrder` | `OrdersController.getOrder` |
| `captureOrder` | `OrdersController.captureOrder` |
| `refundCapture` | `PaymentsController.refundCapturedPayment` |

## What still uses plain fetch (not in SDK 2.5.0)

The SDK ships only Orders, Payments, Vault, Subscriptions, Transaction Search and OAuth controllers, so
these keep the existing hand-written fetch:

- `createInvoice` (Invoicing v2: create, send, generate-qr-code)
- `createPayout` / `getPayout` (Payouts v1)
- `verifyWebhook` (`/v1/notifications/verify-webhook-signature`, raw event embedded verbatim)

## Design notes

- One `Client` built once in the constructor. Each SDK call uses `client.withConfiguration(...)` with
  our cached token (no `expiry`), so our own token cache keeps deciding refresh: injected clock,
  refresh 60 s early, in-flight coalescing, drop on 401.
- Transport: `unstable_httpClientOptions.adapter` bridges the SDK's axios requests to our `fetch`.
  That keeps the per-call `AbortSignal.timeout`, `PAYPAL_API_URL` override (the SDK has no free-form
  base URL) and the test stubs. The SDK's own `timeout` default is `0` (no limit), so the bridge owns it.
- Retries stay off (`maxNumberOfRetries: 0`, the SDK default); writes are idempotent via
  `PayPal-Request-Id` and are not retried by the SDK anyway.
- `ApiError` (and typed `CustomError`) is mapped to our `PayPalError` from `err.body`, keeping issue
  and `debug_id` exactly as before.
- Test change: token stub responses now include `token_type`, which the SDK's `OAuthToken` schema
  requires (PayPal always sends it). No assertion changed.

## Skills used, and where

| Skill | Where it shaped the code |
| --- | --- |
| `paypal:typescript-getting-started` | exact-pinned install, root imports, reading `node_modules/@paypal/paypal-server-sdk/src` to confirm controllers (no Invoicing/Payouts/Webhooks) |
| `paypal:typescript-client-initialization` | single long-lived `Client`, `Environment.Sandbox`, `withConfiguration` returning a new client per call |
| `paypal:typescript-authentication` | `clientCredentialsAuthCredentials` with a seeded `oAuthToken`; no `oAuthTokenProvider` (a rejection would poison the client) |
| `paypal:typescript-calling-endpoints` | controllers constructed per call; Form B options objects (`{ id, paypalRequestId, prefer, body }`) |
| `paypal:typescript-models` | camelCase models (`purchaseUnits`, `currencyCode`, `unitAmount`), `CheckoutPaymentIntent` enum instead of a string |
| `paypal:typescript-error-handling` | `ApiError` caught, payload read from raw `body` and mapped to `PayPalError` |
| `paypal:typescript-configuration-resilience` | timeout default `0` noticed, retries left off on purpose, no free-form base URL handled in the adapter |
| `paypal:typescript-testing` | `unstable_httpClientOptions.adapter` as the transport seam; token stub must satisfy `OAuthToken` schema |

## Status (reviewed 2026-10-14)

- Tests stub the SDK transport. Since the switch (PR #29) there is no recorded real payment through
  the SDK path in the sandbox; the hosted demo runs in sandbox mode, so one captured and refunded
  sandbox sale would close this.
- The transport seam is `unstable_httpClientOptions`, which the SDK marks unstable: keep the exact
  pin (2.5.0) and re-check the adapter on every upgrade.
- `@paypal/agent-toolkit` ships its own nested copy of the SDK (1.1.0, see `package-lock.json`); it
  is not the copy `RestPayPal` uses.
