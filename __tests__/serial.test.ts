import { keyedSerial } from '../src/services/serial';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('keyedSerial', () => {
  it('runs tasks for the same key one after another', async () => {
    const run = keyedSerial();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };
    await Promise.all([run('car', task('a')), run('car', task('b'))]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('runs different keys concurrently', async () => {
    const run = keyedSerial();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };
    await Promise.all([run('a', task('a')), run('b', task('b'))]);
    expect(log.slice(0, 2)).toEqual(['a:start', 'b:start']);
  });

  it('keeps going after a failed task and propagates its error', async () => {
    const run = keyedSerial();
    const failed = run('car', async () => {
      throw new Error('boom');
    });
    const ok = run('car', async () => 42);
    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe(42);
  });
});
