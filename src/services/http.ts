/**
 * fetch() with a hard timeout. React Native's fetch has no timeout of its own,
 * so on a flaky cell connection a request can hang for minutes and leave a
 * lookup (and its spinner) stuck. Every network call under src/ goes through
 * this instead.
 *
 * Like fetch, it does NOT throw on a non-2xx status: callers check `res.ok`
 * themselves. It throws only on network failure or timeout.
 */

export const DEFAULT_TIMEOUT_MS = 8000;

/** Thrown when a request takes longer than its timeout. */
export class HttpTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(host: string, timeoutMs: number) {
    // Host only — never the path/query, which can carry coordinates or an
    // address (e.g. an address-suggest ?q=...).
    super(`Request to ${host} timed out after ${timeoutMs} ms`);
    this.name = 'HttpTimeoutError';
    this.timeoutMs = timeoutMs;
    // Keep instanceof working when compiled down to ES5 classes.
    Object.setPrototypeOf(this, HttpTimeoutError.prototype);
  }
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1] : 'server';
}

/**
 * fetch(url, opts), aborted after `timeoutMs`. The timeout covers getting the
 * response (status + headers); reading the body afterwards is up to the caller.
 * A caller-supplied `opts.signal` still works: aborting it aborts the request
 * with the caller's own abort error, not a timeout.
 */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Forward a caller's abort to our controller.
  const outer = opts.signal;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort);
  }

  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new HttpTimeoutError(hostOf(url), timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
