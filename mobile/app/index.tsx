// app/index.tsx: the vendor's sale screen — push-to-talk/typed cart, keypad, Charge -> QR of
// PUBLIC_URL/t/:terminal with countdown, live SSE status, PAID flood (haptics + spoken amount),
// cancel, and links to soundbox, NFC, back office and settings. Sends first-run vendors to onboarding.
// Every control has a label/role/hint and each state change is announced to VoiceOver/TalkBack.
import type { CartLine, Sale, TerminalEvent } from "@shared/types";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useApp } from "@/app-state";
import { announcePaid, buzzError, tick } from "@/lib/announce";
import { ApiError } from "@/lib/api";
import {
  type Currency,
  currencyInfo,
  decimalsOf,
  formatMoney,
  KEYS,
  press,
  toMinor,
} from "@/lib/money";
import { connectTerminal } from "@/lib/terminal-stream";
import { FONTS, RADIUS } from "@/lib/theme";
import { PaidFlood } from "@/paid-flood";
import { Body, Button, Card, Message, Screen, TopBar } from "@/ui";
import { VoiceCart } from "@/voice-cart";

type Phase = "entry" | "waiting" | "paid" | "failed" | "expired";

export default function SaleScreen() {
  const { api, serverUrl, terminal, t, locale, colors } = useApp();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("entry");
  const [sale, setSale] = useState<Sale>();
  const [stall, setStall] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [currency, setCurrency] = useState<Currency>("MXN");
  const [payUrl, setPayUrl] = useState("");
  const [reviewPrices, setReviewPrices] = useState(false);
  const [digits, setDigits] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [keypadOpen, setKeypadOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [left, setLeft] = useState(0);
  const saleRef = useRef<Sale | undefined>(undefined);
  useEffect(() => {
    saleRef.current = sale;
  }, [sale]);
  // Screen-reader announcement on every state change ("paid" is announced by PaidFlood).
  useEffect(() => {
    const s = saleRef.current;
    const amount = s ? formatMoney(s.total) : "";
    const text =
      phase === "waiting"
        ? t("say.waiting", { amount })
        : phase === "failed"
          ? t("say.failed", { amount })
          : phase === "expired"
            ? t("say.expired", { amount })
            : "";
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [phase, t]);
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const load = useCallback(() => {
    setError("");
    api
      .terminal(terminal)
      .then((d) => {
        if (d.vendor.onboarded === false) {
          router.push("/onboarding");
          return;
        }
        setStall(d.vendor.displayName);
        setVendorId(d.vendor.id);
        setCurrency(d.vendor.currency);
        setPayUrl(d.payUrl);
        setReviewPrices(!!d.vendor.pricesNeedReview);
        if (d.openSale && !saleRef.current) {
          setSale(d.openSale);
          setPhase("waiting");
        }
      })
      .catch(() => setError(t("sale.terminalNotFound")));
    // t changes with locale only; reloading on a language switch is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, terminal, router]);

  useFocusEffect(load);

  useEffect(() => {
    const onEvent = (e: TerminalEvent) => {
      if (e.sale.id !== saleRef.current?.id) return;
      if (e.type === "sale.paid") {
        setSale(e.sale);
        setPhase("paid");
        announcePaid(e.sale.total, localeRef.current);
      } else if (e.type === "sale.failed") {
        buzzError();
        setPhase("failed");
      } else if (e.type === "sale.expired") setPhase("expired");
      else if (e.type === "sale.cancelled") reset();
    };
    return connectTerminal(serverUrl, terminal, { onEvent, onStatus: setOnline });
  }, [serverUrl, terminal]);

  useEffect(() => {
    if (phase !== "waiting" || !sale) return;
    const update = () => {
      const ms = Date.parse(sale.expiresAt) - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) setPhase("expired");
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [phase, sale]);

  const amount = toMinor(digits, currency);
  const decimals = decimalsOf(currency);

  async function charge(fromCart: boolean) {
    if (busy || (fromCart ? cart.length === 0 : !amount)) return;
    setBusy(true);
    setError("");
    try {
      const { sale: created } = fromCart
        ? await api.createSaleFromCart(terminal, cart)
        : await api.createSale(terminal, amount?.minor ?? 0);
      setSale(created);
      setPhase("waiting");
    } catch {
      buzzError();
      setError(t("sale.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const current = saleRef.current;
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.cancelSale(current.id);
      reset();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (code === "SALE_ALREADY_PAID") {
        const { sale: paid } = await api.sale(current.id).catch(() => ({ sale: current }));
        setSale(paid);
        setPhase("paid");
        announcePaid(paid.total, localeRef.current);
      } else if (code === "SALE_NOT_OPEN" || code === "SALE_NOT_FOUND") reset();
      else setError(t("sale.cancelFailed"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDigits("");
    setCart([]);
    setSale(undefined);
    setPhase("entry");
  }

  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  if (phase === "paid" && sale)
    return (
      <Screen scroll={false}>
        <PaidFlood word={t("sale.paid")} amount={formatMoney(sale.total)}>
          <Button
            label={t("sale.newSale")}
            hint={t("a11y.newSaleHint")}
            variant="secondary"
            onPress={reset}
          />
        </PaidFlood>
      </Screen>
    );

  return (
    <Screen>
      <TopBar title={stall || "paygent"} online={online} />

      {phase === "entry" && vendorId !== "" && (
        <VoiceCart vendorId={vendorId} cart={cart} onCart={setCart} />
      )}
      {phase === "entry" && cart.length > 0 && (
        <Button
          label={t("sale.charge")}
          hint={t("a11y.chargeHint")}
          busy={busy}
          onPress={() => charge(true)}
          style={{ minHeight: 72 }}
        />
      )}

      {phase === "entry" && cart.length === 0 && (
        <Card>
          <Pressable
            onPress={() => setKeypadOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={keypadOpen ? t("sale.hideKeypad") : t("sale.keypad")}
            accessibilityHint={t("a11y.keypadHint")}
            accessibilityState={{ expanded: keypadOpen }}
          >
            <Text style={{ color: colors.actionText, fontFamily: FONTS.bodyBold }}>
              {keypadOpen ? t("sale.hideKeypad") : t("sale.keypad")}
            </Text>
          </Pressable>
          {keypadOpen && (
            <>
              <Text
                accessibilityLiveRegion="polite"
                accessibilityLabel={t("a11y.amount", {
                  amount: `${currencyInfo(currency).symbol}${digits || "0"}`,
                })}
                style={[styles.amount, { color: colors.foreground }]}
              >
                {currencyInfo(currency).symbol}
                {digits || "0"}
              </Text>
              <View style={styles.keypad}>
                {KEYS.map((k) => (
                  <Pressable
                    key={k}
                    accessibilityRole="button"
                    accessibilityLabel={k === "⌫" ? t("sale.delete") : k}
                    accessibilityHint={t("a11y.keyHint")}
                    accessibilityState={{ disabled: k === "." && decimals === 0 }}
                    disabled={k === "." && decimals === 0}
                    onPress={() => {
                      tick();
                      setDigits((d) => press(d, k, decimals));
                    }}
                    style={({ pressed }) => [
                      styles.key,
                      {
                        backgroundColor: pressed ? colors.muted : colors.background,
                        borderColor: colors.border,
                        opacity: k === "." && decimals === 0 ? 0.3 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.keyText, { color: colors.foreground }]}>{k}</Text>
                  </Pressable>
                ))}
              </View>
              <Button
                label={
                  busy
                    ? t("sale.creating")
                    : amount
                      ? t("sale.chargeAmount", { amount: formatMoney(amount) })
                      : t("sale.charge")
                }
                hint={t("a11y.chargeHint")}
                disabled={!amount}
                busy={busy}
                onPress={() => charge(false)}
              />
            </>
          )}
        </Card>
      )}

      {phase === "waiting" && sale && (
        <Card style={{ alignItems: "center" }}>
          <Body muted>{t("sale.show")}</Body>
          <Text style={[styles.total, { color: colors.foreground }]}>
            {formatMoney(sale.total)}
          </Text>
          {payUrl !== "" && (
            <View style={styles.qr}>
              <QRCode value={payUrl} size={240} ecl="M" />
            </View>
          )}
          <Body muted style={{ textAlign: "center" }}>
            {t("sale.scanHint")}
          </Body>
          <Text style={{ color: colors.paypal, fontFamily: FONTS.bodyBold }}>
            {t("sale.waiting")} · PayPal
          </Text>
          <Text
            accessibilityLabel={t("a11y.timeLeft", { time: mmss })}
            style={[styles.timer, { color: colors.mutedForeground }]}
          >
            {mmss}
          </Text>
          <Button
            label={t("sale.cancel")}
            hint={t("a11y.cancelHint")}
            variant="ghost"
            busy={busy}
            onPress={cancel}
          />
        </Card>
      )}

      {(phase === "failed" || phase === "expired") && (
        <Card style={{ alignItems: "center" }}>
          <Text
            accessibilityRole="header"
            accessibilityLiveRegion="assertive"
            style={[styles.total, { color: colors.destructive }]}
          >
            {phase === "failed" ? t("sale.declined") : t("sale.expired")}
          </Text>
          {sale && <Body>{formatMoney(sale.total)}</Body>}
          <Button label={t("sale.newSale")} hint={t("a11y.newSaleHint")} onPress={reset} />
        </Card>
      )}

      {phase === "entry" && reviewPrices && (
        <Body style={{ color: colors.warning }}>{t("sale.reviewPrices", { currency })}</Body>
      )}

      <Message text={error} />
      {error !== "" && <Button label={t("app.retry")} variant="secondary" onPress={load} />}

      {phase === "entry" && (
        <View style={styles.links}>
          <Link href="/soundbox" style={[styles.link, { color: colors.actionText }]}>
            {t("nav.soundbox")}
          </Link>
          <Link href="/nfc" style={[styles.link, { color: colors.actionText }]}>
            {t("nav.nfc")}
          </Link>
          <Link href="/backoffice" style={[styles.link, { color: colors.actionText }]}>
            {t("nav.backoffice")}
          </Link>
          <Link href="/settings" style={[styles.link, { color: colors.actionText }]}>
            {t("nav.settings")}
          </Link>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { fontFamily: FONTS.display, fontSize: 48, textAlign: "center" },
  keypad: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
  key: {
    width: "31%",
    minHeight: 64,
    borderWidth: 1,
    borderRadius: RADIUS,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontFamily: FONTS.displayMedium, fontSize: 28 },
  total: { fontFamily: FONTS.display, fontSize: 36 },
  qr: { padding: 12, backgroundColor: "#FFFFFF", borderRadius: RADIUS },
  timer: { fontFamily: FONTS.bodyBold, fontSize: 18 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 20, justifyContent: "center" },
  link: { fontFamily: FONTS.bodyBold, fontSize: 16, paddingVertical: 8 },
});
