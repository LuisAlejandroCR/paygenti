// app/resumen.tsx: the vendor's month at a glance — wine card with verified sales big, self-declared
// and "to confirm" apart (never summed, pending never paid), delta vs last month, shortcut pills,
// a day strip and bank transfers to confirm with the stall PIN. Data: per-day back-office ledgers.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/app-state";
import { ApiError, type LedgerRow } from "@/lib/api";
import { type Currency, formatMoney, money } from "@/lib/money";
import {
  daily,
  dayKey,
  daysIn,
  deltaPct,
  elapsedDays,
  monthKey,
  pendingTransfers,
  shiftMonth,
  split,
} from "@/lib/summary";
import { FONTS, RADIUS, TOUCH } from "@/lib/theme";
import { Body, Button, Card, Field, Message, Screen, Title } from "@/ui";

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

/** Runs fetches a few at a time so a month (≤ 62 day ledgers) does not flood the server. */
async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

interface MonthData {
  month: string;
  currency: Currency;
  cur: Map<number, LedgerRow[]>;
  prevSame: LedgerRow[];
}

export default function ResumenScreen() {
  const { api, token, setToken, t, colors, locale } = useApp();
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => monthKey(today));
  const [data, setData] = useState<MonthData>();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string>();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const prev = shiftMonth(month, -1);
  const day = elapsedDays(month, today);
  const name = (m: string) => MONTHS[locale][Number(m.slice(5, 7)) - 1] ?? m;

  const load = useCallback(() => {
    const curDays = Array.from({ length: day }, (_, i) => i + 1);
    const prevDays = Array.from({ length: Math.min(day, daysIn(prev)) }, (_, i) => i + 1);
    return Promise.all([
      pool(curDays, 4, (d) => api.ledger(dayKey(month, d))),
      pool(prevDays, 4, (d) => api.ledger(dayKey(prev, d))),
    ])
      .then(([cur, before]) => {
        setError("");
        setData({
          month,
          currency: (cur[0] ?? before[0])?.totals.paid.currency ?? "MXN",
          cur: new Map(cur.map((l, i) => [i + 1, l.rows])),
          prevSame: before.flatMap((l) => l.rows),
        });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) setToken(undefined);
        else setError(t("bo.loadFailed"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, month, prev, day, setToken]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  if (!token) return <Unlock />;

  const loading = data?.month !== month && !error;
  const c: Currency = data?.currency ?? "MXN";
  const fmt = (minor: number) => formatMoney(money(minor, c));
  const rows = data ? [...data.cur.values()].flat() : [];
  const s = split(rows, c);
  const before = split(data?.prevSame ?? [], c);
  const delta = deltaPct(s.verified, before.verified);
  const deltaText =
    delta === undefined
      ? t("sum.noDelta", { month: name(prev) })
      : t("sum.delta", { pct: delta > 0 ? `+${delta}` : String(delta), month: name(prev) });
  const days = data ? daily(data.cur, month, c) : [];
  const dayMax = Math.max(1, ...days.map((d) => d.verified + d.declared));
  const pending = pendingTransfers(rows);
  const isCurrent = month === monthKey(today);

  async function confirm(id: string) {
    setBusy(true);
    setError("");
    try {
      await api.vendorConfirm(id, pin);
      setConfirming(undefined);
      setError("");
      await load();
      setError(t("sum.confirmOk"));
    } catch (err) {
      const reason = err instanceof ApiError ? err.code : String(err);
      setError(t("sum.confirmFailed", { reason }));
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  const pills: { label: string; onPress: () => void; solid?: boolean }[] = [
    { label: t("sum.charge"), onPress: () => router.navigate("/"), solid: true },
    { label: t("sum.confirm"), onPress: () => setConfirming(pending[0]?.id) },
    { label: t("sum.refund"), onPress: () => router.push("/backoffice") },
  ];

  return (
    <Screen>
      <View style={styles.monthRow}>
        <MonthArrow label={t("sum.prevMonth")} glyph="‹" onPress={() => setMonth(prev)} />
        <Text accessibilityRole="header" style={[styles.monthName, { color: colors.foreground }]}>
          {name(month)} {month.slice(0, 4)}
        </Text>
        <MonthArrow
          label={t("sum.nextMonth")}
          glyph="›"
          disabled={isCurrent}
          onPress={() => setMonth(shiftMonth(month, 1))}
        />
      </View>

      <View
        accessible
        accessibilityLabel={t("sum.cardLabel", {
          month: name(month),
          verified: fmt(s.verified),
          declared: fmt(s.declared),
          pending: fmt(s.pending),
          delta: deltaText,
        })}
        style={[styles.hero, { backgroundColor: colors.action }]}
      >
        <Text style={[styles.heroLabel, { color: colors.actionForeground }]}>
          {t("sum.salesOf", { month: name(month) })} · {t("sum.verified")}
        </Text>
        <Text style={[styles.heroAmount, { color: colors.actionForeground }]}>{fmt(s.verified)}</Text>
        <Text style={[styles.heroSub, { color: colors.actionForeground }]}>
          {deltaText} · {t("sum.dayOf", { day, total: daysIn(month) })}
        </Text>
        <View style={styles.kpis}>
          <Kpi label={t("sum.declared")} value={fmt(s.declared)} />
          <Kpi
            label={t("sum.pending")}
            value={t("sum.pendingCount", { count: s.pendingCount, amount: fmt(s.pending) })}
          />
        </View>
      </View>

      <View style={styles.pills}>
        {pills.map((p) => (
          <Pressable
            key={p.label}
            accessibilityRole="button"
            accessibilityLabel={p.label}
            onPress={p.onPress}
            style={({ pressed }) => [
              styles.pill,
              p.solid
                ? { backgroundColor: colors.action }
                : { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text
              style={[
                styles.pillText,
                { color: p.solid ? colors.actionForeground : colors.foreground },
              ]}
            >
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && <Body muted>{t("sum.loading")}</Body>}
      <Message text={error} tone={error === t("sum.confirmOk") ? "ok" : "error"} />

      <Card>
        <Title style={styles.cardTitle}>{t("sum.days")}</Title>
        <View style={styles.strip}>
          {days.map((d) => (
            <View
              key={d.day}
              accessible
              accessibilityLabel={t("sum.dayLabel", {
                day: d.day,
                verified: fmt(d.verified),
                declared: fmt(d.declared),
              })}
              style={styles.dayCol}
            >
              {d.day <= day ? (
                <>
                  <View
                    style={{
                      height: `${(d.declared / dayMax) * 100}%`,
                      backgroundColor: colors.mutedForeground,
                      opacity: 0.45,
                      borderTopLeftRadius: 2,
                      borderTopRightRadius: 2,
                    }}
                  />
                  <View
                    style={{
                      height: `${Math.max(4, (d.verified / dayMax) * 100)}%`,
                      backgroundColor: colors.action,
                    }}
                  />
                </>
              ) : (
                <View style={[styles.future, { backgroundColor: colors.border }]} />
              )}
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          <Legend color={colors.action} label={t("sum.verified")} />
          <Legend color={colors.mutedForeground} label={t("sum.declared")} faded />
        </View>
      </Card>

      <Card>
        <Title style={styles.cardTitle}>{t("sum.toConfirm")}</Title>
        <Body muted>{t("sum.toConfirmHint")}</Body>
        {pending.length === 0 && <Body muted>{t("sum.noneToConfirm")}</Body>}
        {pending.map((p) => (
          <View key={p.id} style={[styles.pendingRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.amount, { color: colors.foreground }]}>
                {formatMoney(p.total)}
              </Text>
              <Body muted>
                {p.createdAt.slice(5, 10)} {p.createdAt.slice(11, 16)} · {p.method.toUpperCase()} ·{" "}
                <Text style={{ color: colors.warning }}>{t("sum.notPaid")}</Text>
              </Body>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t("sum.confirm")} ${formatMoney(p.total)}`}
              accessibilityState={{ expanded: confirming === p.id }}
              onPress={() => setConfirming(confirming === p.id ? undefined : p.id)}
              style={styles.linkBtn}
            >
              <Text style={{ color: colors.actionText, fontFamily: FONTS.bodyBold }}>
                {t("sum.confirm")}
              </Text>
            </Pressable>
            {confirming === p.id && (
              <View style={{ width: "100%", gap: 8 }}>
                <Field
                  label={t("bo.refundPin")}
                  value={pin}
                  onChangeText={setPin}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={16}
                />
                <Button
                  label={t("sum.confirmDo")}
                  busy={busy}
                  disabled={!pin}
                  onPress={() => void confirm(p.id)}
                />
              </View>
            )}
          </View>
        ))}
      </Card>
      <Button label={t("app.retry")} variant="secondary" onPress={() => void load()} />
    </Screen>
  );
}

function Unlock() {
  const { api, setToken, t } = useApp();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login() {
    setBusy(true);
    setError("");
    try {
      setToken((await api.login(pin)).token);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "PIN_LOCKED" ? t("bo.locked") : t("bo.loginFailed"),
      );
    } finally {
      setBusy(false);
      setPin("");
    }
  }
  return (
    <Screen>
      <Card>
        <Body>{t("sum.locked")}</Body>
        <Field
          label={t("bo.pin")}
          value={pin}
          onChangeText={setPin}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={16}
          onSubmitEditing={login}
        />
        <Button label={t("sum.unlock")} busy={busy} disabled={!pin} onPress={login} />
        <Message text={error} />
      </Card>
    </Screen>
  );
}

function MonthArrow({
  label,
  glyph,
  onPress,
  disabled,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.arrow, { borderColor: colors.border, opacity: disabled ? 0.35 : 1 }]}
    >
      <Text style={{ color: colors.foreground, fontSize: 24, fontFamily: FONTS.bodyBold }}>
        {glyph}
      </Text>
    </Pressable>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  const { colors } = useApp();
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiLabel, { color: colors.actionForeground }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: colors.actionForeground }]}>{value}</Text>
    </View>
  );
}

function Legend({ color, label, faded }: { color: string; label: string; faded?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color, opacity: faded ? 0.45 : 1 }}
      />
      <Body muted>{label}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthName: { fontFamily: FONTS.displayMedium, fontSize: 20, textTransform: "capitalize" },
  arrow: {
    minWidth: 48,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: RADIUS,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: { borderRadius: 24, padding: 20, gap: 4 },
  heroLabel: { fontFamily: FONTS.bodyBold, fontSize: 13, letterSpacing: 1, opacity: 0.85 },
  heroAmount: { fontFamily: FONTS.display, fontSize: 44 },
  heroSub: { fontFamily: FONTS.body, fontSize: 15, opacity: 0.9 },
  kpis: { flexDirection: "row", gap: 12, marginTop: 12 },
  kpi: { flex: 1, borderRadius: 12, padding: 10, backgroundColor: "rgba(255,255,255,0.12)" },
  kpiLabel: { fontFamily: FONTS.bodyBold, fontSize: 12, opacity: 0.85 },
  kpiValue: { fontFamily: FONTS.displayMedium, fontSize: 18 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontFamily: FONTS.bodyBold, fontSize: 16 },
  cardTitle: { fontSize: 20 },
  strip: { flexDirection: "row", alignItems: "flex-end", height: 72, gap: 2 },
  dayCol: { flex: 1, height: "100%", justifyContent: "flex-end" },
  future: { width: 3, height: 3, borderRadius: 2, alignSelf: "center" },
  legend: { flexDirection: "row", gap: 16 },
  pendingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  amount: { fontFamily: FONTS.displayMedium, fontSize: 20 },
  linkBtn: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
});
