// app.config.ts: Expo config for the paygent vendor app — bundle ids, light/dark, dev client and the
// native config plugins: NFC (entitlement + NFCReaderUsageDescription on iOS, NFC permission on
// Android), Android HCE service for the phone-to-phone tag, mic + speech recognition permissions.
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "paygent",
  slug: "paygent",
  owner: "alejoooo-team",
  scheme: "paygent",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    // com.paygent.app is taken by another Apple team; Android keeps com.paygent.app.
    bundleIdentifier: "com.alejoooo.paygent",
    supportsTablet: true,
    infoPlist: {
      CFBundleDisplayName: "paygent",
      // Only HTTPS and OS-provided crypto: exempt from export-compliance documentation.
      ITSAppUsesNonExemptEncryption: false,
      NFCReaderUsageDescription: "paygent writes your stall's payment link to NFC stickers.",
    },
  },
  android: {
    package: "com.paygent.app",
    adaptiveIcon: {
      backgroundColor: "#7D1439",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["android.permission.NFC", "android.permission.RECORD_AUDIO"],
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-localization",
    "expo-dev-client",
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 160, backgroundColor: "#F4F0E6" },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "paygent listens while you hold the mic to ring up an order.",
        speechRecognitionPermission: "paygent turns your spoken order into a cart.",
      },
    ],
    [
      "react-native-nfc-manager",
      {
        nfcPermission: "paygent writes your stall's payment link to NFC stickers.",
        // TAG only: App Store Connect rejects the legacy "NDEF" format (ITMS-90778); TAG still
        // reads and writes NDEF on NTAG stickers.
        includeNdefEntitlement: false,
      },
    ],
    "./plugins/with-hce",
  ],
  experiments: { typedRoutes: false, tsconfigPaths: true },
  // EAS project @alejoooo-team/paygent; EAS builds need it and cannot write it into a .ts config.
  extra: { eas: { projectId: "fa346fc6-7da1-45f1-b178-0fb572349053" } },
};

export default config;
