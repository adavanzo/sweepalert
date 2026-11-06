/**
 * App foreground wiring. Kept out of store.ts so the store stays importable
 * under jest without a react-native AppState shim.
 *
 * On every background -> active transition, onAppActive() either retries a
 * failed hydration or runs a cheap non-forced refreshAll (cached schedules), so
 * countdowns and planned notifications don't go stale while the app is open.
 * (The store's own wake timer covers a sweep passing while it stays open.)
 */
import { AppState, AppStateStatus } from 'react-native';

import { log } from '../services/log';
import { onAppActive } from './store';

interface Sub {
  remove: () => void;
}

// On globalThis so a fast-refresh re-evaluation of this module can still find
// and remove the previous listener instead of stacking a duplicate.
const g = globalThis as { __sweepalertAppStateSub?: Sub };

/** Start listening; returns a cleanup. Safe to call repeatedly (one listener). */
export function startAppLifecycle(): () => void {
  g.__sweepalertAppStateSub?.remove();
  let last: AppStateStatus = AppState.currentState;
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active' && last !== 'active') {
      onAppActive().catch((err) => log.warn('[sweepalert] foreground refresh failed:', err));
    }
    last = next;
  });
  g.__sweepalertAppStateSub = sub;
  return () => {
    sub.remove();
    if (g.__sweepalertAppStateSub === sub) g.__sweepalertAppStateSub = undefined;
  };
}
