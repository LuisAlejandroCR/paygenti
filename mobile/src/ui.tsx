// src/ui.tsx: small themed building blocks shared by every screen — Screen, TopBar (stall name,
// online dot, EN/ES toggle), Title/Body text, Card, Button (action/secondary/ghost/paypal), Field.
// Colors and fonts come from src/lib/theme.ts through useApp().
import { type ReactNode, useId } from "react";
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "./app-state";
import { FONTS, RADIUS, TOUCH } from "./lib/theme";

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useApp();
  const inner = <View style={[styles.inner, style]}>{children}</View>;
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["bottom", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "android" ? "height" : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {inner}
          </ScrollView>
        ) : (
          inner
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function TopBar({ title, online }: { title: string; online?: boolean }) {
  const { colors, t, toggleLocale } = useApp();
  return (
    <View style={styles.bar}>
      <Text style={[styles.stall, { color: colors.foreground }]} numberOfLines={1}>
        {title}
      </Text>
      {online !== undefined && (
        <View style={styles.status} accessibilityRole="text">
          <View
            style={[styles.dot, { backgroundColor: online ? colors.success : colors.destructive }]}
          />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONTS.body }}>
            {online ? t("app.online") : t("app.offline")}
          </Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("app.language")}
        accessibilityHint={t("a11y.langHint")}
        onPress={toggleLocale}
        hitSlop={12}
      >
        <Text style={{ color: colors.actionText, fontFamily: FONTS.bodyBold }}>
          {t("app.language")}
        </Text>
      </Pressable>
    </View>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const { colors } = useApp();
  return <Text style={[styles.title, { color: colors.foreground }, style]}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: TextStyle;
}) {
  const { colors } = useApp();
  return (
    <Text
      style={[
        styles.body,
        { color: muted ? colors.mutedForeground : colors.foreground },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors } = useApp();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
    >
      {children}
    </View>
  );
}

type Variant = "action" | "secondary" | "ghost" | "paypal" | "danger";

export function Button({
  label,
  onPress,
  variant = "action",
  disabled,
  busy,
  style,
  onPressIn,
  onPressOut,
  hint,
}: {
  label: string;
  /** Read by VoiceOver/TalkBack after the label: what pressing does. */
  hint?: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useApp();
  const bg: Record<Variant, string> = {
    action: colors.action,
    secondary: colors.muted,
    ghost: "transparent",
    paypal: colors.paypal,
    danger: colors.destructive,
  };
  const fg: Record<Variant, string> = {
    action: colors.actionForeground,
    secondary: colors.foreground,
    ghost: colors.actionText,
    paypal: colors.paypalForeground,
    danger: colors.actionForeground,
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg[variant], opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <Text style={[styles.buttonText, { color: fg[variant] }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const NUMERIC = new Set(["number-pad", "decimal-pad", "numeric", "phone-pad"]);

/** Labeled input; numeric keyboards get a "Done" bar on iOS (they have no return key). */
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors, t } = useApp();
  const accessoryId = useId();
  const doneBar = Platform.OS === "ios" && NUMERIC.has(props.keyboardType ?? "");
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONTS.bodyBold }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        accessibilityLabel={label}
        {...props}
        inputAccessoryViewID={doneBar ? accessoryId : undefined}
        style={[
          styles.input,
          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      {doneBar && (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={[styles.doneBar, { backgroundColor: colors.muted }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("app.done")}
              onPress={Keyboard.dismiss}
              hitSlop={12}
            >
              <Text style={{ color: colors.actionText, fontFamily: FONTS.bodyBold, fontSize: 17 }}>
                {t("app.done")}
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
}

export function Message({ text, tone = "error" }: { text: string; tone?: "error" | "ok" }) {
  const { colors } = useApp();
  if (!text) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.body, { color: tone === "ok" ? colors.success : colors.destructive }]}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, padding: 16, gap: 16 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12 },
  stall: { flex: 1, fontFamily: FONTS.display, fontSize: 22 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontFamily: FONTS.display, fontSize: 28 },
  body: { fontFamily: FONTS.body, fontSize: 16, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: 16, gap: 12 },
  button: {
    minHeight: TOUCH,
    borderRadius: RADIUS,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontFamily: FONTS.bodyBold, fontSize: 18 },
  doneBar: { alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 10 },
  input: {
    minHeight: TOUCH,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: 14,
    fontFamily: FONTS.body,
    fontSize: 17,
  },
});
