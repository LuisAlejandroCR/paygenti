import { createContext, useContext } from "react";
import type { Rail, Stall, Tx } from "@/lib/types";

export type Tab = "resumen" | "ventas" | "movimientos" | "perfil";
export type Section = "rieles" | "metas" | "prefs";
export type FlowName = "cobrar" | "confirmar" | "reembolso" | "payout" | "importar" | "exportar";
export type Overlay =
  | { kind: "flow"; flow: FlowName; ids?: string[]; txId?: string; ai?: boolean }
  | { kind: "item"; item: string }
  | { kind: "tx"; id: string }
  | { kind: "rail"; rail: Rail }
  | { kind: "goal"; id?: string }
  | { kind: "heat"; dow: number; hour: number }
  | { kind: "compare"; a: string; b: string }
  | null;

export interface Search {
  tab?: Tab;
  section?: Section;
  month?: string;
  stall?: string;
  rail?: Rail;
  filter?: "verificado" | "autodeclarado" | "pending_bank";
  q?: string;
}

export interface Dash {
  search: Required<Pick<Search, "tab" | "month" | "stall">> & Search;
  stall: Stall;
  stalls: Stall[];
  txs: Tx[]; // all for stall, rail-filtered
  allTxs: Tx[];
  nav: (s: Partial<Search>) => void;
  open: (o: Overlay) => void;
}
export const DashCtx = createContext<Dash | null>(null);
export const useDash = () => {
  const c = useContext(DashCtx);
  if (!c) throw new Error("no dash");
  return c;
};
