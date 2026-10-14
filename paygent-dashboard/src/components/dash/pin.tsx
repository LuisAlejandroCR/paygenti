// pin.tsx: stall PIN keypad dialog; usePin() resolves with the PIN (null if cancelled) so money
// flows can forward it to the server, which re-checks it. Live mode verifies via POST /session.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePrefs, haptic } from "@/lib/prefs";
import { SANDBOX, checkPin } from "@/lib/api";
import type { PinOutcome } from "@/lib/adapter";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Req = (title: string) => Promise<string | null>;
const Ctx = createContext<Req>(async () => null);
export const usePin = () => useContext(Ctx);

export function PinProvider({ children }: { children: ReactNode }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<Exclude<PinOutcome, "ok"> | null>(null);
  const resolver = useRef<(v: string | null) => void>(() => {});
  // Refs, not state: fast typing fires several keydowns before React re-renders.
  const cur = useRef("");
  const busy = useRef(false);

  const request = useCallback<Req>((ttl) => {
    setTitle(ttl);
    cur.current = "";
    setPin("");
    setErr(null);
    setOpen(true);
    return new Promise((res) => {
      resolver.current = res;
    });
  }, []);

  const close = (v: string | null) => {
    setOpen(false);
    resolver.current(v);
  };
  const press = (d: string) => {
    haptic();
    if (busy.current) return;
    if (d === "del") {
      cur.current = cur.current.slice(0, -1);
      setPin(cur.current);
      setErr(null);
      return;
    }
    const next = (cur.current + d).slice(0, 4);
    cur.current = next;
    setPin(next);
    if (next.length === 4) {
      busy.current = true;
      void checkPin(next).then((r) => {
        busy.current = false;
        if (r === "ok") setTimeout(() => close(next), 150);
        else {
          setErr(r);
          cur.current = "";
          setTimeout(() => setPin(""), 400);
        }
      });
    }
  };

  return (
    <Ctx.Provider value={request}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && close(null)}>
        <DialogContent
          className="max-w-xs rounded-3xl"
          onKeyDown={(e) => {
            if (/^\d$/.test(e.key)) press(e.key);
            if (e.key === "Backspace") press("del");
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Icon.lock />
            </div>
            <DialogTitle className="text-center text-base">{t("pin_title")}</DialogTitle>
            <DialogDescription className="text-center text-sm">{title}</DialogDescription>
            <div
              className={cn("flex gap-3", err && "animate-pulse")}
              role="img"
              aria-label={`${pin.length}/4`}
            >
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "size-3.5 rounded-full border-2",
                    err
                      ? "border-destructive bg-destructive"
                      : i < pin.length
                        ? "border-primary bg-primary"
                        : "border-border",
                  )}
                />
              ))}
            </div>
            <p
              role={err ? "alert" : undefined}
              className={cn(
                "min-h-8 text-center text-xs",
                err ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
            >
              {err === "wrong"
                ? t("pin_wrong")
                : err === "locked"
                  ? t("pin_locked")
                  : err === "offline"
                    ? t("pin_offline")
                    : SANDBOX
                      ? t("pin_hint")
                      : t("pin_live")}
            </p>
            <div className="grid w-full grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) =>
                k === "" ? (
                  <span key="blank" />
                ) : (
                  <button
                    key={k}
                    onClick={() => press(k)}
                    aria-label={k === "del" ? t("del_digit") : k}
                    className="pressable flex h-14 items-center justify-center rounded-2xl bg-muted text-xl font-semibold num"
                  >
                    {k === "del" ? <Icon.backspace /> : k}
                  </button>
                ),
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
