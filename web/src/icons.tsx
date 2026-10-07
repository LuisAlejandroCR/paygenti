// web/src/icons.tsx: tiny inline SVG icons (stroke = currentColor, decorative, aria-hidden) and the
// shared PAID check mark; no icon library so the bundle stays small.
import type { ComponentChildren } from "preact";

function Icon({ size = 22, children }: { size?: number; children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const MicIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
  </Icon>
);
export const KeyboardIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10" />
  </Icon>
);
export const KeypadIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 4h.01M12 4h.01M19 4h.01M5 10h.01M12 10h.01M19 10h.01M5 16h.01M12 16h.01M19 16h.01M12 21h.01" />
  </Icon>
);
export const MinusIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 12h14" />
  </Icon>
);
export const PlusIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
export const ClockIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Icon>
);
export const XCircleIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Icon>
);
export const BackspaceIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2ZM18 9l-6 6M12 9l6 6" />
  </Icon>
);

/** Big circled check whose tick draws itself (CSS .paid-check); used by vendor and soundbox. */
export const PaidCheck = () => (
  <svg class="paid-check" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <circle
      cx="32"
      cy="32"
      r="30"
      fill="none"
      stroke="currentColor"
      stroke-width="4"
      opacity=".35"
    />
    <path
      class="paid-tick"
      d="M18 33l9 9 19-20"
      fill="none"
      stroke="currentColor"
      stroke-width="6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);
