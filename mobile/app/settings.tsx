// app/settings.tsx: server URL (default https://paygent-rirl.onrender.com, editable for a local
// dev server on the LAN), terminal id, language toggle and a link to stall setup (onboarding).
import { Link } from "expo-router";
import { useState } from "react";
import { DEFAULT_SERVER_URL, useApp } from "@/app-state";
import { normalizeBaseUrl, TERMINAL_ID } from "@/lib/nfc-url";
import { FONTS } from "@/lib/theme";
import { Body, Button, Card, Field, Message, Screen } from "@/ui";

export default function SettingsScreen() {
  const { serverUrl, terminal, setServer, t, toggleLocale, colors } = useApp();
  const [url, setUrl] = useState(serverUrl);
  const [term, setTerm] = useState(terminal);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" }>({ text: "", tone: "ok" });

  async function save() {
    const base = normalizeBaseUrl(url);
    if (!base) return setMsg({ text: t("settings.invalidUrl"), tone: "error" });
    if (!TERMINAL_ID.test(term.trim()))
      return setMsg({ text: t("settings.invalidTerminal"), tone: "error" });
    await setServer(base, term.trim());
    setUrl(base);
    setMsg({ text: t("settings.saved"), tone: "ok" });
  }

  return (
    <Screen>
      <Card>
        <Field
          label={t("settings.server")}
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          inputMode="url"
        />
        <Body muted>{t("settings.serverHint")}</Body>
        <Field label={t("settings.terminal")} value={term} onChangeText={setTerm} />
        <Button label={t("settings.save")} onPress={save} />
        <Button
          label={t("settings.reset")}
          variant="ghost"
          onPress={() => setUrl(DEFAULT_SERVER_URL)}
        />
        <Message text={msg.text} tone={msg.tone} />
      </Card>
      <Button label={t("app.language")} variant="secondary" onPress={toggleLocale} />
      <Link
        href="/onboarding"
        style={{ color: colors.actionText, fontFamily: FONTS.bodyBold, fontSize: 16 }}
      >
        {t("settings.stall")}
      </Link>
    </Screen>
  );
}
