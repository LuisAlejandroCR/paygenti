// app/nfc.tsx: NFC tools — writes PUBLIC_URL/t/:terminal (from GET /api/config) to an NTAG sticker
// on iOS and Android, and on Android starts phone-to-phone tap (HCE Type 4 tag with the same URL).
// On iOS it says plainly that Apple does not allow tag emulation and points to sticker/QR instead.
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useApp } from "@/app-state";
import { buzzError } from "@/lib/announce";
import {
  canEmulateTag,
  cancelSticker,
  type NfcState,
  nfcState,
  StickerTooSmall,
  startTap,
  writeSticker,
} from "@/lib/nfc";
import { terminalPayUrl } from "@/lib/nfc-url";
import { Body, Button, Card, Message, Screen, Title } from "@/ui";

export default function NfcScreen() {
  const { api, terminal, t } = useApp();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<NfcState>();
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" }>({ text: "", tone: "ok" });
  const [writing, setWriting] = useState(false);
  const [tapOn, setTapOn] = useState(false);
  const stopTap = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    api
      .config()
      .then((c) => setUrl(terminalPayUrl(c.publicUrl, terminal)))
      .catch(() => setMsg({ text: t("sale.terminalNotFound"), tone: "error" }));
    nfcState().then(setState);
    return () => {
      void cancelSticker();
      void stopTap.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, terminal]);

  async function write() {
    setWriting(true);
    setMsg({ text: t("nfc.writing"), tone: "ok" });
    try {
      await writeSticker(url, t("nfc.stickerHint"));
      setMsg({ text: t("nfc.written"), tone: "ok" });
    } catch (err) {
      buzzError();
      setMsg({
        text:
          err instanceof StickerTooSmall
            ? t("nfc.tooBig")
            : t("nfc.writeFailed", { reason: (err as Error)?.message ?? "?" }),
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function toggleTap() {
    if (tapOn) {
      await stopTap.current?.();
      stopTap.current = undefined;
      setTapOn(false);
      setMsg({ text: "", tone: "ok" });
      return;
    }
    try {
      stopTap.current = await startTap(url, () =>
        setMsg({ text: t("nfc.tapRead"), tone: "ok" }),
      );
      setTapOn(true);
      setMsg({ text: t("nfc.tapOn"), tone: "ok" });
    } catch (err) {
      setMsg({ text: t("nfc.tapFailed", { reason: (err as Error)?.message ?? "?" }), tone: "error" });
    }
  }

  const ready = state === "ready" && url !== "";

  return (
    <Screen>
      <Card>
        <Title>{t("nfc.url")}</Title>
        <Body>{url || "…"}</Body>
        {url !== "" && (
          <View style={{ alignSelf: "center", padding: 12, backgroundColor: "#FFFFFF" }}>
            <QRCode value={url} size={180} ecl="M" />
          </View>
        )}
      </Card>

      {state === "unsupported" && <Message text={t("nfc.unsupported")} />}
      {state === "disabled" && <Message text={t("nfc.disabled")} />}

      <Card>
        <Title>{t("nfc.sticker")}</Title>
        <Body muted>{t("nfc.stickerHint")}</Body>
        <Button label={t("nfc.sticker")} disabled={!ready} busy={writing} onPress={write} />
      </Card>

      <Card>
        <Title>{t("nfc.tap")}</Title>
        {canEmulateTag ? (
          <>
            <Body muted>{t("nfc.tapHint")}</Body>
            <Button
              label={tapOn ? t("nfc.tapStop") : t("nfc.tapStart")}
              variant={tapOn ? "secondary" : "action"}
              disabled={!ready}
              onPress={toggleTap}
            />
          </>
        ) : (
          <Body>{Platform.OS === "ios" ? t("nfc.iosNoHce") : t("nfc.unsupported")}</Body>
        )}
      </Card>

      <Message text={msg.text} tone={msg.tone} />
    </Screen>
  );
}
