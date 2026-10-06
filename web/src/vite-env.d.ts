// web/src/vite-env.d.ts: lets TypeScript accept Vite asset imports such as "./styles.css" and import.meta.env flags.
declare module "*.css";
interface ImportMeta {
  readonly env: { readonly PROD: boolean; readonly DEV: boolean };
}
