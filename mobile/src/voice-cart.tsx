// src/voice-cart.tsx: push-to-talk + typed order -> cart. Hold the mic (expo-speech-recognition,
// device locale), release to send the transcript to POST /api/voice/parse; typed text uses the same
// endpoint. Shows the cart lines with the shared money formatter.
import type { CartLine } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useApp } from "./app-state";
import { buzzError, tick } from "./lib/announce";
import { speechLang } from "./lib/i18n";
import { formatMoney, money } from "./lib/money";
import { FONTS } from "./lib/theme";
import { Body, Button, Card, Field, Message } from "./ui";

type Speech = typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule;

/** The native recognizer, or undefined when this build or platform lacks it (lazy require). */
function speechModule(): Speech | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy native module
    return (require("expo-speech-recognition") as typeof import("expo-speech-recognition"))
      .ExpoSpeechRecognitionModule;
  } catch {
    return undefined;
  }
}

export function mergeLines(cart: CartLine[], add: CartLine[]): CartLine[] {
  const next = cart.map((l) => ({ ...l }));
  for (const line of add) {
    const same = next.find((l) => l.sku === line.sku);
    if (same) same.qty += line.qty;
    else next.push({ ...line });
  }
  return next;
}

export function VoiceCart({
  vendorId,
  cart,
  onCart,
}: {
  vendorId: string;
  cart: CartLine[];
  onCart: (cart: CartLine[]) => void;
}) {
  const { api, t, locale, colors } = useApp();
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const transcript = useRef("");

  const parseRef = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    parseRef.current = (text) => void parse(text);
  });

  useEffect(() => {
    const speech = speechModule();
    if (!speech) return;
    const subs = [
      speech.addListener("result", (e) => {
        transcript.current = e.results[0]?.transcript ?? transcript.current;
      }),
      speech.addListener("end", () => {
        setListening(false);
        const text = transcript.current.trim();
        transcript.current = "";
        if (text) parseRef.current(text);
      }),
      speech.addListener("error", (e) => {
        setListening(false);
        if (e.error !== "aborted" && e.error !== "no-speech") setError(t("sale.parseFailed"));
      }),
    ];
    return () => subs.forEach((s) => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startListening() {
    setError("");
    const speech = speechModule();
    try {
      if (!speech || !speech.isRecognitionAvailable()) {
        setError(t("sale.micUnavailable"));
        return;
      }
      const perm = await speech.requestPermissionsAsync();
      if (!perm.granted) {
        setError(t("sale.micDenied"));
        return;
      }
      tick();
      transcript.current = "";
      speech.start({ lang: speechLang(locale), interimResults: true });
      setListening(true);
    } catch {
      setError(t("sale.micUnavailable"));
    }
  }

  function stopListening() {
    if (listening) speechModule()?.stop();
  }

  async function parse(text: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api.parseVoice(text, vendorId);
      if (r.lines.length > 0) onCart(mergeLines(cart, r.lines));
      if (r.unmatched.length > 0) setError(t("sale.unmatched", { items: r.unmatched.join(", ") }));
      else if (r.lines.length === 0) setError(t("sale.parseFailed"));
      setTyped("");
    } catch {
      buzzError();
      setError(t("sale.parseFailed"));
    } finally {
      setBusy(false);
    }
  }

  const total =
    cart.length > 0
      ? money(
          cart.reduce((n, l) => n + l.unitPrice.minor * l.qty, 0),
          cart[0]?.unitPrice.currency ?? "MXN",
        )
      : undefined;

  return (
    <View style={{ gap: 12 }}>
      <Button
        label={listening ? t("sale.listening") : t("sale.holdToTalk")}
        onPressIn={startListening}
        onPressOut={stopListening}
        busy={busy}
        style={{ minHeight: 88 }}
      />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("sale.add")}
            value={typed}
            onChangeText={setTyped}
            placeholder={t("sale.typePlaceholder")}
            returnKeyType="send"
            onSubmitEditing={() => typed.trim() && parse(typed.trim())}
          />
        </View>
        <Button
          label={t("sale.add")}
          variant="secondary"
          disabled={!typed.trim() || busy}
          onPress={() => parse(typed.trim())}
        />
      </View>
      <Message text={error} />
      {cart.length > 0 && total && (
        <Card>
          <Text style={[styles.head, { color: colors.foreground }]}>{t("sale.cart")}</Text>
          {cart.map((l) => (
            <View key={l.sku} style={styles.line}>
              <Body style={{ flex: 1 }}>
                {l.qty} × {l.names?.[locale] ?? l.name}
              </Body>
              <Body>{formatMoney(money(l.unitPrice.minor * l.qty, l.unitPrice.currency))}</Body>
            </View>
          ))}
          <View style={styles.line}>
            <Text style={[styles.head, { color: colors.foreground, flex: 1 }]}>
              {formatMoney(total)}
            </Text>
            <Button label={t("sale.clear")} variant="ghost" onPress={() => onCart([])} />
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { fontFamily: FONTS.display, fontSize: 20 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
});
