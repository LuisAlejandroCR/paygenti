// web/src/lang-toggle.tsx: the visible EN/ES switch shown in every page header.
// Flips the global locale in i18n.ts, which persists it and updates <html lang>.
import { setLocale, useT } from "./i18n";

export function LangToggle() {
  const { t, locale } = useT();
  const next = locale === "es" ? "en" : "es";
  return (
    <button
      type="button"
      class="lang-toggle"
      aria-label={t("app.langToggle")}
      onClick={() => setLocale(next)}
    >
      <span aria-current={locale === "en"}>EN</span>
      {" / "}
      <span aria-current={locale === "es"}>ES</span>
    </button>
  );
}
