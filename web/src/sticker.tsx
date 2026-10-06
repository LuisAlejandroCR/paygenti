// web/src/sticker.tsx: "Grabar sticker" panel — writes PUBLIC_URL/t/:terminal to an NTAG with
// Web NFC (NDEFReader, Chrome Android); without Web NFC shows the URL and a printable QR.
import { useState } from "preact/hooks";
import { useT } from "./i18n";

interface NdefWriter {
  write(message: { records: { recordType: string; data: string }[] }): Promise<void>;
}
type NdefCtor = new () => NdefWriter;
type Status = "idle" | "waiting" | "done" | "error";

export function StickerPanel({ terminal, url }: { terminal: string; url: string }) {
  const { t } = useT();
  const Reader = (globalThis as { NDEFReader?: NdefCtor }).NDEFReader;
  const [status, setStatus] = useState<Status>("idle");

  async function write() {
    if (!Reader) return;
    setStatus("waiting");
    try {
      await new Reader().write({ records: [{ recordType: "url", data: url }] });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section class="sticker" aria-label={t("sticker.label")}>
      <h2>{t("sticker.title")}</h2>
      <p class="sticker-url">{url}</p>
      {Reader ? (
        <>
          <button type="button" class="primary" disabled={status === "waiting"} onClick={write}>
            {status === "waiting" ? t("sticker.approach") : t("sticker.write")}
          </button>
          {status === "done" && <p class="ok-msg">{t("sticker.done")}</p>}
          {status === "error" && <p class="error">{t("sticker.error")}</p>}
        </>
      ) : (
        <p class="hint">{t("sticker.noNfc")}</p>
      )}
      <img
        class="qr"
        src={`/api/terminals/${terminal}/qr.svg`}
        alt={t("sticker.qrAlt", { terminal })}
      />
      <button type="button" class="secondary" onClick={() => window.print()}>
        {t("sticker.print")}
      </button>
    </section>
  );
}
