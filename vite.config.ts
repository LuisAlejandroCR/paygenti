// vite.config.ts: builds the web app (vendor PWA, checkout, back-office) from web/ into dist/web.
// In dev, Vite serves the UI and proxies API, SSE and sticker routes to the Hono server.
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const api = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: "web",
  plugins: [preact()],
  // The lazy /backoffice/ledger chunk carries AG Grid (~235 kB gzip); the main bundle stays small.
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    proxy: { "/api": api, "/t": api, "/webhooks": api },
  },
});
