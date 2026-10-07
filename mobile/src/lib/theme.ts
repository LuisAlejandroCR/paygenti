// src/lib/theme.ts: "Merlot Dream" wine design tokens for React Native, light and dark — sRGB hex
// approximations of the oklch tokens in web/src/styles.css — plus font family names and sizes.
// Wine is for vendor actions, PayPal blue only on payment UI, green only for PAID.

export interface Palette {
  background: string;
  foreground: string;
  surface: string;
  muted: string;
  mutedForeground: string;
  border: string;
  action: string;
  actionForeground: string;
  actionText: string;
  paypal: string;
  paypalForeground: string;
  success: string;
  successForeground: string;
  destructive: string;
  warning: string;
}

export const LIGHT: Palette = {
  background: "#F4F0E6",
  foreground: "#3A2726",
  surface: "#FBF8F0",
  muted: "#EDDCCB",
  mutedForeground: "#6E5751",
  border: "#DCCBBD",
  action: "#8E1B3A",
  actionForeground: "#FCF9F2",
  actionText: "#8E1B3A",
  paypal: "#0057C8",
  paypalForeground: "#FFFFFF",
  success: "#0F6F55",
  successForeground: "#F7FCFA",
  destructive: "#A8262F",
  warning: "#8A5A10",
};

export const DARK: Palette = {
  background: "#2A1A1B",
  foreground: "#F1E6DC",
  surface: "#372526",
  muted: "#42302F",
  mutedForeground: "#CDB8A9",
  border: "#5A4442",
  action: "#A3284A",
  actionForeground: "#FCF9F2",
  actionText: "#E8A3A8",
  paypal: "#6FA5F5",
  paypalForeground: "#0C1A2E",
  success: "#3FB58E",
  successForeground: "#0B1F18",
  destructive: "#F07A78",
  warning: "#F0C060",
};

export const FONTS = {
  display: "BricolageGrotesque_700Bold",
  displayMedium: "BricolageGrotesque_600SemiBold",
  body: "Inter_400Regular",
  bodyBold: "Inter_600SemiBold",
} as const;

export const RADIUS = 16;
export const TOUCH = 56;
