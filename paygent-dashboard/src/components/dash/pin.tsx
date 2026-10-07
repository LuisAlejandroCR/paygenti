import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePrefs, haptic } from "@/lib/prefs";
import { verifyPin } from "@/lib/api";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Req = (title: string) => Promise<boolean>;
const Ctx = createContext<Req>(async () => false);
export const usePin = () => useContext(Ctx);

export function PinProvider({ children }: { children: ReactNode }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const resolver = useRef<(v: boolean) => void>(() => {});

  const request = useCallback<Req>((ttl) => {
    setTitle(ttl); setPin(""); setErr(false); setOpen(true);
    return new Promise((res) => { resolver.current = res; });
  }, []);

  const close = (ok: boolean) => { setOpen(false); resolver.current(ok); };
  const press = (d: string) => {
    haptic();
    if (d === "del") { setPin((p) => p.slice(0, -1)); setErr(false); return; }
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      if (verifyPin(next)) setTimeout(() => close(true), 150);
      else { setErr(true); setTimeout(() => setPin(""), 400); }
    }
  };

  return (
    <Ctx.Provider value={request}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
        <DialogContent className="max-w-xs rounded-3xl" onKeyDown={(e) => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === "Backspace") press("del"); }}>
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground"><Icon.lock /></div>
            <DialogTitle className="text-center text-base">{t("pin_title")}</DialogTitle>
            <DialogDescription className="text-center text-sm">{title}</DialogDescription>
            <div className={cn("flex gap-3", err && "animate-pulse")} aria-live="polite">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={cn("size-3.5 rounded-full border-2", err ? "border-destructive bg-destructive" : i < pin.length ? "border-primary bg-primary" : "border-border")} />
              ))}
            </div>
            <p className={cn("text-xs", err ? "text-destructive" : "text-muted-foreground")}>{err ? t("pin_wrong") : t("pin_hint")}</p>
            <div className="grid w-full grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) =>
                k === "" ? <span key="blank" /> : (
                  <button key={k} onClick={() => press(k)} aria-label={k === "del" ? "Borrar" : k}
                    className="pressable flex h-14 items-center justify-center rounded-2xl bg-muted text-xl font-semibold num">
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
