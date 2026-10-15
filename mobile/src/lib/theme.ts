// src/lib/theme.ts: "Cempasúchil" wine design tokens for React Native, light and dark — sRGB hex
// approximations of the oklch tokens in web/src/styles.css — plus font family names and sizes.
// Wine is for vendor actions, PayPal blue only on payment UI, añil teal only for PAID.

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
  background: "#F6EEDC",
  foreground: "#34211E",
  surface: "#FEFAF1",
  muted: "#EEDBBD",
  mutedForeground: "#6B5244",
  border: "#DECBB1",
  action: "#7D1439",
  actionForeground: "#FCFAF6",
  actionText: "#7D1439",
  paypal: "#0170BA",
  paypalForeground: "#FFFFFF",
  success: "#00766D",
  successForeground: "#FCFAF6",
  destructive: "#C9241B",
  warning: "#9C5906",
};

export const DARK: Palette = {
  background: "#251311",
  foreground: "#F5E9D9",
  surface: "#321E1C",
  muted: "#3E2723",
  mutedForeground: "#CBB29E",
  border: "#5B403B",
  action: "#BA365F",
  actionForeground: "#FCFAF6",
  actionText: "#F6A3AF",
  paypal: "#64A9F3",
  paypalForeground: "#06101C",
  success: "#60CCC5",
  successForeground: "#011614",
  destructive: "#F66E5C",
  warning: "#FCB442",
};

export const FONTS = {
  display: "BricolageGrotesque_700Bold",
  displayMedium: "BricolageGrotesque_600SemiBold",
  body: "Inter_400Regular",
  bodyBold: "Inter_600SemiBold",
} as const;

export const RADIUS = 16;
export const TOUCH = 56;
