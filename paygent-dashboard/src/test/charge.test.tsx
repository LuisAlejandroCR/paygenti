// charge.test.tsx: the Cobrar sheet in live mode creates a real sale on the stall's terminal and
// shows "paid" only once the server reports the PayPal capture; a push-rail sale stays pending.
// Also covers the pure helpers of the UX pass: chargeState, pinOutcome, formatMoney, mapStall.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chargeState, mapStall, pinOutcome } from "@/lib/adapter";
import { DICTS } from "@/lib/i18n";
import { formatMoney, PrefsProvider } from "@/lib/prefs";
import { DashCtx, type Dash } from "@/components/dash/context";

const api = vi.hoisted(() => ({
  createCharge: vi.fn(),
  chargeStatus: vi.fn(),
  cancelCharge: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  LIVE: true,
  SANDBOX: false,
  ...api,
}));

const { Overlays } = await import("@/components/dash/Overlays");
const es = DICTS.es;

function renderCharge(terminals?: string[]) {
  const stall = { id: "rosa", name: "Rosa", currency: "MXN", rails: [], terminals };
  const dash: Dash = {
    search: { tab: "resumen", month: "2026-10", stall: "rosa" },
    stall,
    stalls: [stall],
    txs: [],
    allTxs: [],
    nav: () => {},
    open: () => {},
  };
  render(
    <PrefsProvider>
      <QueryClientProvider client={new QueryClient()}>
        <DashCtx.Provider value={dash}>
          <Overlays overlay={{ kind: "flow", flow: "cobrar" }} close={() => {}} />
        </DashCtx.Provider>
      </QueryClientProvider>
    </PrefsProvider>,
  );
}
async function typeAmountAndGo() {
  fireEvent.click(screen.getByRole("button", { name: "8" }));
  fireEvent.click(screen.getByRole("button", { name: "5" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: es.next }));
  });
}

describe("live charge sheet", () => {
  beforeEach(() => {
    // These checks read the Spanish copy; jsdom reports an English browser language.
    localStorage.setItem("paygent.locale", "es");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.createCharge.mockResolvedValue({
      saleId: "s1",
      payUrl: "http://localhost:8787/t/term-1",
      qrUrl: "/api/terminals/term-1/qr.svg",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("creates the sale on the terminal and never shows paid on a timer", async () => {
    api.chargeStatus.mockResolvedValue("waiting");
    renderCharge(["term-1"]);
    expect(screen.queryByText(es.sim_note)).not.toBeInTheDocument();
    await typeAmountAndGo();
    expect(api.createCharge).toHaveBeenCalledWith("term-1", 85, "MXN");
    expect(screen.getByText("http://localhost:8787/t/term-1")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.chargeStatus).toHaveBeenCalledWith("s1");
    expect(screen.queryByText(es.paid)).not.toBeInTheDocument();
    expect(screen.getByText(es.waiting)).toBeInTheDocument();
  });

  it("shows paid only after the server reports the capture", async () => {
    api.chargeStatus.mockResolvedValueOnce("waiting").mockResolvedValue("paid");
    renderCharge(["term-1"]);
    await typeAmountAndGo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(screen.queryByText(es.paid)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(screen.getByText(es.paid)).toBeInTheDocument();
  });

  it("a push-rail sale stays pending, never paid", async () => {
    api.chargeStatus.mockResolvedValue("pending_bank");
    renderCharge(["term-1"]);
    await typeAmountAndGo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(screen.getByText(es.pending_bank)).toBeInTheDocument();
    expect(screen.queryByText(es.paid)).not.toBeInTheDocument();
  });

  it("without a terminal it says the charge could not be created", async () => {
    renderCharge(undefined);
    await typeAmountAndGo();
    expect(api.createCharge).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(es.charge_error);
  });
});

describe("ux pass helpers", () => {
  it("chargeState: only a capture is paid", () => {
    expect(chargeState("paid")).toBe("paid");
    expect(chargeState("open")).toBe("waiting");
    expect(chargeState("approved")).toBe("waiting");
    expect(chargeState("pending_bank")).toBe("pending_bank");
    expect(chargeState("vendor_confirmed")).toBe("self_declared");
    expect(chargeState("expired")).toBe("expired");
    expect(chargeState("failed")).toBe("failed");
  });
  it("pinOutcome tells wrong, locked and offline apart", () => {
    expect(pinOutcome(200)).toBe("ok");
    expect(pinOutcome(401, "PIN_INVALID")).toBe("wrong");
    expect(pinOutcome(429, "PIN_LOCKED")).toBe("locked");
    expect(pinOutcome(0)).toBe("offline");
    expect(pinOutcome(502)).toBe("offline");
  });
  it("formatMoney puts the sign before the prefix", () => {
    expect(formatMoney(-170, "MXN", "es-MX", { compact: true })).toBe("−MX$170");
    expect(formatMoney(95.5, "MXN", "es-MX")).toBe("MX$95.50");
    expect(formatMoney(-0.001, "MXN", "es-MX")).toBe("MX$0.00");
    expect(formatMoney(5, "MXN", "es-MX", { privacy: true })).toBe("MX$ •••••");
  });
  it("mapStall keeps the terminals a live charge needs", () => {
    const s = mapStall({ id: "rosa", displayName: "Rosa", currency: "MXN", terminals: ["t1"] });
    expect(s.terminals).toEqual(["t1"]);
  });
});
