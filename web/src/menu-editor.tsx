// web/src/menu-editor.tsx: back-office "Menu" panel — take or upload a menu photo (downscaled on
// the device), review the items Claude proposes in an editable table, or type them by hand, then
// save. Nothing is saved until the vendor taps Save; the server validates and assigns SKUs.

import { useEffect, useState } from "preact/hooks";
import { type Currency, money, parseAmount, toPayPalValue } from "../../shared/money";
import { useT } from "./i18n";

interface Row {
  en: string;
  es: string;
  price: string;
  aliases: string;
}
interface ServerItem {
  names?: { en: string; es: string };
  name: string;
  price: { minor: number };
  aliases: string[];
}
interface Proposed {
  names: { en: string; es: string };
  price: number;
  aliases: { en: string[]; es: string[] };
}

const MAX_SIDE = 1600;
const empty = (): Row => ({ en: "", es: "", price: "", aliases: "" });

/** Re-encodes the photo as JPEG with its longest side at most 1600 px. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
  );
}

export function MenuEditor({ token, onAuthLost }: { token: string; onAuthLost: () => void }) {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [currency, setCurrency] = useState<Currency>("MXN");
  const major = (minor: number, c: Currency = currency) => toPayPalValue(money(minor, c));
  const toMinor = (text: string) => parseAmount(text, currency, 7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const auth = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetch("/api/backoffice/catalog", { headers: auth })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { items: ServerItem[]; currency?: Currency }) => {
        const c = d.currency ?? "MXN";
        setCurrency(c);
        setRows(
          d.items.map((i) => ({
            en: i.names?.en ?? i.name,
            es: i.names?.es ?? i.name,
            price: major(i.price.minor, c),
            aliases: i.aliases.join(", "),
          })),
        );
      })
      .catch(() => setRows([empty()]));
  }, [token]);

  const edit = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function onPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setMsg({ text: t("menu.reading"), error: false });
    try {
      const form = new FormData();
      form.append("image", await downscale(file), "menu.jpg");
      const res = await fetch("/api/backoffice/catalog/extract", {
        method: "POST",
        headers: auth,
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { items?: Proposed[]; error?: string };
      if (res.status === 401) onAuthLost();
      if (res.status === 503) return setMsg({ text: t("menu.noVision"), error: true });
      if (!res.ok || !data.items?.length)
        return setMsg({ text: t("menu.photoFailed"), error: true });
      setRows(
        data.items.map((p) => ({
          en: p.names.en,
          es: p.names.es,
          price: major(p.price),
          aliases: [...p.aliases.en, ...p.aliases.es].join(", "),
        })),
      );
      setMsg({ text: t("menu.proposed"), error: false });
    } catch {
      setMsg({ text: t("menu.photoFailed"), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function save(e: Event) {
    e.preventDefault();
    const items = rows.map((r) => ({
      names: { en: r.en.trim(), es: r.es.trim() || r.en.trim() },
      price: toMinor(r.price) ?? 0,
      aliases: r.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    }));
    if (items.length === 0 || items.some((i) => !i.names.en || i.price <= 0))
      return setMsg({ text: t("menu.invalid"), error: true });
    const res = await fetch("/api/backoffice/catalog", {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).catch(() => undefined);
    if (res?.status === 401) onAuthLost();
    if (!res?.ok) return setMsg({ text: t("menu.invalid"), error: true });
    setMsg({ text: t("menu.saved", { count: items.length }), error: false });
  }

  return (
    <form class="panel menu-panel" onSubmit={save}>
      <h2>{t("menu.title")}</h2>
      <label class="menu-photo">
        {t("menu.photo")}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={onPhoto}
        />
      </label>
      {msg && (
        <p class={msg.error ? "error" : "hint"} role={msg.error ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
      <table class="menu-table">
        <thead>
          <tr>
            <th>{t("menu.nameEn")}</th>
            <th>{t("menu.nameEs")}</th>
            <th>{t("menu.price")}</th>
            <th>{t("menu.aliases")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  aria-label={t("menu.nameEn")}
                  value={r.en}
                  maxLength={60}
                  onInput={(e) => edit(i, { en: e.currentTarget.value })}
                />
              </td>
              <td>
                <input
                  aria-label={t("menu.nameEs")}
                  value={r.es}
                  maxLength={60}
                  onInput={(e) => edit(i, { es: e.currentTarget.value })}
                />
              </td>
              <td>
                <input
                  aria-label={t("menu.price")}
                  inputMode="decimal"
                  value={r.price}
                  onInput={(e) => edit(i, { price: e.currentTarget.value })}
                />
              </td>
              <td>
                <input
                  aria-label={t("menu.aliases")}
                  value={r.aliases}
                  onInput={(e) => edit(i, { aliases: e.currentTarget.value })}
                />
              </td>
              <td>
                <button
                  type="button"
                  class="secondary"
                  aria-label={t("menu.remove", { n: i + 1 })}
                  onClick={() => setRows(rows.filter((_, k) => k !== i))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" class="secondary" onClick={() => setRows([...rows, empty()])}>
        {t("menu.add")}
      </button>
      <button type="submit" class="primary" disabled={busy}>
        {t("menu.save")}
      </button>
    </form>
  );
}
