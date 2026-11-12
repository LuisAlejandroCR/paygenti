// web/src/judge-steps.ts: which intro and guided-script keys /judge shows for the PayPal mode.
// Mock mode has a simulated pay button; sandbox mode pays through PayPal's real sandbox buttons,
// so its step 3 points at "Debit or Credit Card" and the test Visa instead.
import type { AppConfig } from "./api";
import type { Key } from "./i18n";

/** Undefined while /api/config is loading: show the mock wording until the mode is known. */
export type PayPalMode = AppConfig["paypal"] | undefined;

export function judgeIntroKey(mode: PayPalMode): Key {
  return mode === "sandbox" ? "judge.introSandbox" : "judge.intro";
}

export function judgeStepKeys(mode: PayPalMode): Key[] {
  const step3: Key = mode === "sandbox" ? "judge.step3Sandbox" : "judge.step3";
  return ["judge.step1", "judge.step2", step3, "judge.step4", "judge.step5"];
}
