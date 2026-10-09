// mock.ts: seeded demo data (two stalls, ~5 months of sales, rails, goals, notices) used when
// VITE_PAYGENT_API is unset; live mode only borrows TODAY from here.
import type { Goal, Notification, RailInfo, Rail, Stall, Tx, TxStatus } from "./types";

// Seeded fake data — swapped for real /api/* endpoints in api.ts.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export const TODAY = import.meta.env["VITE_PAYGENT_API"] ? new Date() : new Date(2026, 9, 7, 12, 0);

export const STALLS: Stall[] = [
  {
    id: "lupe",
    name: "Tacos Doña Lupe",
    currency: "MXN",
    rails: ["paypal", "card", "applepay", "googlepay", "spei", "oxxo"],
  },
  {
    id: "acai",
    name: "Açaí da Praia",
    currency: "BRL",
    rails: ["paypal", "card", "applepay", "googlepay", "pix"],
  },
];

const ITEMS: Record<string, { name: string; price: number }[]> = {
  lupe: [
    { name: "Tacos al pastor", price: 85 },
    { name: "Quesadilla", price: 60 },
    { name: "Agua de horchata", price: 35 },
    { name: "Gringa", price: 95 },
    { name: "Orden de suadero", price: 90 },
    { name: "Refresco", price: 30 },
  ],
  acai: [
    { name: "Açaí 500ml", price: 28 },
    { name: "Açaí 300ml", price: 18 },
    { name: "Suco de laranja", price: 12 },
    { name: "Tapioca", price: 15 },
    { name: "Água de coco", price: 10 },
  ],
};

const SELF_RAILS: Rail[] = ["pix", "spei"];

