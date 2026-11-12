// scripts/vercel-pages.ts: after `vite build`, makes the landing page the site root for Vercel
// (npm run build:vercel). Vercel serves a real file before any rewrite, so "/" would open the app's
// index.html: the app shell moves to app.html (every app route rewrites there, see vercel.json) and
// landing.html becomes index.html. Render keeps the plain `npm run build` output untouched.
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dirname, "../dist/web");
const app = resolve(out, "index.html");
const landing = resolve(out, "landing.html");
if (!existsSync(app) || !existsSync(landing)) throw new Error("run `npm run build` first");
copyFileSync(app, resolve(out, "app.html"));
copyFileSync(landing, app);
console.log("dist/web: landing → index.html, app shell → app.html");
