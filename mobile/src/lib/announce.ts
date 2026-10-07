// src/lib/announce.ts: the PAID moment's sound and touch — a success haptic (expo-haptics) and
// "Received: 95 pesos" / "Recibido: 95 pesos" spoken with expo-speech in the current locale.
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import type { Locale } from "./i18n";
import { speechLang } from "./i18n";
import { type Money, paidAnnouncement } from "./money";

export function announcePaid(total: Money, locale: Locale): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  Speech.stop();
  Speech.speak(paidAnnouncement(total, locale), { language: speechLang(locale), rate: 0.95 });
}

export function buzzError(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

export function tick(): void {
  Haptics.selectionAsync().catch(() => undefined);
}
