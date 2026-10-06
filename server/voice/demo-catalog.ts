// server/voice/demo-catalog.ts: tamales-and-atole demo catalog used by the voice parser tests.
// Prices are integer MXN minor units built with shared/money.ts.
import { money } from "../../shared/money";
import type { CatalogItem } from "../../shared/types";

export const DEMO_CATALOG: CatalogItem[] = [
  {
    sku: "tamal-rajas",
    name: "Tamal de rajas",
    aliases: ["rajas", "rajas con queso", "verde"],
    price: money(2500, "MXN"),
  },
  {
    sku: "tamal-mole",
    name: "Tamal de mole",
    aliases: ["mole", "rojo", "pollo"],
    price: money(2800, "MXN"),
  },
  {
    sku: "tamal-dulce",
    name: "Tamal dulce",
    aliases: ["dulce", "de dulce", "rosa"],
    price: money(2200, "MXN"),
  },
  { sku: "atole", name: "Atole", aliases: ["atolito"], price: money(2000, "MXN") },
  { sku: "champurrado", name: "Champurrado", aliases: [], price: money(2200, "MXN") },
];
