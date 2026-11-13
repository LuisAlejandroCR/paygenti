// app/_layout.tsx: root of the expo-router app — loads Bricolage Grotesque + Inter, holds the splash
// until fonts and saved settings are ready, provides AppProvider and the themed stack navigator.
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppProvider, useApp } from "@/app-state";
import { FONTS } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Navigator() {
  const { ready, colors, dark, t } = useApp();
  const [fonts] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    Inter_400Regular,
    Inter_600SemiBold,
  });
  const loaded = ready && fonts;
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);
  if (!loaded) return null;
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: FONTS.displayMedium },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Paygenti" }} />
        <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
        <Stack.Screen name="onboarding" options={{ title: t("settings.stall") }} />
        <Stack.Screen name="soundbox" options={{ title: t("nav.soundbox") }} />
        <Stack.Screen name="nfc" options={{ title: t("nav.nfc") }} />
        <Stack.Screen name="backoffice" options={{ title: t("nav.backoffice") }} />
        <Stack.Screen name="resumen" options={{ title: t("nav.summary") }} />
        <Stack.Screen name="perfil" options={{ title: t("nav.profile") }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <Navigator />
    </AppProvider>
  );
}
