// src/lib/announce.ts: the PAID moment's sound and touch — a success haptic (expo-haptics) and the voice
// box's own announcement: its chime, "¡Pagado!" and the amount in words (shared/spoken.ts), played with
// expo-audio from the box's recordings (assets/voice, generated with clips.h) and its 60 ms gap. Only if
// the clips cannot play, expo-speech says "Received: 95 pesos" instead.
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { paidClipKeys, WORD_GAP_MS } from "@shared/spoken";
import { CHIME, VOICE_CLIPS } from "../../assets/voice";
import type { Locale } from "./i18n";
import { speechLang } from "./i18n";
import { type Money, paidAnnouncement } from "./money";

/** The bundled assets a paid announcement plays, in order: chime, "paid", the amount's words. */
export function paidClipAssets(total: Money, locale: Locale): number[] {
  const clips = VOICE_CLIPS[locale];
  return [
    CHIME,
    ...paidClipKeys(total, locale).map((k) => {
      const asset = clips[k];
      if (asset === undefined) throw new Error(`no clip for "${k}"`);
      return asset;
    }),
  ];
}

let modeSet = false;
let playing: AudioPlayer[] = [];
let run = 0;

function stop(): void {
  run++;
  for (const p of playing) p.remove();
  playing = [];
}

/**
 * Plays clips back to back like the box's say(): WORD_GAP_MS of silence after each one except the
 * chime. All players are created first, so every clip is loading before the first one ends.
 */
function playClips(assets: number[]): void {
  stop();
  const mine = run;
  if (!modeSet) {
    modeSet = true;
    // A sale must be heard even with the iPhone's silent switch on.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }
  const players = assets.map((a) => createAudioPlayer(a));
  playing = players;
  const step = (i: number) => {
    if (mine !== run) return;
    const player = players[i];
    if (!player) return stop();
    const sub = player.addListener("playbackStatusUpdate", (s) => {
      if (!s.didJustFinish) return;
      sub.remove();
      setTimeout(() => step(i + 1), assets[i] === CHIME ? 0 : WORD_GAP_MS);
    });
    player.play();
  };
  step(0);
}

export function announcePaid(total: Money, locale: Locale): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  try {
    playClips(paidClipAssets(total, locale));
  } catch {
    stop();
    Speech.stop();
    Speech.speak(paidAnnouncement(total, locale), { language: speechLang(locale), rate: 0.95 });
  }
}

export function buzzError(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

export function tick(): void {
  Haptics.selectionAsync().catch(() => undefined);
}
