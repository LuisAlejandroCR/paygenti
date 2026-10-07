// src/stalls-ui.tsx: the phone's multi-paygent pieces — the stall switcher (only with 2+ stalls,
// plus "All my paygents"), the owner totals per currency (never mixed) and the approvals inbox
// where Claude's proposed refunds/payouts are approved with this stall's PIN.
import type { StallSummary } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/app-state";
import { ApiError, type Approval, type OwnerOverview } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { ALL_STALLS, showSwitcher } from "@/lib/stalls";
import { FONTS } from "@/lib/theme";
import { Body, Button, Card, Field, Message, Title } from "@/ui";

/** Chips for each stall and "All"; `selected` is a stall id or ALL_STALLS. */
export function StallSwitcher({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string, stall?: StallSummary) => void;
}) {
  const { api, t, colors } = useApp();
  const [stalls, setStalls] = useState<StallSummary[]>([]);
  useEffect(() => {
    api
      .stalls()
      .then((r) => setStalls(r.stalls))
      .catch(() => setStalls([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!showSwitcher(stalls)) return null;
  const chips = [
    ...stalls.map((s) => ({ id: s.id, label: s.displayName, stall: s })),
    { id: ALL_STALLS, label: t("stalls.all"), stall: undefined },
  ];
  return (
    <View style={styles.chips} accessibilityRole="tablist" testID="stall-switcher">
      {chips.map((c) => {
        const on = c.id === selected;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(c.id, c.stall)}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: on ? colors.foreground : "transparent" },
            ]}
          >
            <Text
              style={{ color: on ? colors.background : colors.foreground, fontFamily: FONTS.bodyBold }}
            >
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Today's totals per currency over the stalls this phone is signed in to. */
export function OwnerTotals() {
  const { api, tokens, t } = useApp();
  const [data, setData] = useState<OwnerOverview>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!Object.values(tokens).some(Boolean)) return;
    api
      .overview(tokens)
      .then(setData)
      .catch(() => setError(t("bo.loadFailed")));
  }, [api, tokens, t]);
  return (
    <Card>
      <Title>{t("stalls.all")}</Title>
      {!data && !error && <Body muted>{t("stalls.signInHint")}</Body>}
      {data?.totals.map((c) => (
        <Body key={c.currency}>
          {c.currency}: {formatMoney(c.net)} · {t("stalls.count", { count: c.count })}
        </Body>
      ))}
      {data?.stalls.map((s) => (
        <Body key={s.id} muted>
          {s.displayName}: {formatMoney(s.net)}
          {s.pendingApprovals > 0 ? ` · ${t("stalls.pending", { count: s.pendingApprovals })}` : ""}
        </Body>
      ))}
      <Body muted>{t("stalls.noFx")}</Body>
      <Message text={error} />
    </Card>
  );
}

/** Claude's pending proposals for the current stall; nothing renders when there are none. */
export function ApprovalsCard({ onChanged }: { onChanged?: () => void }) {
  const { api, t } = useApp();
  const [items, setItems] = useState<Approval[]>([]);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" }>({ text: "", tone: "ok" });
  const load = useCallback(
    () =>
      api
        .approvals()
        .then((r) => setItems(r.approvals.filter((a) => a.status === "pending")))
        .catch(() => setItems([])),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    try {
      if (approve) await api.approve(id, pins[id] ?? "");
      else await api.reject(id);
      setMsg({ text: t(approve ? "stalls.approved" : "stalls.rejected"), tone: "ok" });
    } catch (err) {
      const reason = err instanceof ApiError ? (err.reason ?? err.code) : String(err);
      setMsg({ text: t("bo.refundDenied", { reason }), tone: "error" });
    } finally {
      setPins((p) => ({ ...p, [id]: "" }));
      await load();
      onChanged?.();
    }
  }

  if (items.length === 0 && !msg.text) return null;
  return (
    <Card>
      <Title>{t("stalls.approvals")}</Title>
      <Body muted>{t("stalls.approvalsHint")}</Body>
      {items.map((a) => (
        <View key={a.id} style={{ gap: 6 }}>
          <Body>
            {t(a.kind === "refund" ? "stalls.kindRefund" : "stalls.kindPayout")} ·{" "}
            {formatMoney(a.amount)}
          </Body>
          {!!a.note && <Body muted>“{a.note}”</Body>}
          <Field
            label={t("bo.refundPin")}
            value={pins[a.id] ?? ""}
            onChangeText={(v) => setPins((p) => ({ ...p, [a.id]: v }))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={16}
          />
          <Button
            label={t("stalls.approve")}
            disabled={(pins[a.id] ?? "").length < 4}
            onPress={() => void decide(a.id, true)}
          />
          <Button
            label={t("stalls.reject")}
            variant="ghost"
            onPress={() => void decide(a.id, false)}
          />
        </View>
      ))}
      <Message text={msg.text} tone={msg.tone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
