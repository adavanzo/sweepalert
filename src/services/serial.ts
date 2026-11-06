/**
 * Per-key serialization (pure, no device APIs). Each task for a key starts only
 * after the previous task for that key has settled, so e.g. two notification
 * syncs for the same car can't interleave their cancel + schedule steps.
 */
export function keyedSerial() {
  const tails = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    // Keep the chain alive past failures; drop the entry once it's idle.
    const tail = next.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return next;
  };
}
