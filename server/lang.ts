// server/lang.ts: picks the response language (en | es) from Accept-Language for server-rendered
// text (/t/:terminal pages, the back-office agent's fallback summary). English unless es outranks it.

export type Lang = "en" | "es";

/** English by default; Spanish when it outranks English in Accept-Language. */
export function pickLang(header: string | undefined): Lang {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().toLowerCase().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((x) => x.tag.startsWith("es") || x.tag.startsWith("en"))
    .sort((x, y) => y.q - x.q);
  return ranked[0]?.tag.startsWith("es") ? "es" : "en";
}
