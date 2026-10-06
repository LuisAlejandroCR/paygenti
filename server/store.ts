// server/store.ts: persistence behind a small Store interface; MemoryStore is enough for the demo.
// Seeds the demo vendor (Rosa, tamales y atole, MXN) and her terminal "rosa-01".
import { money } from "../shared/money";
import type { Sale, Terminal, Vendor } from "../shared/types";

export interface Store {
  getVendor(id: string): Vendor | undefined;
  getTerminal(id: string): Terminal | undefined;
  getSale(id: string): Sale | undefined;
  findSaleByOrderId(orderId: string): Sale | undefined;
  findSaleByCaptureId(captureId: string): Sale | undefined;
  /** Newest first. */
  salesForTerminal(terminalId: string): Sale[];
  /** Every sale, newest first (back-office reports). */
  allSales(): Sale[];
  saveSale(sale: Sale): void;
}

export const DEMO_VENDOR: Vendor = {
  id: "rosa",
  displayName: "Rosa — Tamales y atole",
  currency: "MXN",
  catalog: [
    {
      sku: "tamal-rajas",
      name: "Tamal de rajas",
      aliases: ["rajas", "tamal de rajas", "de rajas", "tamal verde"],
      price: money(2500, "MXN"),
    },
    {
      sku: "tamal-mole",
      name: "Tamal de mole",
      aliases: ["mole", "tamal de mole", "de mole", "oaxaqueño", "tamal oaxaqueño"],
      price: money(2800, "MXN"),
    },
    {
      sku: "tamal-dulce",
      name: "Tamal dulce",
      aliases: ["dulce", "tamal dulce", "de dulce", "tamal rosa"],
      price: money(2200, "MXN"),
    },
    {
      sku: "atole",
      name: "Atole",
      aliases: ["atole", "atolito", "atole blanco", "vaso de atole"],
      price: money(2000, "MXN"),
    },
    {
      sku: "champurrado",
      name: "Champurrado",
      aliases: ["champurrado", "champurradito", "atole de chocolate"],
      price: money(2200, "MXN"),
    },
  ],
};

export const DEMO_TERMINAL: Terminal = { id: "rosa-01", vendorId: "rosa", label: "Puesto de Rosa" };

export class MemoryStore implements Store {
  private readonly vendors = new Map<string, Vendor>([[DEMO_VENDOR.id, DEMO_VENDOR]]);
  private readonly terminals = new Map<string, Terminal>([[DEMO_TERMINAL.id, DEMO_TERMINAL]]);
  private readonly sales = new Map<string, Sale>();

  getVendor(id: string): Vendor | undefined {
    return this.vendors.get(id);
  }

  getTerminal(id: string): Terminal | undefined {
    return this.terminals.get(id);
  }

  getSale(id: string): Sale | undefined {
    return this.sales.get(id);
  }

  findSaleByOrderId(orderId: string): Sale | undefined {
    for (const s of this.sales.values()) if (s.orderId === orderId) return s;
    return undefined;
  }

  findSaleByCaptureId(captureId: string): Sale | undefined {
    for (const s of this.sales.values()) if (s.captureId === captureId) return s;
    return undefined;
  }

  salesForTerminal(terminalId: string): Sale[] {
    return [...this.sales.values()].filter((s) => s.terminalId === terminalId).reverse();
  }

  allSales(): Sale[] {
    return [...this.sales.values()].reverse();
  }

  saveSale(sale: Sale): void {
    this.sales.set(sale.id, sale);
  }
}
