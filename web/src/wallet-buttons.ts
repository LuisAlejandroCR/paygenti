// web/src/wallet-buttons.ts: Apple Pay and Google Pay buttons on the sandbox checkout via PayPal JS
// SDK v6 (applepay-payments / googlepay-payments). Each mounts only when its rail is configured,
// the browser can pay (ApplePaySession / isReadyToPay) and PayPal reports it eligible. Both confirm
// the server-created order, then our server captures it: no capture, no "paid".
import {
  applePayRequest,
  canUseApplePay,
  googlePayEnvironment,
  googleTransactionInfo,
  shouldCaptureAfterConfirm,
  type WalletId,
  type WalletSale,
} from "../../shared/wallets";
import { type SdkEnv, sdkInstance } from "./paypal-sdk";

// Minimal shapes of the objects the samples use (paypal-examples/v6-web-sdk-sample-integration).
interface PayPalApplePaySession {
  formatConfigForPaymentRequest(config: unknown): object;
  validateMerchant(o: { validationUrl: string }): Promise<{ merchantSession: unknown }>;
  confirmOrder(o: {
    orderId: string;
    token: unknown;
    billingContact?: unknown;
    shippingContact?: unknown;
  }): Promise<unknown>;
}
interface PayPalGooglePaySession {
  formatConfigForPaymentRequest(config: unknown): {
    allowedPaymentMethods: unknown[];
    merchantInfo: unknown;
    apiVersion: number;
    apiVersionMinor: number;
  };
  confirmOrder(o: { orderId: string; paymentMethodData: unknown }): Promise<{ status?: string }>;
}
interface AppleSession {
  onvalidatemerchant: (e: { validationURL: string }) => void;
  onpaymentauthorized: (e: {
    payment: { token: unknown; billingContact?: unknown; shippingContact?: unknown };
  }) => void;
  oncancel: () => void;
  completeMerchantValidation(s: unknown): void;
  completePayment(r: { status: number }): void;
  abort(): void;
  begin(): void;
}
interface AppleSessionCtor {
  new (version: number, request: object): AppleSession;
  canMakePayments(): boolean;
  STATUS_SUCCESS: number;
  STATUS_FAILURE: number;
}
interface GooglePaymentsClient {
  isReadyToPay(r: object): Promise<{ result: boolean }>;
  createButton(o: {
    onClick: () => void;
    buttonType?: string;
    buttonSizeMode?: string;
  }): HTMLElement;
  loadPaymentData(r: object): Promise<unknown>;
}
interface GoogleApi {
  payments: {
    api: {
      PaymentsClient: new (o: {
        environment: "TEST" | "PRODUCTION";
        paymentDataCallbacks: {
          onPaymentAuthorized(d: { paymentMethodData: unknown }): Promise<object>;
        };
      }) => GooglePaymentsClient;
    };
  };
}
declare global {
  interface Window {
    ApplePaySession?: AppleSessionCtor;
    google?: GoogleApi;
  }
}

const APPLE_JS = "https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js";
const GOOGLE_JS = "https://pay.google.com/gp/p/js/pay.js";
const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(src));
      document.head.append(s);
    });
    p.catch(() => scripts.delete(src));
    scripts.set(src, p);
  }
  return p;
}

export interface WalletOptions {
  env: SdkEnv;
  clientId: string;
  locale: "en" | "es";
  testBuyerCountry?: string;
  orderId: string;
  sale: WalletSale;
  /** Calls our server's capture; the sale is paid only if that capture succeeds. */
  capture: () => Promise<void>;
  onError: () => void;
}

