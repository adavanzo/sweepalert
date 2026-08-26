/**
 * NFC service — feature-detected and gracefully degrading.
 *
 * react-native-nfc-manager is a native module that is NOT present in Expo Go and
 * is unavailable on the iOS Simulator and most emulators. We therefore load it
 * lazily and treat "module missing / NFC off / no hardware" as a normal,
 * non-fatal state: `isSupported()` returns false and the UI hides or disables
 * the NFC affordances (the design already exposes GPS as the primary path).
 *
 * To actually read tags you need a Development Build (`npx expo run:ios` /
 * `run:android`) on a physical NFC-capable device — see the README.
 */

// Lazy handle to the native module; null when unavailable.
type NfcManagerModule = typeof import('react-native-nfc-manager');
let mod: NfcManagerModule | null | undefined; // undefined = not yet probed

function load(): NfcManagerModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('react-native-nfc-manager') as NfcManagerModule;
  } catch {
    mod = null;
  }
  return mod;
}

/** True only when the native module is present AND the device has NFC enabled. */
export async function isSupported(): Promise<boolean> {
  const m = load();
  if (!m) return false;
  try {
    const supported = await m.default.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

export interface TagInfo {
  /** Serial/UID of the tag, if the platform exposes it. */
  id: string;
  /** Any NDEF text payload, when present. */
  payload?: string;
}

/**
 * Wait for a single tag tap and return its info. Resolves null when NFC is
 * unavailable or the scan is cancelled. Callers should always handle null.
 */
export async function readTag(): Promise<TagInfo | null> {
  const m = load();
  if (!m) return null;
  const NfcManager = m.default;
  const NfcTech = m.NfcTech;
  try {
    await NfcManager.start();
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const tag = await NfcManager.getTag();
    if (!tag) return null;
    const id = (tag.id as string) ?? 'unknown';
    let payload: string | undefined;
    const record = tag.ndefMessage?.[0];
    if (record?.payload) {
      // NDEF text records: first byte is a status/lang-length header.
      const bytes = record.payload as number[];
      payload = String.fromCharCode(...bytes.slice(1 + (bytes[0] & 0x3f)));
    }
    return { id, payload };
  } catch {
    return null;
  } finally {
    try {
      await m.default.cancelTechnologyRequest();
    } catch {
      /* ignore */
    }
  }
}

/** Cancel an in-flight scan (e.g. the user backs out of the pairing sheet). */
export async function cancel(): Promise<void> {
  const m = load();
  if (!m) return;
  try {
    await m.default.cancelTechnologyRequest();
  } catch {
    /* ignore */
  }
}
