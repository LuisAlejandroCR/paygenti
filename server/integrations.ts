// server/integrations.ts: plug-and-play wiring for third parties (PayPal, Postgres, Claude, signing key).
// Each one is built through plug(): if its config is missing or its constructor throws, the app boots
// on the built-in fallback instead of crashing, and /api/health says which mode each one is in.

export type IntegrationMode = "on" | "off" | "fallback";

export interface IntegrationStatus {
  mode: IntegrationMode;
  /** Why it is off or fell back; never contains secrets. */
  reason?: string;
}

export class Integrations {
  readonly status: Record<string, IntegrationStatus> = {};

  /**
   * Builds an integration. `build` returns undefined when it is not configured (mode "off");
   * if it throws or rejects, `fallback` is used (mode "fallback") and the error is logged.
   */
  async plug<T>(
    name: string,
    build: () => T | undefined | Promise<T | undefined>,
    fallback: T,
  ): Promise<T> {
    try {
      const value = await build();
      if (value === undefined) {
        this.status[name] = { mode: "off", reason: "not configured" };
        return fallback;
      }
      this.status[name] = { mode: "on" };
      return value;
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : "unknown error";
      console.error(`[${name}] failed to start, using fallback: ${reason}`);
      this.status[name] = { mode: "fallback", reason };
      return fallback;
    }
  }

  /** Same as plug() for optional features whose fallback is "feature disabled". */
  optional<T>(
    name: string,
    build: () => T | undefined | Promise<T | undefined>,
  ): Promise<T | undefined> {
    return this.plug<T | undefined>(name, build, undefined);
  }
}