/** Mounts eligible wallet buttons into `host`; returns the wallets shown and a cleanup. */
export async function mountWallets(
  wallets: readonly WalletId[],
  host: HTMLElement,
  o: WalletOptions,
): Promise<{ shown: WalletId[]; cleanup: () => void }> {
  const nodes: HTMLElement[] = [];
  const shown: WalletId[] = [];
  const wantApple = wallets.includes("applepay");
  const wantGoogle = wallets.includes("googlepay");
  if (!wantApple && !wantGoogle) return { shown, cleanup: () => {} };

  const components = [
    ...(wantApple ? ["applepay-payments"] : []),
    ...(wantGoogle ? ["googlepay-payments"] : []),
  ];
  const sdk = await sdkInstance(o, components);
  const methods = await sdk.findEligibleMethods({
    currencyCode: o.sale.currency,
    amount: o.sale.amount,
  });
  const eligible = (w: WalletId) => {
    try {
      return methods.isEligible(w) === true;
    } catch {
      return false;
    }
  };

  if (wantApple && eligible("applepay") && sdk.createApplePayOneTimePaymentSession) {
    try {
      await loadScript(APPLE_JS);
      const Apple = window.ApplePaySession;
      if (Apple && canUseApplePay(window)) {
        const pp = sdk.createApplePayOneTimePaymentSession() as PayPalApplePaySession;
        const config = methods.getDetails("applepay") as unknown as
          | { config?: unknown }
          | undefined;
        const btn = document.createElement("apple-pay-button");
        btn.setAttribute("buttonstyle", "black");
        btn.setAttribute("type", "pay");
        btn.setAttribute("locale", o.locale === "es" ? "es-MX" : "en-US");
        btn.dataset.funding = "applepay";
        btn.addEventListener("click", () => {
          const request = applePayRequest(pp.formatConfigForPaymentRequest(config?.config), o.sale);
          const session = new Apple(4, request);
          session.onvalidatemerchant = (e) => {
            pp.validateMerchant({ validationUrl: e.validationURL }).then(
              (r) => session.completeMerchantValidation(r.merchantSession),
              () => {
                session.abort();
                o.onError();
              },
            );
          };
          session.onpaymentauthorized = async (e) => {
            try {
              await pp.confirmOrder({
                orderId: o.orderId,
                token: e.payment.token,
                billingContact: e.payment.billingContact,
                shippingContact: e.payment.shippingContact,
              });
              await o.capture();
              session.completePayment({ status: Apple.STATUS_SUCCESS });
            } catch {
              session.completePayment({ status: Apple.STATUS_FAILURE });
              o.onError();
            }
          };
          session.oncancel = () => {};
          session.begin();
        });
        nodes.push(btn);
        shown.push("applepay");
      }
    } catch {
      // Apple script blocked or failed: no Apple Pay button, the rest still mounts.
    }
  }

  if (wantGoogle && eligible("googlepay") && sdk.createGooglePayOneTimePaymentSession) {
    try {
      await loadScript(GOOGLE_JS);
      const PaymentsClient = window.google?.payments.api.PaymentsClient;
      if (PaymentsClient) {
        const pp = sdk.createGooglePayOneTimePaymentSession() as PayPalGooglePaySession;
        const details = methods.getDetails("googlepay") as unknown as
          | { config?: unknown }
          | undefined;
        const config = pp.formatConfigForPaymentRequest(details?.config);
        const client = new PaymentsClient({
          environment: googlePayEnvironment(o.env),
          paymentDataCallbacks: {
            onPaymentAuthorized: async (data) => {
              try {
                const { status } = await pp.confirmOrder({
                  orderId: o.orderId,
                  paymentMethodData: data.paymentMethodData,
                });
                if (!shouldCaptureAfterConfirm(status)) throw new Error(status);
                await o.capture();
                return { transactionState: "SUCCESS" };
              } catch {
                o.onError();
                return { transactionState: "ERROR", error: { message: "payment failed" } };
              }
            },
          },
        });
        const ready = await client.isReadyToPay({
          allowedPaymentMethods: config.allowedPaymentMethods,
          apiVersion: config.apiVersion,
          apiVersionMinor: config.apiVersionMinor,
        });
        if (ready.result) {
          const btn = client.createButton({
            buttonType: "pay",
            buttonSizeMode: "fill",
            onClick: () => {
              client
                .loadPaymentData({
                  apiVersion: config.apiVersion,
                  apiVersionMinor: config.apiVersionMinor,
                  allowedPaymentMethods: config.allowedPaymentMethods,
                  merchantInfo: config.merchantInfo,
                  transactionInfo: googleTransactionInfo(o.sale),
                  callbackIntents: ["PAYMENT_AUTHORIZATION"],
                })
                .catch(() => {}); // buyer closed the sheet
            },
          });
          btn.dataset.funding = "googlepay";
          nodes.push(btn);
          shown.push("googlepay");
        }
      }
    } catch {
      // Google script blocked or not ready: no Google Pay button.
    }
  }

  host.replaceChildren(...nodes);
  return { shown, cleanup: () => host.replaceChildren() };
}
