export type Rail = "paypal" | "card" | "applepay" | "googlepay" | "pix" | "spei" | "oxxo";
export type Currency = "MXN" | "BRL" | "USD";
export type TxStatus = "COMPLETED" | "pending_bank" | "refunded" | "denied";
export type TxType = "venta" | "reembolso" | "payout";
export type Origin = "verificado" | "autodeclarado";

export interface Tx {
  id: string;
  date: string; // ISO
  amount: number;
  currency: Currency;
  rail: Rail;
  status: TxStatus;
  type: TxType;
  origin: Origin;
  item: string;
  fee: number;
  stallId: string;
}

export interface Stall {
  id: string;
  name: string;
  currency: Currency;
  rails: Rail[];
}

export interface RailInfo {
  rail: Rail;
  enabled: boolean;
  reason?: string;
  conversion: number;
  avgConfirmMin: number;
  trend: number[];
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  deadline: string;
  icon: "piggy" | "cart" | "umbrella";
}

export interface Notification {
  id: string;
  text: string;
  read: boolean;
  at: string;
}

export interface TxQuery {
  stallId: string;
  start: string;
  end: string;
  status?: "S" | "P" | "V" | "D";
  page: number;
  pageSize: number;
}
