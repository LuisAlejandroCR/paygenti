// web/src/sticker.tsx: "Grabar sticker" panel — writes PUBLIC_URL/t/:terminal to an NTAG with
// Web NFC (NDEFReader, Chrome Android); without Web NFC shows the URL and a printable QR.
import { useState } from "preact/hooks";

interface NdefWriter {
  write(message: { records: { recordType: string; data: string }[] }): Promise<void>;
}
type NdefCtor = new () => NdefWriter;
type Status = "idle" | "waiting" | "done" | "error";

export function StickerPanel({ terminal, url }: { terminal: string; url: string }) {
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
    <section class="sticker" aria-label="Grabar sticker">
      <h2>Sticker del puesto</h2>
      <p class="sticker-url">{url}</p>
      {Reader ? (
        <>
          <button type="button" class="primary" disabled={status === "waiting"} onClick={write}>
            {status === "waiting" ? "Acerca el sticker al teléfono…" : "Grabar sticker NFC"}
          </button>
          {status === "done" && <p class="ok-msg">Sticker grabado. Pruébalo con otro teléfono.</p>}
          {status === "error" && (
            <p class="error">
              No se pudo grabar. Revisa que el NFC esté activo e intenta de nuevo.
            </p>
          )}
        </>
      ) : (
        <p class="hint">
          Este navegador no puede grabar NFC (usa Chrome en Android). Imprime este QR y pégalo en el
          puesto.
        </p>
      )}
      <img
        class="qr"
        src={`/api/terminals/${terminal}/qr.svg`}
        alt={`Código QR del puesto ${terminal} para imprimir`}
      />
      <button type="button" class="secondary" onClick={() => window.print()}>
        Imprimir QR
      </button>
    </section>
  );
}
