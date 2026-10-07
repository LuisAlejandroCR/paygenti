// web/src/a11y-toggles.tsx: the header switches for voice mode (blind vendors) and the high-contrast
// theme; both are toggle buttons (aria-pressed) and persist through a11y.ts.
import { playSound, speak, usePref } from "./a11y";
import { useT } from "./i18n";

export function A11yToggles({ voice = true }: { voice?: boolean }) {
  const { t } = useT();
  const [contrast, setContrast] = usePref("contrast");
  const [voiceOn, setVoice] = usePref("voice");
  return (
    <span class="a11y-toggles">
      <button
        type="button"
        class="a11y-toggle contrast-toggle"
        aria-pressed={contrast}
        title={t("a11y.contrast")}
        onClick={() => setContrast(!contrast)}
      >
        <span aria-hidden="true">◐</span>
        <span class="sr-only">{t("a11y.contrast")}</span>
      </button>
      {voice && (
        <button
          type="button"
          class="a11y-toggle voice-mode-toggle"
          aria-pressed={voiceOn}
          title={t("a11y.voiceMode")}
          onClick={() => {
            const next = !voiceOn;
            setVoice(next);
            playSound("entry");
            speak(t(next ? "a11y.voiceModeOn" : "a11y.voiceModeOff"));
          }}
        >
          <span aria-hidden="true">🔊</span>
          <span class="sr-only">{t("a11y.voiceMode")}</span>
        </button>
      )}
    </span>
  );
}