function gen(): Tx[] {
  const out: Tx[] = [];
  for (const stall of STALLS) {
    const r = rng(stall.id === "lupe" ? 7 : 42);
    const start = new Date(2026, 4, 1);
    let n = 0;
    for (let d = new Date(start); d <= TODAY; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      const growth = 1 + (d.getMonth() - 4) * 0.06;
      const count = Math.round((6 + r() * 8 + (dow === 0 || dow === 6 ? 6 : 0)) * growth);
      for (let i = 0; i < count; i++) {
        const hour = Math.min(
          22,
          Math.max(7, Math.round(13 + (r() - 0.5) * 10 + (r() > 0.6 ? 6 : 0))),
        );
        const date = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          hour,
          Math.floor(r() * 60),
        );
        if (date > TODAY) continue;
        const rail = stall.rails[Math.floor(Math.pow(r(), 1.3) * stall.rails.length)];
        const item = ITEMS[stall.id][Math.floor(r() * ITEMS[stall.id].length)];
        const qty = 1 + Math.floor(r() * 3);
        const usd = rail === "paypal" && r() > 0.85;
        const rate = stall.currency === "MXN" ? 18 : 5.2;
        let amount = item.price * qty;
        if (usd) amount = Math.round((amount / rate) * 100) / 100;
        const self = SELF_RAILS.includes(rail);
        const recent = TODAY.getTime() - date.getTime() < 3 * 86400000;
        let status: TxStatus = "COMPLETED";
        if (self && recent && r() > 0.55) status = "pending_bank";
        else if (r() > 0.985) status = "refunded";
        else if (!self && r() > 0.99) status = "denied";
        out.push({
          id: `${stall.id}-${n++}`,
          date: date.toISOString(),
          amount,
          currency: usd ? "USD" : stall.currency,
          rail,
          status,
          type: "venta",
          origin: self ? "autodeclarado" : "verificado",
          item: item.name,
          fee: self ? 0 : Math.round(amount * 0.035 * 100) / 100,
          stallId: stall.id,
        });
      }
    }
    // a couple of payouts and refunds
    out.push({
      id: `${stall.id}-p1`,
      date: new Date(2026, 8, 30, 18).toISOString(),
      amount: stall.currency === "MXN" ? 4200 : 980,
      currency: stall.currency,
      rail: "paypal",
      status: "COMPLETED",
      type: "payout",
      origin: "verificado",
      item: "Proveedor",
      fee: 0,
      stallId: stall.id,
    });
    out.push({
      id: `${stall.id}-r1`,
      date: new Date(2026, 9, 3, 14).toISOString(),
      amount: stall.currency === "MXN" ? 170 : 28,
      currency: stall.currency,
      rail: "card",
      status: "COMPLETED",
      type: "reembolso",
      origin: "verificado",
      item: ITEMS[stall.id][0].name,
      fee: 0,
      stallId: stall.id,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export const db = {
  txs: gen(),
  rails: {
    lupe: [
      {
        rail: "paypal",
        enabled: true,
        conversion: 92,
        avgConfirmMin: 0.2,
        trend: [4, 6, 5, 8, 7, 9, 11],
      },
      {
        rail: "card",
        enabled: true,
        conversion: 88,
        avgConfirmMin: 0.3,
        trend: [3, 4, 6, 5, 7, 6, 8],
      },
      {
        rail: "applepay",
        enabled: true,
        conversion: 95,
        avgConfirmMin: 0.1,
        trend: [1, 2, 2, 3, 4, 4, 5],
      },
      {
        rail: "googlepay",
        enabled: true,
        conversion: 94,
        avgConfirmMin: 0.1,
        trend: [2, 2, 3, 3, 3, 4, 4],
      },
      {
        rail: "spei",
        enabled: true,
        conversion: 71,
        avgConfirmMin: 38,
        trend: [5, 4, 6, 7, 5, 8, 7],
      },
      {
        rail: "oxxo",
        enabled: true,
        conversion: 64,
        avgConfirmMin: 240,
        trend: [2, 1, 2, 1, 3, 2, 2],
      },
      {
        rail: "pix",
        enabled: false,
        reason: "pix_mx",
        conversion: 0,
        avgConfirmMin: 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
      },
    ],
    acai: [
      {
        rail: "paypal",
        enabled: true,
        conversion: 90,
        avgConfirmMin: 0.2,
        trend: [3, 4, 4, 6, 5, 7, 8],
      },
      {
        rail: "card",
        enabled: true,
        conversion: 86,
        avgConfirmMin: 0.3,
        trend: [2, 3, 4, 3, 5, 5, 6],
      },
      {
        rail: "applepay",
        enabled: true,
        conversion: 96,
        avgConfirmMin: 0.1,
        trend: [1, 1, 2, 2, 3, 3, 4],
      },
      {
        rail: "googlepay",
        enabled: true,
        conversion: 93,
        avgConfirmMin: 0.1,
        trend: [1, 2, 2, 2, 3, 3, 3],
      },
      {
        rail: "pix",
        enabled: true,
        conversion: 89,
        avgConfirmMin: 2,
        trend: [8, 9, 11, 10, 12, 14, 15],
      },
      {
        rail: "spei",
        enabled: false,
        reason: "spei_br",
        conversion: 0,
        avgConfirmMin: 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
      },
      {
        rail: "oxxo",
        enabled: false,
        reason: "oxxo_br",
        conversion: 0,
        avgConfirmMin: 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
      },
    ],
  } as Record<string, RailInfo[]>,
  goals: {
    lupe: [
      {
        id: "g1",
        name: "Nuevo comal",
        target: 6000,
        saved: 4100,
        deadline: "2026-12-15",
        icon: "cart",
      },
      {
        id: "g2",
        name: "Fondo de lluvias",
        target: 10000,
        saved: 2600,
        deadline: "2027-06-01",
        icon: "umbrella",
      },
    ],
    acai: [
      {
        id: "g3",
        name: "Freezer novo",
        target: 3500,
        saved: 1900,
        deadline: "2026-12-20",
        icon: "cart",
      },
    ],
  } as Record<string, Goal[]>,
  notifications: [
    { id: "n1", text: "notif_spei", read: false, at: "2026-10-07T10:12:00" },
    { id: "n2", text: "notif_goal", read: false, at: "2026-10-06T19:40:00" },
    { id: "n3", text: "notif_payout", read: true, at: "2026-09-30T18:00:00" },
  ] as Notification[],
};
