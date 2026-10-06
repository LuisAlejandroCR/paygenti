// playwright.config.ts: end-to-end suite (npm run e2e) — builds the web app and starts the server
// on a spare port with no secrets (mock PayPal, demo PIN 1234), then runs every spec at phone and
// desktop sizes in English and Spanish. The PIN-lockout spec runs last because it locks the vendor.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8791);
const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 800 } };
const main = [
  { name: "phone-en", use: { ...phone, locale: "en-US" } },
  { name: "phone-es", use: { ...phone, locale: "es-MX" } },
  { name: "desktop-en", use: { ...desktop, locale: "en-US" } },
  { name: "desktop-es", use: { ...desktop, locale: "es-MX" } },
];

export default defineConfig({
  testDir: "e2e",
  // One shared in-memory server and one terminal: run serially so sales do not interleave.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    ...main.map((p) => ({ ...p, testIgnore: /lockout\.spec\.ts/ })),
    {
      name: "lockout",
      testMatch: /lockout\.spec\.ts/,
      use: { ...desktop, locale: "en-US" },
      dependencies: main.map((p) => p.name),
    },
  ],
  webServer: {
    command: "npm run build && npx tsx server/index.ts",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      PUBLIC_URL: "",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_WEBHOOK_ID: "",
      ANTHROPIC_API_KEY: "",
      VENDOR_PIN: "",
    },
  },
});
