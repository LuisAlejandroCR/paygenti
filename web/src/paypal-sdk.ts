// web/src/paypal-sdk.ts: PayPal JS SDK v6 for the customer checkout — loads web-sdk/v6/core once,
// creates an instance per client/buyer-country/locale/components, asks findEligibleMethods which
// of the sale's candidate methods this buyer may use, and mounts their buttons (PayPal, Venmo,
// Pay Later, card) plus the Pay Later message. Our server still creates and captures the order.
import { type FundingSource, selectFundingSources } from "../../shared/funding";

interface EligibleMethods {
  isEligible(method: string): boolean;
  getDetails(method: string): { productCode?: string; countryCode?: string } | undefined;
}
interface PaymentSession {
  start(options: { presentationMode: "auto" }, order: Promise<{ orderId: string }>): Promise<void>;
  destroy?(): void;
}
interface SessionOptions {
  onApprove(data: { orderId: string }): Promise<void>;
  onCancel(): void;
  onError(error: unknown): void;
}
export interface SdkInstance {
  findEligibleMethods(options: { currencyCode: string; amount?: string }): Promise<EligibleMethods>;
  createPayPalOneTimePaymentSession(options: SessionOptions): PaymentSession;
  createVenmoOneTimePaymentSession?(options: SessionOptions): PaymentSession;
  createPayLaterOneTimePaymentSession(options: SessionOptions): PaymentSession;
  createPayPalGuestOneTimePaymentSession?(
    options: SessionOptions,
  ): PaymentSession | Promise<PaymentSession>;
  /** Components "applepay-payments" / "googlepay-payments" (see web/src/wallet-buttons.ts). */
  createApplePayOneTimePaymentSession?(): unknown;
  createGooglePayOneTimePaymentSession?(): unknown;
  createPayPalMessages?(options: { currencyCode?: string; buyerCountry?: string }): unknown;
}
interface PayPalWebSdk {
  createInstance(options: {
    clientId: string;
    components: string[];
    pageType: "checkout";
    locale: string;
    testBuyerCountry?: string;
  }): Promise<SdkInstance>;
}
declare global {
  interface Window {
    paypal?: PayPalWebSdk;
  }
}

/** v6 needs the environment in the URL: a sandbox client id only works on the sandbox host. */
const SDK_URL = {
  sandbox: "https://www.sandbox.paypal.com/web-sdk/v6/core",
  live: "https://www.paypal.com/web-sdk/v6/core",
} as const;
export type SdkEnv = keyof typeof SDK_URL;

let scriptLoad: Promise<PayPalWebSdk> | undefined;
const instances = new Map<string, Promise<SdkInstance>>();

function loadScript(env: SdkEnv): Promise<PayPalWebSdk> {
  if (window.paypal) return Promise.resolve(window.paypal);
  scriptLoad ??= new Promise<PayPalWebSdk>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL[env];
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("sdk")));
    s.onerror = () => reject(new Error("sdk"));
    document.head.append(s);
  }).catch((err: unknown) => {
    scriptLoad = undefined;
    throw err;
  });
  return scriptLoad;
}

/** SDK v6 components each method needs; requested only when the currency allows the method. */
function componentsFor(candidates: readonly FundingSource[]): string[] {
  const out = ["paypal-payments"];
  if (candidates.includes("venmo")) out.push("venmo-payments");
  if (candidates.includes("card")) out.push("paypal-guest-payments");
  if (candidates.includes("paylater")) out.push("paypal-messages");
  return out;
}

export interface CheckoutSdkOptions {
  env: SdkEnv;
  clientId: string;
  locale: "en" | "es";
  currency: string;
  /** Order total as PayPal's decimal string ("95.00"); Pay Later eligibility depends on it. */
  amount: string;
  candidates: readonly FundingSource[];
  /** Sandbox only: the buyer country PayPal should simulate. */
  testBuyerCountry?: string;
}

export interface CheckoutSdk {
  sdk: SdkInstance;
  /** Eligible methods in render order; PayPal alone if the eligibility call failed. */
  sources: FundingSource[];
  details: (source: FundingSource) => { productCode?: string; countryCode?: string } | undefined;
}

