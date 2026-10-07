// app/backoffice.tsx: back office on the existing API — PIN login (vendor session), today's sales,
// refund of a sale with the PIN re-entered (the server's policy decides; no client-side rules)
// and today's ledger with totals. With 2+ stalls: a switcher (each stall has its own PIN session),
// "All my paygents" totals per currency, and Claude's proposals to approve with the stall PIN.
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/app-state";
import { ApiError, type Ledger, type SalesToday } from "@/lib/api";
import { formatMoney, money, parseAmount } from "@/lib/money";
import { ALL_STALLS } from "@/lib/stalls";
import { ApprovalsCard, OwnerTotals, StallSwitcher } from "@/stalls-ui";
import { FONTS } from "@/lib/theme";
import { Body, Button, Card, Field, Message, Screen, Title } from "@/ui";

export default function BackOfficeScreen() {
  const { api, token, setToken, t, colors, stall, setStall } = useApp();
  const [showAll, setShowAll] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState<SalesToday>();
  const [ledger, setLedger] = useState<Ledger>();
  const [refundOf, setRefundOf] = useState<string>();

  const load = useCallback(
    () =>
      Promise.all([api.salesToday(), api.ledger()])
        .then(([s, l]) => {
          setError("");
          setToday(s);
          setLedger(l);
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) setToken(undefined);
          else setError(t("bo.loadFailed"));
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, setToken],
  );

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const switcher = (
    <StallSwitcher
      selected={showAll ? ALL_STALLS : stall}
      onSelect={(id, s) => {
        setShowAll(id === ALL_STALLS);
        setToday(undefined);
        setLedger(undefined);
        setRefundOf(undefined);
        if (id !== ALL_STALLS) setStall(id, s?.terminals[0]);
        setError("");
      }}
    />
  );

  if (showAll)
    return (
      <Screen>
        {switcher}
        <OwnerTotals />
      </Screen>
    );

  async function login() {
    setBusy(true);
    setError("");
    try {
      setToken((await api.login(pin)).token);
      setPin("");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "PIN_LOCKED" ? t("bo.locked") : t("bo.loginFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!token)
    return (
      <Screen>
        {switcher}
        <Card>
          <Field
            label={t("bo.pin")}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={16}
            onSubmitEditing={login}
          />
          <Button label={t("bo.login")} busy={busy} disabled={!pin} onPress={login} />
          <Message text={error} />
        </Card>
      </Screen>
    );

  return (
    <Screen>
      {switcher}
      <ApprovalsCard onChanged={() => void load()} />
      <Card>
        <Title>{t("bo.today")}</Title>
        {today && (
          <>
            <Body>{t("bo.total", { amount: formatMoney(today.total), count: today.count })}</Body>
            {today.refunded.minor > 0 && (
              <Body muted>{t("bo.refunded", { amount: formatMoney(today.refunded) })}</Body>
            )}
            {today.sales.length === 0 && <Body muted>{t("bo.none")}</Body>}
            {today.sales.map((s) => (
              <View key={s.id} style={[styles.row, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.amount, { color: colors.foreground }]}>
                    {formatMoney(s.total)}
                  </Text>
                  <Body muted>
                    {s.paidAt.slice(11, 16)} · {s.items || s.status}
                  </Body>
                  {s.refunded.minor > 0 && (
                    <Body muted>{t("bo.refunded", { amount: formatMoney(s.refunded) })}</Body>
                  )}
                </View>
                {s.refunded.minor < s.total.minor && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("bo.refund")} ${formatMoney(s.total)}`}
                    accessibilityHint={t("a11y.refundHint")}
                    accessibilityState={{ expanded: refundOf === s.id }}
                    onPress={() => setRefundOf(refundOf === s.id ? undefined : s.id)}
                    hitSlop={10}
                  >
                    <Text style={{ color: colors.actionText, fontFamily: FONTS.bodyBold }}>
                      {t("bo.refund")}
                    </Text>
                  </Pressable>
                )}
                {refundOf === s.id && (
                  <RefundForm
                    saleId={s.id}
                    max={money(s.total.minor - s.refunded.minor, s.total.currency)}
                    onDone={() => {
                      setRefundOf(undefined);
                      void load();
                    }}
                  />
                )}
              </View>
            ))}
          </>
        )}
      </Card>

      <Card>
        <Title>{t("bo.ledger")}</Title>
        {ledger && (
          <>
            <Body>{t("bo.ledgerNet", { amount: formatMoney(ledger.totals.net) })}</Body>
            {ledger.rows.map((r) => (
              <View key={`${r.kind}-${r.id}`} style={[styles.line, { borderColor: colors.border }]}>
                <Body style={{ flex: 1 }}>
                  {(r.paidAt ?? r.createdAt).slice(11, 16)} · {r.status} · {r.method}
                </Body>
                <Body>{formatMoney(r.total)}</Body>
              </View>
            ))}
          </>
        )}
      </Card>

      <Message text={error} />
      <Button label={t("app.retry")} variant="secondary" onPress={load} />
      <Button label={t("bo.logout")} variant="ghost" onPress={() => setToken(undefined)} />
    </Screen>
  );
}

function RefundForm({
  saleId,
  max,
  onDone,
}: {
  saleId: string;
  max: ReturnType<typeof money>;
  onDone: () => void;
}) {
  const { api, t } = useApp();
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" }>({ text: "", tone: "ok" });
  const minor = parseAmount(amount, max.currency);

  async function refund() {
    if (!minor) return;
    setBusy(true);
    setMsg({ text: "", tone: "ok" });
    try {
      const r = await api.refund(saleId, minor, pin);
      setMsg({ text: t("bo.refundOk", { amount: formatMoney(r.amount) }), tone: "ok" });
      setTimeout(onDone, 1200);
    } catch (err) {
      const reason = err instanceof ApiError ? (err.reason ?? err.code) : String(err);
      setMsg({ text: t("bo.refundDenied", { reason }), tone: "error" });
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  return (
    <View style={{ width: "100%", gap: 8, paddingTop: 8 }}>
      <Field
        label={`${t("bo.refundAmount")} (≤ ${formatMoney(max)})`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
      />
      <Field
        label={t("bo.refundPin")}
        value={pin}
        onChangeText={setPin}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={16}
      />
      <Button
        label={t("bo.refundDo")}
        variant="danger"
        busy={busy}
        disabled={!minor || minor > max.minor || !pin}
        onPress={refund}
      />
      <Message text={msg.text} tone={msg.tone} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  line: { flexDirection: "row", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  amount: { fontFamily: FONTS.displayMedium, fontSize: 20 },
});
