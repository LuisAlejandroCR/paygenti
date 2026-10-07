<!-- docs/accessibility.md: estado de accesibilidad de paygent frente a WCAG 2.2 AA — qué cubre la
     web y la app móvil, cómo probarlo (axe en e2e, teclado, lector de pantalla, modo voz) y huecos
     conocidos. No es el plan de producto (docs/plan.md) ni el diario de decisiones (docs/memoria.md);
     aquí solo va accesibilidad. -->
# Accessibility (WCAG 2.2 AA)

Target: **WCAG 2.2 level AA** on every web screen and the Expo app. Primary audiences: blind and
low-vision street vendors, vendors who cannot use a touchscreen, and customers paying on any phone.

## What is covered

### Web (`web/`)

| Area | What it does | WCAG |
| --- | --- | --- |
| Automated gate | `e2e/a11y.spec.ts` runs axe-core on every screen (vendor entry and waiting, setup, judge, soundbox, verify, checkout, back-office login and dashboard, ledger) in light, dark and high contrast, phone and desktop, EN and ES. Any `serious` or `critical` violation fails `npm run e2e`. | many |
| Voice mode | Header toggle (🔊, `aria-pressed`). Every sale state is spoken in the UI language (es-MX / en-US, Web Speech API) and gets its own tone: entry, waiting, paid, declined, expired, extended (`web/src/a11y.ts` `SOUNDS`). A one-minute warning is spoken before expiry. | 1.3.3, 4.1.3 |
| Voice commands | In voice mode a large "Listen for a command" button takes: *cobrar / charge*, *cobra 45 / charge 45*, a bare amount, *cancelar / cancel*, *más tiempo / more time*, *nueva venta / new sale*, *repite / repeat*. Unknown phrases are answered with the list of commands. | 2.1.1 alternative |
| Timing adjustable | "+5 min" button next to the sale timer (`POST /api/sales/:id/extend`), up to 30 minutes of total life; also a voice command. | 2.2.1 |
| Keyboard only | Digits, `.` and Backspace type the amount, Enter charges, Escape cancels a waiting sale or starts a new one. All controls are native buttons/links; focus moves to the new state's heading after each change. | 2.1.1, 2.4.3 |
| Focus visible | 3px ring plus a background-coloured halo on every `:focus-visible`, so it shows on any surface. | 2.4.7, 2.4.11 |
| High contrast | Header toggle (◐) sets `<html data-contrast="high">`: black, white and yellow only, every control edged, links underlined. Persists across pages. | 1.4.3, 1.4.11 |
| Text scaling | Sizes are in `rem`; the header wraps. The e2e suite checks there is no horizontal scroll at 200% root font size. | 1.4.4, 1.4.10 |
| Reduced motion | `prefers-reduced-motion: reduce` collapses the PAID flood, pulse and entry animations. | 2.3.3 |
| Live regions | Online status (`role=status`), amount (`aria-live`), PAID / declined (`role=alert`), plus a hidden assertive region with the last spoken line. | 4.1.3 |

### Mobile (`mobile/`)

- `Button`, `Field` and the top-bar language switch set `accessibilityLabel`; buttons take a `hint`
  that becomes `accessibilityHint`. Keypad keys, the keypad toggle (`expanded`), refund links
  (`expanded`) and onboarding chips (`selected`) carry role, label, hint and state.
- The amount and the countdown have spoken labels ("Amount: $45", "Time left to pay: 3:12").
- `AccessibilityInfo.announceForAccessibility` announces waiting, declined and expired; PAID is
  announced by `PaidFlood`, which also respects the OS reduce-motion setting.

## How to test

1. `npm run e2e` — includes the axe gate, 200% text, keyboard-only charge with "+5 min", and the
   voice-mode toggle (`e2e/a11y.spec.ts`).
2. `npm test` — `test/a11y.test.ts` (command parsing, one tone per state) and
   `test/sale-extend.test.ts` (extend endpoint and its 30-minute cap).
3. Manual keyboard pass: open `/`, unplug the mouse, type `42`, Enter, Tab to "+5 min", Enter,
   Escape. Every focused control must show the ring.
4. Manual voice pass (Chrome or Edge, microphone allowed): turn on 🔊, press "Listen for a
   command", say "cobra 30"; pay from `/judge`; hear the paid tone and "Received: 30 pesos".
5. Screen readers: NVDA + Firefox and VoiceOver + Safari on the web; VoiceOver (iOS) and TalkBack
   (Android) on the Expo build. Check every control reads label, role and hint.
6. Mobile unit checks: `cd mobile && npm run typecheck && npm run lint`.

## Known gaps

- Speech recognition only exists in Chromium browsers and Safari; Firefox users of voice mode get
  spoken states and tones but must use the keyboard or keypad for commands.
- Voice mode lives on the vendor screen only; checkout, back office and ledger rely on standard
  screen-reader support (they pass axe but have no spoken commands).
- The AG Grid ledger is keyboard-navigable but dense; a screen-reader user may prefer the CSV export.
- PayPal's hosted buttons and popups are outside our control and are not covered by the axe gate.
- The mobile app has no voice-command mode or "+5 min" button yet, and no automated
  accessibility test (labels are reviewed by hand).
- No audit with blind vendors has been done yet; the command words come from the team, not users.
