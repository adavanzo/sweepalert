/// <reference types="react-native" />
/**
 * Tiny logger so street addresses and coordinates never end up in production
 * device logs (which crash reporters and `adb logcat` can read).
 *
 *  - log.debug: development only. Free to include addresses/coordinates.
 *  - log.warn:  always prints, but in production only the static message plus
 *    the error's name/message (with coordinate-like numbers masked) — never
 *    extra detail arguments or nested causes. So keep warn *messages* free of
 *    addresses/coordinates; put those in a separate debug call.
 */

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

// Decimal degrees like 42.35123 / -71.0812 (3+ fractional digits).
const COORD_RE = /-?\d{1,3}\.\d{3,}/g;

/** Production-safe one-line summary of an error-ish value. */
export function redact(detail: unknown): string {
  let text: string;
  if (detail instanceof Error) text = `${detail.name}: ${detail.message}`;
  else if (typeof detail === 'string') text = detail;
  else text = typeof detail; // objects may hold anything — don't print them
  return text.replace(COORD_RE, '<coord>');
}

export const log = {
  /** Dev-only diagnostics. Never prints in a production build. */
  debug(...args: unknown[]): void {
    if (isDev()) console.log(...args);
  },

  /**
   * Something went wrong but was handled. `message` must not contain an address
   * or coordinates; `detail` (usually the caught error) is printed in full in
   * development and reduced to a redacted summary in production.
   */
  warn(message: string, detail?: unknown): void {
    if (isDev()) {
      if (detail === undefined) console.warn(message);
      else console.warn(message, detail);
      return;
    }
    if (detail === undefined) console.warn(message);
    else console.warn(message, redact(detail));
  },
};
