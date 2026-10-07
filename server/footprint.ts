// server/footprint.ts: the financial footprint — descriptive indicators (days active, months selling,
// active weeks, monthly income per currency, savings goal progress). Never a score: no figure
// combines them. Verified PayPal sales and imported statements stay in separate, labelled blocks.

import {
  FOOTPRINT_DISCLAIMER,
  type Footprint,
  type FootprintMonth,
  type SavingsGoal,
  STATEMENT_LABEL,
  type StatementMonth,
  type TrendDirection,
  VERIFIED_LABEL,
} from "../shared/passport";
import type { Sale } from "../shared/types";

/** A settled sale as the footprint sees it: day, currency and money only. */
export interface FootprintSale {
  day: string;
  currency: string;
  method: Sale["method"];
  captured: boolean;
  total: number;
  refunded: number;
}

export interface FootprintInput {
  /** Last day considered (end of the passport period). */
  to: string;
  sales: FootprintSale[];
  statement: StatementMonth[];
  goal?: SavingsGoal;
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

function monthsInclusive(fromDay: string, toDay: string): number {
  const [fy, fm] = [Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7))];
  const [ty, tm] = [Number(toDay.slice(0, 4)), Number(toDay.slice(5, 7))];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

function direction(prev: number, last: number): TrendDirection {
  if (last === prev) return "flat";
  return last > prev ? "up" : "down";
}

export function computeFootprint(input: FootprintInput): Footprint {
  const verified = input.sales.filter(
    (s) => s.method === "paypal" && s.captured && s.day <= input.to,
  );
  const days = [...new Set(verified.map((s) => s.day))].sort();
  const first = days[0] ?? null;
  const last = days.at(-1) ?? null;

  const months = new Map<string, FootprintMonth>();
  for (const s of verified) {
    const month = s.day.slice(0, 7);
    const key = `${month}|${s.currency}`;
    const m = months.get(key) ?? { month, currency: s.currency, count: 0, net: 0 };
    m.count++;
    m.net += s.total - Math.min(s.refunded, s.total);
    months.set(key, m);
  }
  const monthly = [...months.values()].sort((a, b) =>
    a.currency === b.currency ? (a.month < b.month ? -1 : 1) : a.currency < b.currency ? -1 : 1,
  );

  const trend = [...new Set(monthly.map((m) => m.currency))].map((currency) => {
    const series = monthly.filter((m) => m.currency === currency);
    const prev = series.at(-2);
    const last = series.at(-1);
    if (!prev || !last) return { currency, direction: "n/a" as TrendDirection };
    return { currency, direction: direction(prev.net, last.net) };
  });

  let activeWeeks = 0;
  let totalWeeks = 0;
  if (first) {
    const start = dayNumber(first);
    totalWeeks = Math.floor((dayNumber(input.to) - start) / 7) + 1;
    activeWeeks = new Set(days.map((d) => Math.floor((dayNumber(d) - start) / 7))).size;
  }

  const goal = input.goal;
  return {
    disclaimer: FOOTPRINT_DISCLAIMER,
    verified: {
      label: VERIFIED_LABEL,
      source: "PayPal captured payments",
      firstSaleDay: first,
      lastSaleDay: last,
      daysActive: days.length,
      monthsSelling: first ? monthsInclusive(first, input.to) : 0,
      activeWeeks,
      totalWeeks,
      monthly,
      trend,
    },
    selfReported: {
      label: STATEMENT_LABEL,
      source: "Bank statement imported by the vendor",
      monthly: [...input.statement].sort((a, b) =>
        a.currency === b.currency ? (a.month < b.month ? -1 : 1) : a.currency < b.currency ? -1 : 1,
      ),
    },
    savingsGoal: goal
      ? {
          ...goal,
          label: "set by the vendor",
          progressPercent:
            goal.target > 0 ? Math.min(100, Math.floor((goal.saved / goal.target) * 100)) : 0,
        }
      : null,
  };
}
