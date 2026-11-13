// prefs-lang.test.tsx: the dashboard language follows the landing (localStorage "paygent.locale")
// on a first visit, falls back to the browser language, and writes es/en back so the landing follows.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrefsProvider, SHARED_LOCALE_KEY, usePrefs } from "@/lib/prefs";

function Probe() {
  const p = usePrefs();
  return (
    <>
      <p data-testid="lang">{p.lang}</p>
      <button onClick={() => p.set({ lang: "en" })}>en</button>
      <button onClick={() => p.set({ lang: "pt" })}>pt</button>
    </>
  );
}
const lang = () => screen.getByTestId("lang").textContent;

describe("dashboard language", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("first visit reads the landing's choice", () => {
    localStorage.setItem(SHARED_LOCALE_KEY, "en");
    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>,
    );
    expect(lang()).toBe("en");
  });

  it("without a landing choice it follows the browser language", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>,
    );
    expect(lang()).toBe("en");
  });

  it("saved dashboard prefs win over the landing", () => {
    localStorage.setItem("paygent-prefs", JSON.stringify({ lang: "pt" }));
    localStorage.setItem(SHARED_LOCALE_KEY, "en");
    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>,
    );
    expect(lang()).toBe("pt");
  });

  it("switching to en writes the shared key; pt leaves it alone", () => {
    localStorage.setItem(SHARED_LOCALE_KEY, "es");
    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>,
    );
    act(() => screen.getByText("en").click());
    expect(localStorage.getItem(SHARED_LOCALE_KEY)).toBe("en");
    act(() => screen.getByText("pt").click());
    expect(lang()).toBe("pt");
    expect(localStorage.getItem(SHARED_LOCALE_KEY)).toBe("en");
  });
});