/** One cached SDK instance per client id / components / locale / test buyer country. */
export async function sdkInstance(
  o: Pick<CheckoutSdkOptions, "env" | "clientId" | "locale" | "testBuyerCountry">,
  components: string[],
): Promise<SdkInstance> {
  const paypal = await loadScript(o.env);
  const testBuyerCountry = o.env === "sandbox" ? o.testBuyerCountry : undefined;
  const locale = o.locale === "es" ? "es-MX" : "en-US";
  const key = [o.clientId, components.join(","), locale, testBuyerCountry ?? ""].join("|");
  let instance = instances.get(key);
  if (!instance) {
    instance = paypal.createInstance({
      clientId: o.clientId,
      components,
      pageType: "checkout",
      locale,
      ...(testBuyerCountry && { testBuyerCountry }),
    });
    instance.catch(() => instances.delete(key));
    instances.set(key, instance);
  }
  return instance;
}

export async function prepareCheckout(o: CheckoutSdkOptions): Promise<CheckoutSdk> {
  const sdk = await sdkInstance(o, componentsFor(o.candidates));
  try {
    const methods = await sdk.findEligibleMethods({ currencyCode: o.currency, amount: o.amount });
    return {
      sdk,
      sources: selectFundingSources(o.currency, (s) => methods.isEligible(s)),
      details: (s) => methods.getDetails(s),
    };
  } catch {
    // Eligibility service down: the PayPal wallet is the one method every PayPal currency has.
    return {
      sdk,
      sources: o.candidates.includes("paypal") ? ["paypal"] : [],
      details: () => undefined,
    };
  }
}

export interface MountOptions {
  orderId: string;
  currency: string;
  amount: string;
  testBuyerCountry?: string;
  dark: boolean;
  onApprove: () => Promise<void>;
  onCancel: () => void;
  onError: () => void;
}

/**
 * Mounts one button per eligible method into `buttons` (in `ready.sources` order) and the Pay
 * Later message into `message` when Pay Later is eligible. Returns a cleanup function.
 */
export async function mountCheckout(
  ready: CheckoutSdk,
  buttons: HTMLElement,
  message: HTMLElement | null,
  o: MountOptions,
): Promise<() => void> {
  const { sdk } = ready;
  const sessions: PaymentSession[] = [];
  const handlers: SessionOptions = {
    onApprove: () => o.onApprove(),
    onCancel: () => o.onCancel(),
    onError: () => o.onError(),
  };
  const nodes: HTMLElement[] = [];

  for (const source of ready.sources) {
    let session: PaymentSession | undefined;
    let trigger: HTMLElement;
    let node: HTMLElement;
    if (source === "paypal") {
      session = sdk.createPayPalOneTimePaymentSession(handlers);
      trigger = node = document.createElement("paypal-button");
      trigger.setAttribute("type", "pay");
    } else if (source === "venmo" && sdk.createVenmoOneTimePaymentSession) {
      session = sdk.createVenmoOneTimePaymentSession(handlers);
      trigger = node = document.createElement("venmo-button");
      trigger.setAttribute("type", "pay");
    } else if (source === "paylater") {
      const d = ready.details("paylater");
      session = sdk.createPayLaterOneTimePaymentSession(handlers);
      trigger = node = document.createElement("paypal-pay-later-button");
      Object.assign(trigger, { productCode: d?.productCode, countryCode: d?.countryCode });
    } else if (source === "card" && sdk.createPayPalGuestOneTimePaymentSession) {
      session = await sdk.createPayPalGuestOneTimePaymentSession(handlers);
      node = document.createElement("paypal-basic-card-container");
      trigger = document.createElement("paypal-basic-card-button");
      node.append(trigger);
    } else continue;
    const s = session;
    sessions.push(s);
    node.dataset.funding = source;
    trigger.addEventListener("click", () => {
      // Pass the order promise without awaiting first: start() needs the click's user activation.
      s.start({ presentationMode: "auto" }, Promise.resolve({ orderId: o.orderId })).catch(() =>
        o.onError(),
      );
    });
    nodes.push(node);
  }
  buttons.replaceChildren(...nodes);

  if (message && ready.sources.includes("paylater") && sdk.createPayPalMessages) {
    sdk.createPayPalMessages({
      currencyCode: o.currency,
      ...(o.testBuyerCountry && { buyerCountry: o.testBuyerCountry }),
    });
    const m = document.createElement("paypal-message");
    m.setAttribute("auto-bootstrap", "");
    m.setAttribute("amount", o.amount);
    m.setAttribute("currency-code", o.currency);
    m.setAttribute("logo-type", "MONOGRAM");
    m.setAttribute("text-color", o.dark ? "WHITE" : "MONOCHROME");
    if (o.testBuyerCountry) m.setAttribute("buyer-country", o.testBuyerCountry);
    message.replaceChildren(m);
  }

  return () => {
    for (const s of sessions) s.destroy?.();
    buttons.replaceChildren();
    message?.replaceChildren();
  };
}
