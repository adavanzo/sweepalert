import { fetchWithTimeout, HttpTimeoutError } from '../src/services/http';

/**
 * A fetch mock that never settles on its own but rejects with an AbortError
 * when its signal aborts — like the real fetch on a stalled connection.
 */
function hangingFetch() {
  return jest.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
}

describe('fetchWithTimeout', () => {
  const realFetch = global.fetch;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  it('resolves with the response when fetch answers in time', async () => {
    const res = { ok: true, status: 200 } as Response;
    const mock = jest.fn().mockResolvedValue(res);
    global.fetch = mock as unknown as typeof fetch;

    await expect(fetchWithTimeout('https://example.com/a?b=1')).resolves.toBe(res);
    expect(mock).toHaveBeenCalledWith('https://example.com/a?b=1', expect.objectContaining({ signal: expect.anything() }));
    // The timeout timer is cleared, so nothing is left pending.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not throw on a non-2xx status (callers check res.ok)', async () => {
    const res = { ok: false, status: 503 } as Response;
    global.fetch = jest.fn().mockResolvedValue(res) as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://example.com/')).resolves.toBe(res);
  });

  it('aborts and throws HttpTimeoutError after the default 8 s', async () => {
    const mock = hangingFetch();
    global.fetch = mock as unknown as typeof fetch;

    const p = fetchWithTimeout('https://gis.example.com/query?geometry=42.35123,-71.08123');
    const assertion = expect(p).rejects.toBeInstanceOf(HttpTimeoutError);
    jest.advanceTimersByTime(7999);
    expect(mock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await assertion;
    expect(mock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('honours a custom timeout and keeps the query (coords/addresses) out of the message', async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;
    const p = fetchWithTimeout('https://api.example.net/suggest?q=123%20Beacon%20St', {}, 500);
    const assertion = expect(p).rejects.toThrow('Request to api.example.net timed out after 500 ms');
    jest.advanceTimersByTime(500);
    await assertion;
    await expect(p).rejects.not.toThrow(/Beacon/);
  });

  it('passes through network errors unchanged', async () => {
    const offline = new TypeError('Network request failed');
    global.fetch = jest.fn().mockRejectedValue(offline) as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://example.com/')).rejects.toBe(offline);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("forwards a caller's abort signal (not reported as a timeout)", async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;
    const outer = new AbortController();
    const p = fetchWithTimeout('https://example.com/', { signal: outer.signal });
    outer.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(jest.getTimerCount()).toBe(0);
  });
});
