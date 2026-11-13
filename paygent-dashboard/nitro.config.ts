// nitro.config.ts: Nitro server options the Lovable vite config does not expose.
// baseURL matches Vite `base` and the router basepath (/panel) so the built server serves the
// client assets at /panel/assets/* instead of /assets/*, which belongs to the landing on the same domain.
import { defineConfig } from "nitro/config";

export default defineConfig({
  baseURL: "/panel/",
});
