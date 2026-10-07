// app/onboarding.tsx: stall setup with the existing API — vendor PIN (POST /api/backoffice/session),
// stall name, country (shared COUNTRIES table, LATAM first) and charge currency (shared
// chargeableCurrencies), saved with PUT /api/backoffice/vendor. Explains unsupported local currencies.
import { COUNTRIES, chargeableCurrencies, findCountry } from "@shared/currency";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/app-state";
import { ApiError, createApi } from "@/lib/api";
import { FONTS, RADIUS } from "@/lib/theme";
import { Body, Button, Card, Field, Message, Screen, Title } from "@/ui";

export default function OnboardingScreen() {
  const { api, serverUrl, terminal, t, locale, colors, token, setToken } = useApp();
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("MX");
  const [currency, setCurrency] = useState("MXN");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .terminal(terminal)
      .then((d) => {
        setName(d.vendor.displayName);
        if (d.vendor.country) setCountry(d.vendor.country);
        setCurrency(d.vendor.currency);
      })
      .catch(() => undefined);
  }, [api, terminal]);

  const options = useMemo(() => chargeableCurrencies(country), [country]);
  const info = findCountry(country);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COUNTRIES.filter(
      (c) => !q || c.name[locale].toLowerCase().includes(q) || c.code.toLowerCase() === q,
    ).slice(0, q ? 12 : 8);
  }, [query, locale]);

  function pickCountry(code: string) {
    setCountry(code);
    const c = findCountry(code);
    if (c) setCurrency(c.charge);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      let session = token;
      if (!session) {
        session = (await api.login(pin)).token;
        setToken(session);
      }
      await createApi(serverUrl, session).saveVendor({ displayName: name.trim(), country, currency });
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setToken(undefined);
      setError(t("onb.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t("onb.title")}</Title>
      <Body muted>{t("onb.intro")}</Body>
      <Card>
        {!token && (
          <Field
            label={t("onb.pin")}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={16}
          />
        )}
        <Field label={t("onb.name")} value={name} onChangeText={setName} autoCapitalize="words" />
      </Card>
      <Card>
        <Field label={t("onb.search")} value={query} onChangeText={setQuery} />
        <View style={styles.chips}>
          {list.map((c) => (
            <Chip
              key={c.code}
              label={c.name[locale]}
              selected={c.code === country}
              onPress={() => pickCountry(c.code)}
            />
          ))}
        </View>
        {info && info.local !== info.charge && (
          <Body muted>
            {t("onb.unsupported", {
              local: info.local,
              country: info.name[locale],
              charge: info.charge,
            })}
          </Body>
        )}
        <Text style={{ color: colors.mutedForeground, fontFamily: FONTS.bodyBold }}>
          {t("onb.currency")}
        </Text>
        <View style={styles.chips}>
          {options.map((c) => (
            <Chip key={c} label={c} selected={c === currency} onPress={() => setCurrency(c)} />
          ))}
        </View>
      </Card>
      <Message text={error} />
      <Button
        label={busy ? t("onb.saving") : t("onb.save")}
        busy={busy}
        disabled={!name.trim() || (!token && !pin)}
        onPress={save}
      />
    </Screen>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.action : colors.background,
          borderColor: selected ? colors.action : colors.border,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? colors.actionForeground : colors.foreground,
          fontFamily: FONTS.bodyBold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: "center",
  },
});
