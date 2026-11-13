// icons.tsx: inline SVG icon set, rail colors/names/icons and the empty-state illustration (no emoji).
import type { SVGProps } from "react";
import type { Rail } from "@/lib/types";
import type { TKey } from "@/lib/i18n";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});
const mk =
  (d: React.ReactNode) =>
  ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}>
      {d}
    </svg>
  );

export const Icon = {
  eye: mk(
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  ),
  eyeOff: mk(
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>,
  ),
  bell: mk(
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>,
  ),
  chevL: mk(<path d="M15 18l-6-6 6-6" />),
  chevR: mk(<path d="M9 18l6-6-6-6" />),
  chevD: mk(<path d="M6 9l6 6 6-6" />),
  x: mk(<path d="M18 6 6 18M6 6l12 12" />),
  check: mk(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  alert: mk(
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </>,
  ),
  home: mk(
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>,
  ),
  chart: mk(
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>,
  ),
  rails: mk(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>,
  ),
  list: mk(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r=".5" />
      <circle cx="3.5" cy="12" r=".5" />
      <circle cx="3.5" cy="18" r=".5" />
    </>,
  ),
  target: mk(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>,
  ),
  charge: mk(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </>,
  ),
  transfer: mk(
    <>
      <path d="M4 8h14l-3-3M20 16H6l3 3" />
    </>,
  ),
  refund: mk(
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>,
  ),
  supplier: mk(
    <>
      <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>,
  ),
  upload: mk(
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>,
  ),
  download: mk(
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>,
  ),
  table: mk(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </>,
  ),
  filter: mk(<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />),
  search: mk(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
  ),
  moon: mk(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />),
  sun: mk(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  text: mk(
    <>
      <path d="M4 7V5h10v2M9 5v14M7 19h4" />
      <path d="M14 12v-1h6v1M17 11v8M15.5 19h3" />
    </>,
  ),
  globe: mk(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>,
  ),
  store: mk(
    <>
      <path d="M4 9 5.5 4h13L20 9" />
      <path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9" />
      <path d="M5 11v9h14v-9M10 20v-5h4v5" />
    </>,
  ),
  sparkle: mk(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />),
  piggy: mk(
    <>
      <path d="M19 10c1 0 2 .6 2 2s-1 1.5-2 1.5c-.5 1.6-1.6 2.8-3 3.5V20h-3v-2h-3v2H7v-3c-2-1.2-3-3-3-5 0-3.5 3.6-6 8-6 1 0 2 .1 3 .4L17.5 5v3.2c.7.5 1.2 1.1 1.5 1.8Z" />
      <path d="M15 11h.01" />
    </>,
  ),
  cart: mk(
    <>
      <path d="M3 4h2l2.5 11h11l2-8H6.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </>,
  ),
  umbrella: mk(
    <>
      <path d="M2 12a10 10 0 0 1 20 0Z" />
      <path d="M12 12v7a2 2 0 0 0 4 0" />
    </>,
  ),
  user: mk(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>,
  ),
  plus: mk(<path d="M12 5v14M5 12h14" />),
  backspace: mk(
    <>
      <path d="M21 5H8l-6 7 6 7h13V5Z" />
      <path d="m11 9 6 6M17 9l-6 6" />
    </>,
  ),
  lock: mk(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>,
  ),
  clock: mk(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  taco: mk(
    <>
      <path d="M3 17a9 9 0 0 1 18 0Z" />
      <path d="M6 14c1-1 2 0 3-1s2 0 3-1 2 0 3-1 2 0 3 1" />
    </>,
  ),
  cup: mk(
    <>
      <path d="M6 8h12l-1.5 12h-9L6 8Z" />
      <path d="M5 8h14M12 8l2-5h3" />
    </>,
  ),
  bowl: mk(
    <>
      <path d="M3 11h18a9 9 0 0 1-18 0Z" />
      <path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4" />
    </>,
  ),
  more: mk(
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>,
  ),
  refresh: mk(
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>,
  ),
};

export const RAIL_COLOR: Record<Rail, string> = {
  paypal: "var(--chart-1)",
  card: "var(--chart-3)",
  applepay: "var(--chart-6)",
  googlepay: "var(--chart-4)",
  pix: "var(--chart-5)",
  spei: "var(--chart-2)",
  oxxo: "var(--chart-7)",
  cash: "var(--chart-4)",
  breb: "var(--chart-2)",
  bank: "var(--declared)",
};
/** Chip style for a rail: its color as background and an icon ink that keeps 3:1 on it
 *  (cream on the dark chips, dark ink on the light teal/yellow chips and on every dark-mode chip). */
export function railChip(rail: Rail) {
  const light = rail === "pix" || rail === "oxxo";
  return {
    background: RAIL_COLOR[rail],
    color: light ? "var(--rail-ink-on-light)" : "var(--rail-ink)",
  };
}
export const RAIL_NAME: Record<Rail, string> = {
  paypal: "PayPal",
  card: "Tarjeta",
  applepay: "Apple Pay",
  googlepay: "Google Pay",
  pix: "Pix",
  spei: "SPEI",
  oxxo: "OXXO",
  cash: "Efectivo",
  breb: "Bre-B",
  bank: "Banco",
};
/** Rails whose name is a common word, not a brand: their label comes from the dictionary. */
const RAIL_KEY: Partial<Record<Rail, TKey>> = {
  card: "rail_card",
  cash: "rail_cash",
  bank: "rail_bank",
};
/** Rail label in the current language (brands stay as they are). */
export function railName(rail: Rail, t: (k: TKey) => string) {
  const k = RAIL_KEY[rail];
  return k ? t(k) : RAIL_NAME[rail];
}

export function RailIcon({ rail, size = 20 }: { rail: Rail; size?: number }) {
  const p = base(size);
  switch (rail) {
    case "paypal":
      return (
        <svg {...p}>
          <path d="M8 20 10 4h6a4 4 0 0 1 0 8h-4l-1 8" />
          <path d="M6 17 8 7" />
        </svg>
      );
    case "card":
      return (
        <svg {...p}>
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <path d="M2.5 10h19M6 15h3" />
        </svg>
      );
    case "applepay":
      return (
        <svg {...p}>
          <path d="M15.5 4c-1 .1-2.2.8-2.8 1.7-.5.7-1 1.9-.8 3 1.1.1 2.2-.6 2.9-1.5.6-.8 1-1.9.7-3.2Z" />
          <path d="M12 9c-1 0-2-.6-3-.6-2 0-4 1.7-4 5 0 3.6 2.5 7.6 4 7.6 1 0 1.5-.6 3-.6s1.8.6 3 .6c1.5 0 3-3 3.6-4.6-2-.9-2.6-4.4-.3-5.8-.8-1.2-2-1.6-3-1.6-1.2 0-2.3.6-3.3.6Z" />
        </svg>
      );
    case "googlepay":
      return (
        <svg {...p}>
          <path d="M20 12h-8v3h4.6a5 5 0 1 1-1.3-5.6l2.2-2.2A8 8 0 1 0 20 12Z" />
        </svg>
      );
    case "pix":
      return (
        <svg {...p}>
          <path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" />
          <path d="M7 12h10M12 7v10" />
        </svg>
      );
    case "spei":
      return (
        <svg {...p}>
          <path d="M3 10 12 4l9 6" />
          <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
        </svg>
      );
    case "oxxo":
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="8" cy="12" r="2.2" />
          <circle cx="16" cy="12" r="2.2" />
          <path d="M11 10l2 4M13 10l-2 4" />
        </svg>
      );
    case "cash":
      return (
        <svg {...p}>
          <rect x="2.5" y="6" width="19" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 9v.01M18 15v.01" />
        </svg>
      );
    case "breb":
      return (
        <svg {...p}>
          <path d="M4 7h11l-3-3M20 17H9l3 3" />
          <circle cx="18" cy="7" r="1.5" />
          <circle cx="6" cy="17" r="1.5" />
        </svg>
      );
    case "bank":
      return (
        <svg {...p}>
          <path d="M3 9 12 4l9 5" />
          <path d="M5 9v8M19 9v8M3 19h18" />
          <rect x="9" y="11" width="6" height="5" rx="1" />
        </svg>
      );
  }
}

export function itemIcon(name: string) {
  const n = name.toLowerCase();
  if (/(agua|horchata|refresco|suco|água|coco)/.test(n)) return Icon.cup;
  if (/(açaí|acai|bowl)/.test(n)) return Icon.bowl;
  return Icon.taco;
}

export function EmptyIllustration() {
  return (
    <svg
      width="140"
      height="100"
      viewBox="0 0 140 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
      className="text-muted-foreground"
    >
      <rect x="30" y="30" width="80" height="55" rx="8" />
      <path d="M30 45h80" />
      <path d="M45 30l8-14h34l8 14" />
      <circle cx="70" cy="64" r="9" strokeDasharray="3 3" />
      <path d="M15 85h110" opacity=".4" />
    </svg>
  );
}
