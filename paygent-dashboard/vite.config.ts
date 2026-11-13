// vite.config.ts: Lovable TanStack Start config, plus a dev proxy so /api reaches the Paygent
// server named by VITE_PAYGENT_API (the server sends no CORS headers, so the browser stays same-origin).
// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// `--mode live` (npm run dev:live) points at a local server on :8787 unless VITE_PAYGENT_API says otherwise.
const argMode = process.argv[process.argv.indexOf("--mode") + 1];
const mode =
  process.argv.includes("--mode") && argMode
    ? argMode
    : process.env["NODE_ENV"] === "production"
      ? "production"
      : "development";
if (mode === "live") process.env["VITE_PAYGENT_API"] ??= "http://localhost:8787";
const env = loadEnv(mode, process.cwd(), "VITE_");
const api = env["VITE_PAYGENT_API"] ?? process.env["VITE_PAYGENT_API"] ?? "";
const target = /^https?:\/\//.test(api) ? api : undefined;

// The dashboard lives under /panel so the main site (paygenti.vercel.app) can proxy it on the
// same domain: assets load from /panel/assets/* and never collide with the landing's /assets.
const BASE_PATH = "/panel";

export default defineConfig({
  tanstackStart: {
    router: { basepath: BASE_PATH },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    base: `${BASE_PATH}/`,
    ...(target && { server: { proxy: { "/api": { target, changeOrigin: true } } } }),
  },
});
