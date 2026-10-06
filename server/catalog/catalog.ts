// server/catalog/catalog.ts: validation of the vendor's edited catalog and SKU generation.
// Input comes from the back-office editor (or a reviewed menu-photo proposal); the server derives
// unique SKUs from the English names so neither the client nor a model ever chooses them.
import { z } from "zod";
import { type Currency, money } from "../../shared/money";
import type { CatalogItem } from "../../shared/types";

export const MAX_ITEMS = 100;
export const MAX_NAME = 60;
export const MAX_ALIASES = 20;
export const MAX_PRICE_MINOR = 10_000_000;

const name = z.string().trim().min(1).max(MAX_NAME);
const alias = z.string().trim().min(1).max(MAX_NAME);

export const itemInput = z.object({
  names: z.object({ en: name, es: name }),
  price: z.number().int().positive().max(MAX_PRICE_MINOR),
  aliases: z.array(alias).max(MAX_ALIASES).default([]),
});
export type ItemInput = z.infer<typeof itemInput>;

export const catalogInput = z.strictObject({
  items: z.array(itemInput).min(1).max(MAX_ITEMS),
});

/** "Tamal de Rajas!" -> "tamal-de-rajas"; never empty. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "item";
}

/** Validated input -> catalog items with unique generated SKUs and de-duplicated aliases. */
export function buildCatalog(items: ItemInput[], currency: Currency): CatalogItem[] {
  const used = new Set<string>();
  return items.map((it) => {
    const base = slugify(it.names.en);
    let sku = base;
    for (let n = 2; used.has(sku); n++) sku = `${base}-${n}`;
    used.add(sku);
    return {
      sku,
      name: it.names.en,
      names: { en: it.names.en, es: it.names.es },
      aliases: [...new Set(it.aliases.map((a) => a.toLowerCase()))],
      price: money(it.price, currency),
    };
  });
}
