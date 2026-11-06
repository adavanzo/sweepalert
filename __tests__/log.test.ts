import { log, redact } from '../src/services/log';

const g = globalThis as { __DEV__?: boolean };

describe('log', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete g.__DEV__;
  });

  it('debug prints only when __DEV__ is true', () => {
    log.debug('a'); // __DEV__ undefined (e.g. tests / non-RN)
    g.__DEV__ = false;
    log.debug('b');
    expect(logSpy).not.toHaveBeenCalled();
    g.__DEV__ = true;
    log.debug('c', 1);
    expect(logSpy).toHaveBeenCalledWith('c', 1);
  });

  it('warn prints the full detail in development', () => {
    g.__DEV__ = true;
    const err = new Error('at 42.35123,-71.08123');
    log.warn('[x] failed:', err);
    expect(warnSpy).toHaveBeenCalledWith('[x] failed:', err);
  });

  it('warn always prints in production, with coordinates masked and objects dropped', () => {
    g.__DEV__ = false;
    log.warn('[x] failed:', new Error('no block near 42.35123, -71.08123'));
    expect(warnSpy).toHaveBeenLastCalledWith('[x] failed:', 'Error: no block near <coord>, <coord>');
    log.warn('[x] failed:', { address: '123 Beacon St' });
    expect(warnSpy).toHaveBeenLastCalledWith('[x] failed:', 'object');
    log.warn('[x] plain');
    expect(warnSpy).toHaveBeenLastCalledWith('[x] plain');
  });

  it('redact keeps short numbers like HTTP statuses', () => {
    expect(redact(new Error('CKAN HTTP 503'))).toBe('Error: CKAN HTTP 503');
  });
});
