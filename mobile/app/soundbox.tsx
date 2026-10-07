// app/soundbox.tsx: kiosk/soundbox mode — keeps the screen awake (expo-keep-awake), follows the
// terminal's SSE feed and shows one big state; each paid sale is announced (haptic + speech) once,
// even across reconnects, because the feed dedupes replayed events.
import type { TerminalEvent } from "@shared/types";
import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useApp } from "@/app-state";
import { announcePaid } from "@/lib/announce";
import { type FeedView, viewFor } from "@/lib/feed";
import { formatMoney } from "@/lib/money";
import { connectTerminal } from "@/lib/terminal-stream";
import { FONTS } from "@/lib/theme";
import { PaidFlood } from "@/paid-flood";
import { Body, Screen, TopBar } from "@/ui";

export default function SoundboxScreen() {
  useKeepAwake();
  const { serverUrl, terminal, t, locale, colors } = useApp();
  const [view, setView] = useState<FeedView>({ kind: "idle" });
  const [online, setOnline] = useState(false);
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    const onEvent = (e: TerminalEvent) => {
      setView(viewFor(e));
      if (e.type === "sale.paid") announcePaid(e.sale.total, localeRef.current);
    };
    return connectTerminal(serverUrl, terminal, { onEvent, onStatus: setOnline });
  }, [serverUrl, terminal]);

  if (view.kind === "paid")
    return (
      <Screen scroll={false}>
        <PaidFlood word={t("sale.paid")} amount={formatMoney(view.sale.total)} />
      </Screen>
    );

  const label =
    view.kind === "idle"
      ? t("sound.idle")
      : view.kind === "open"
        ? t("sound.open", { amount: formatMoney(view.sale.total) })
        : t(`sound.${view.kind}`);
  const color =
    view.kind === "open"
      ? colors.paypal
      : view.kind === "failed"
        ? colors.destructive
        : colors.foreground;

  return (
    <Screen scroll={false}>
      <TopBar title={terminal} online={online} />
      <View style={styles.center}>
        <Text accessibilityLiveRegion="polite" style={[styles.big, { color }]}>
          {label}
        </Text>
      </View>
      <Body muted style={{ textAlign: "center" }}>
        {t("sound.keepAwake")}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  big: { fontFamily: FONTS.display, fontSize: 44, textAlign: "center" },
});
