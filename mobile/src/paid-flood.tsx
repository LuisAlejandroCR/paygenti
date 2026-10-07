// src/paid-flood.tsx: the PAID moment — a full-screen green flood that springs in with a check mark,
// the amount and "PayPal ✓". Sound and haptics are fired by the caller (src/lib/announce.ts).
// Respects "reduce motion" and announces PAID to VoiceOver/TalkBack.
import { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { useApp } from "./app-state";
import { FONTS } from "./lib/theme";

export function PaidFlood({
  word,
  amount,
  children,
}: {
  word: string;
  amount: string;
  children?: ReactNode;
}) {
  const { colors } = useApp();
  const [scale] = useState(() => new Animated.Value(0.6));
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${word} ${amount}`);
  }, [word, amount]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          scale.setValue(1);
          fade.setValue(1);
          return;
        }
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
          Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]).start();
      });
    return () => {
      cancelled = true;
    };
  }, [scale, fade]);

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLabel={`${word} ${amount}`}
      style={[styles.flood, { backgroundColor: colors.success, opacity: fade }]}
    >
      <Animated.View style={{ transform: [{ scale }], alignItems: "center", gap: 8 }}>
        <View style={[styles.check, { borderColor: colors.successForeground }]}>
          <Text style={[styles.checkMark, { color: colors.successForeground }]}>✓</Text>
        </View>
        <Text style={[styles.word, { color: colors.successForeground }]}>{word}</Text>
        <Text style={[styles.amount, { color: colors.successForeground }]}>{amount}</Text>
        <Text style={[styles.via, { color: colors.successForeground }]}>PayPal ✓</Text>
      </Animated.View>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flood: {
    flex: 1,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 32,
  },
  check: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: { fontSize: 72, fontFamily: FONTS.display },
  word: { fontFamily: FONTS.display, fontSize: 64, letterSpacing: 2 },
  amount: { fontFamily: FONTS.display, fontSize: 40 },
  via: { fontFamily: FONTS.bodyBold, fontSize: 18 },
});
