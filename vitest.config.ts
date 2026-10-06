// vitest.config.ts: test runner config — server and shared logic run in Node, no browser.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
