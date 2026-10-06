// server/paypal/index.ts: picks the PayPal gateway from the environment.
// PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET -> sandbox REST; otherwise the in-memory mock.
import type { PayPalGateway } from "./gateway";
import { MockPayPal } from "./mock";
import { RestPayPal } from "./rest";

export function createGateway(env: Record<string, string | undefined>): PayPalGateway {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) {
    return new RestPayPal({
      clientId,
      clientSecret,
      webhookId: env.PAYPAL_WEBHOOK_ID?.trim(),
      baseUrl: env.PAYPAL_API_URL?.trim() || undefined,
    });
  }
  return new MockPayPal();
}
