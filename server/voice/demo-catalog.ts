// server/voice/demo-catalog.ts: tamales-and-atole demo catalog used by the voice parser tests.
// Prices are integer MXN minor units built with shared/money.ts.
import { money } from "../../shared/money";
import type { CatalogItem } from "../../shared/types";

export const DEMO_CATALOG: CatalogItem[] = [
  {
    sku: "tamal-rajas",
    name: "Rajas tamale",
    names: { en: "Rajas tamale", es: "Tamal de rajas" },
    aliases: ["rajas", "rajas con queso", "verde", "rajas tamale", "green tamale", "green"],
    price: money(2500, "MXN"),
  },
  {
    sku: "tamal-mole",
    name: "Mole tamale",
    names: { en: "Mole tamale", es: "Tamal de mole" },
    aliases: ["mole", "rojo", "pollo", "mole tamale", "red tamale", "red", "chicken"],
    price: money(2800, "MXN"),
  },
  {
    sku: "tamal-dulce",
    name: "Sweet tamale",
    names: { en: "Sweet tamale", es: "Tamal dulce" },
    aliases: ["dulce", "de dulce", "rosa", "sweet tamale", "sweet", "pink tamale"],
    price: money(2200, "MXN"),
  },
  {
    sku: "atole",
    name: "Atole",
    names: { en: "Atole", es: "Atole" },
    aliases: ["atolito", "atole", "corn drink"],
    price: money(2000, "MXN"),
  },
  {
    sku: "champurrado",
    name: "Champurrado",
    names: { en: "Champurrado", es: "Champurrado" },
    aliases: ["chocolate atole", "hot chocolate"],
    price: money(2200, "MXN"),
  },
];
