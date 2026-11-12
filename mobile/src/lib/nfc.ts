// src/lib/nfc.ts: native NFC — writes the pay URL to an NTAG sticker with react-native-nfc-manager
// (iOS + Android) and, on Android only, emulates an NDEF Type 4 tag carrying the same URL with
// react-native-hce. Native modules are required lazily so a build without them reports "unsupported".
import { Platform } from "react-native";
import { fitsNtag215 } from "./nfc-url";

type NfcModule = typeof import("react-native-nfc-manager");
type HceModule = typeof import("react-native-hce");

function load<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

const nfcModule = (): NfcModule | undefined =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy native module
  load(() => require("react-native-nfc-manager") as NfcModule);
const hceModule = (): HceModule | undefined =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy native module
  Platform.OS === "android" ? load(() => require("react-native-hce") as HceModule) : undefined;

export type NfcState = "ready" | "unsupported" | "disabled";

export async function nfcState(): Promise<NfcState> {
  const nfc = nfcModule();
  if (!nfc) return "unsupported";
  try {
    const manager = nfc.default;
    if (!(await manager.isSupported())) return "unsupported";
    await manager.start();
    // isEnabled is Android-only; iOS reports NFC as always available when supported.
    if (Platform.OS === "android" && !(await manager.isEnabled())) return "disabled";
    return "ready";
  } catch {
    return "unsupported";
  }
}

/** True when this platform can emulate a tag (Android with HCE). Apple does not allow it on iOS. */
export const canEmulateTag = Platform.OS === "android";

export class StickerTooSmall extends Error {}

/** Waits for a sticker, writes one NDEF URI record, releases the reader. */
export async function writeSticker(url: string, alertMessage: string): Promise<void> {
  if (!fitsNtag215(url)) throw new StickerTooSmall(url);
  const nfc = nfcModule();
  if (!nfc) throw new Error("unsupported");
  const { default: manager, Ndef, NfcTech } = nfc;
  try {
    await manager.requestTechnology(NfcTech.Ndef, { alertMessage });
    const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
    if (!bytes) throw new Error("encode failed");
    await manager.ndefHandler.writeNdefMessage(bytes);
    if (Platform.OS === "ios") await manager.setAlertMessageIOS("✓");
  } finally {
    await manager.cancelTechnologyRequest().catch(() => undefined);
  }
}

export async function cancelSticker(): Promise<void> {
  await nfcModule()
    ?.default.cancelTechnologyRequest()
    .catch(() => undefined);
}

/** Starts Android HCE with a read-only Type 4 tag holding `url`; resolves to a stop function. */
export async function startTap(url: string, onRead: () => void): Promise<() => Promise<void>> {
  const hce = hceModule();
  if (!canEmulateTag || !hce) throw new Error("unsupported");
  const { HCESession, NFCTagType4, NFCTagType4NDEFContentType } = hce;
  const session = await HCESession.getInstance();
  await session.setApplication(
    new NFCTagType4({ type: NFCTagType4NDEFContentType.URL, content: url, writable: false }),
  );
  await session.setEnabled(true);
  const off = session.on(HCESession.Events.HCE_STATE_READ, onRead);
  return async () => {
    off();
    await session.setEnabled(false);
  };
}
