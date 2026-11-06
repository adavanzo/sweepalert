/**
 * App state (Zustand) with AsyncStorage persistence.
 *
 * The store owns the domain model (cars + reminders) and is the single place
 * that (a) resolves each car's cleaning schedule from the active provider,
 * (b) computes the next cleaning datetime, and (c) keeps OS notifications in
 * sync. Any mutation that can change fire times routes through refreshCar().
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { Car, ParkingSpot, Reminder } from '../types';
import { ThemeName as _ThemeName } from '../theme/tokens';
import { getProvider } from '../data/providers';
import { log } from '../services/log';
import { syncCarNotifications, cancelCarNotifications } from '../services/notifications';
import { seedCars, uid } from '../services/seed';
import { DefaultReminder, initialDefaultReminders, ReminderPreset } from '../services/presets';
import { sameTiming } from '../services/reminderTiming';
import { MAX_CARS, perCarCap } from '../services/scheduling';
import { migratePersisted, PERSIST_VERSION, shouldSeed } from './persistence';

// Re-export for convenience.
export type { ThemeName } from '../theme/tokens';
export { MAX_CARS } from '../services/scheduling';

interface StoreState {
  theme: _ThemeName;
  hydrated: boolean;
  /** Force the first-run empty state (Settings toggle / design "Empty state"). */
  showEmpty: boolean;
  /** Persisted: demo cars were seeded once (or this install predates the flag). */
  seeded: boolean;
  cars: Car[];
  /** Persisted: reminders every new car starts with (Settings → Default reminders). */
  defaultReminders: DefaultReminder[];
  /**
   * Not persisted: reading saved state failed this session. Writes are blocked
   * (so defaults never overwrite the user's real data) and hydration is retried
   * when the app returns to the foreground.
   */
  loadError: boolean;

  // ---- lifecycle ----
  init: () => Promise<void>;
  setTheme: (t: _ThemeName) => void;
  toggleTheme: () => void;
  toggleEmpty: () => void;

  // ---- car CRUD ----
  /**
   * Returns the new car's id, or null when nothing was added: already at
   * MAX_CARS, or saved state failed to load (loadError).
   */
  addCar: (input: { name: string; color: string; plate?: string; location?: ParkingSpot }) => Promise<string | null>;
  updateCar: (carId: string, patch: Partial<Pick<Car, 'name' | 'color' | 'plate'>>) => void;
  removeCar: (carId: string) => Promise<void>;
  /** Park/re-park a car: set location, resolve schedule, reschedule alerts. */
  parkCar: (carId: string, location: ParkingSpot) => Promise<void>;

  // ---- reminder CRUD (per car) ----
  /**
   * Adds a preset or custom reminder. Returns false (no-op) when the car
   * already has one with the same timing (offsetMinutes + override).
   */
  addReminder: (carId: string, preset: ReminderPreset) => Promise<boolean>;
  /** Change a reminder's timing/label (and channel). False on a duplicate timing. */
  updateReminder: (carId: string, reminderId: string, patch: ReminderPatch) => Promise<boolean>;
  removeReminder: (carId: string, reminderId: string) => Promise<void>;
  toggleReminder: (carId: string, reminderId: string) => Promise<void>;
  setReminderChannel: (carId: string, reminderId: string, channel: Reminder['channel']) => Promise<void>;

  // ---- global default reminders ----
  /** False on a duplicate timing or while saved state failed to load. */
  addDefaultReminder: (preset: ReminderPreset) => boolean;
  updateDefaultReminder: (id: string, patch: ReminderPatch) => boolean;
  removeDefaultReminder: (id: string) => void;
  setDefaultReminderChannel: (id: string, channel: Reminder['channel']) => void;
  /**
   * Replace every car's reminders with the defaults (fresh ids) and resync
   * each car's notifications. False (no-op) while saved state failed to load.
   */
  applyDefaultsToAllCars: () => Promise<boolean>;

  // ---- engine glue ----
  /** Recompute schedule + nextCleaning for a car and resync notifications. */
  refreshCar: (carId: string, force?: boolean) => Promise<void>;
  /**
   * Recompute every car: forced on init; non-forced (cached schedules, cheap)
   * when the app returns to the foreground and when a car's nextCleaning passes.
   */
  refreshAll: (force?: boolean) => Promise<void>;
}

export interface ReminderPatch {
  label: string;
  offsetMinutes: number;
  timeOfDayOverride?: string;
  channel?: Reminder['channel'];
}

/** Fresh, enabled car reminders from presets (addCar / applyDefaultsToAllCars). */
function remindersFrom(carId: string, presets: ReminderPreset[]): Reminder[] {
  return presets.map((p) => ({
    id: uid('rem'),
    carId,
    label: p.label,
    offsetMinutes: p.offsetMinutes,
    timeOfDayOverride: p.timeOfDayOverride || undefined,
    channel: p.channel,
    enabled: true,
  }));
}

/** Does any item other than `exceptId` already have this timing? */
function hasTiming<T extends { id: string; offsetMinutes: number; timeOfDayOverride?: string }>(
  items: T[],
  timing: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>,
  exceptId?: string,
): boolean {
  return items.some((r) => r.id !== exceptId && sameTiming(r, timing));
}

async function resolveSchedule(car: Car, force = false): Promise<Car> {
  const provider = getProvider();
  if (!car.location) {
    return { ...car, schedule: undefined, nextCleaning: null };
  }
  // `force` re-runs the live lookup even if a schedule is cached, so improved
  // resolution (neighborhood/cross-street matching) reaches already-parked cars.
  // Provider contract (providers/types.ts): null is an authoritative "no
  // schedule here" and clears the cached schedule; a throw (LookupFailedError,
  // e.g. offline) means "unknown" and keeps it. parkCar clears the schedule
  // first, so a new spot never inherits the old one.
  let schedule = car.schedule;
  if (force || !car.schedule) {
    try {
      schedule = (await provider.getScheduleForLocation(car.location.lat, car.location.lng)) ?? undefined;
    } catch (err) {
      log.warn('[sweepalert] schedule lookup failed, keeping cached schedule:', err);
    }
  }
  const next = schedule ? provider.getNextCleaning(schedule, new Date()) : null;
  // Includes the parked address: debug only.
  log.debug(
    `[sweepalert] ${car.name} @ ${car.location.address} -> ${schedule?.address ?? 'none'} · ` +
      `${schedule?.scheduleLabel ?? 'no schedule'} · next ${next ? next.toISOString() : 'n/a'}`,
  );
  return { ...car, schedule, nextCleaning: next ? next.getTime() : null };
}

// In-flight/completed init, so init() runs once even if called again (e.g. a
// second rehydrate) and never starts a concurrent refreshAll. Reset to null if
// init fails, so a later call (foreground / successful rehydrate) retries.
let initPromise: Promise<void> | null = null;

// In-flight refreshAll, so the foreground listener and wake timer coalesce
// onto a running refresh instead of stacking concurrent ones.
let refreshing: Promise<void> | null = null;
// Car ids the in-flight refreshAll loop iterates (set when the loop starts;
// null while it is still queued and will read the current list). A non-forced
// call may only piggyback when this matches the current cars: otherwise (e.g.
// addCar shrank perCarCap) cars the loop already synced keep a stale budget.
let refreshingIds: string | null = null;

const carIdsKey = (cars: Car[]) => cars.map((c) => c.id).join(',');

/**
 * Persistence write gate. Starts closed and opens only after a successful
 * hydration: until then the store holds defaults, and persist writes the whole
 * state on every set() — so a write before (or after a failed) hydration would
 * replace the user's saved cars with an empty list. Closed again if hydration
 * fails; reopened by a successful retry (see onRehydrateStorage).
 */
let persistBlocked = true;

const guardedStorage: StateStorage = {
  getItem: (name) => AsyncStorage.getItem(name),
  setItem: (name, value) => (persistBlocked ? undefined : AsyncStorage.setItem(name, value)),
  removeItem: (name) => (persistBlocked ? undefined : AsyncStorage.removeItem(name)),
};

/** Merge `fn` over one car's reminders (shared by the reminder CRUD actions). */
function updateReminders(cars: Car[], carId: string, fn: (rs: Reminder[]) => Reminder[]): Car[] {
  return cars.map((c) => (c.id === carId ? { ...c, reminders: fn(c.reminders) } : c));
}

// ---- wake timer: refresh when the soonest nextCleaning passes ----
// Long setTimeouts are unreliable on Android (and JS timers pause in the
// background anyway — the foreground listener covers that), so cap the delay
// and simply re-arm after each refresh.
export const WAKE_MAX_DELAY_MS = 6 * 3600_000;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

function armWakeTimer(): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  const soonest = useStore
    .getState()
    .cars.reduce((m, c) => (c.nextCleaning != null && c.nextCleaning < m ? c.nextCleaning : m), Infinity);
  if (!Number.isFinite(soonest)) return;
  // +1s so getNextCleaning (strictly after `now`) has moved past this sweep.
  const delay = Math.min(Math.max(soonest - Date.now() + 1000, 1000), WAKE_MAX_DELAY_MS);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    if (!useStore.getState().loadError) void useStore.getState().refreshAll();
  }, delay);
  // Node (jest) only: don't keep the process alive for this timer.
  (wakeTimer as { unref?: () => void }).unref?.();
}

let rehydrating: Promise<void> | null = null;

/**
 * App came back to the foreground (wired up in state/lifecycle.ts). If saved
 * state failed to load, retry hydration (success re-opens writes and runs
 * init). Otherwise make sure init ran, then do a cheap non-forced refresh so
 * nextCleaning and the planned notifications don't go stale while open.
 */
export function onAppActive(): Promise<void> {
  const s = useStore.getState();
  if (s.loadError) {
    if (!rehydrating) {
      rehydrating = Promise.resolve(useStore.persist.rehydrate()).finally(() => {
        rehydrating = null;
      });
    }
    return rehydrating;
  }
  if (!useStore.persist.hasHydrated()) return Promise.resolve(); // first hydration still running
  if (!initPromise) return s.init(); // a previous init failed: retry it
  return initPromise.then(() => useStore.getState().refreshAll());
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      hydrated: false,
      showEmpty: false,
      seeded: false,
      cars: [],
      defaultReminders: initialDefaultReminders(),
      loadError: false,

      init: () => {
        if (initPromise) return initPromise;
        initPromise = (async () => {
          // Seed demo cars on a genuine first launch only (see shouldSeed).
          const s = get();
          if (shouldSeed(s)) {
            set({ cars: seedCars(), seeded: true });
          } else if (!s.seeded && s.cars.length > 0) {
            set({ seeded: true });
          }
          // Re-resolve every car fresh so improved matching reaches already-
          // parked cars. Cached schedules are kept: if the lookup fails or comes
          // back empty (offline), resolveSchedule falls back to them.
          await get().refreshAll(true);
        })()
          .catch((err) => {
            log.warn('[sweepalert] init failed:', err);
            initPromise = null; // allow a later retry
          })
          .finally(() => set({ hydrated: true }));
        return initPromise;
      },

      setTheme: (t) => set({ theme: t }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleEmpty: () => set((s) => ({ showEmpty: !s.showEmpty })),

      addCar: async ({ name, color, plate, location }) => {
        // Saved state didn't load: the in-memory list isn't the user's real one,
        // and a car added now would vanish on a successful retry while its
        // scheduled alerts stayed behind (orphans nothing can cancel).
        if (get().loadError) {
          log.warn('[sweepalert] addCar refused: saved state failed to load');
          return null;
        }
        // Hard cap so every car keeps a useful share of iOS's 64 pending alerts.
        if (get().cars.length >= MAX_CARS) {
          log.warn(`[sweepalert] addCar refused: already at MAX_CARS (${MAX_CARS})`);
          return null;
        }
        const id = uid('car');
        const car: Car = {
          id,
          name: name.trim() || 'New car',
          color,
          plate: plate ?? 'MA — — —',
          location,
          reminders: remindersFrom(id, get().defaultReminders),
          createdAt: Date.now(),
        };
        set((s) => ({ cars: [...s.cars, car] }));
        const n = get().cars.length;
        // If the per-car notification budget just shrank (5th+ car), re-plan every
        // car so the total stays under iOS's pending limit; else just this one.
        if (perCarCap(n) < perCarCap(n - 1)) await get().refreshAll();
        else await get().refreshCar(id);
        return id;
      },

      updateCar: (carId, patch) =>
        set((s) => ({ cars: s.cars.map((c) => (c.id === carId ? { ...c, ...patch } : c)) })),

      removeCar: async (carId) => {
        // Remove first so an in-flight refreshCar sees the car is gone; the cancel
        // is queued after any in-flight sync for this car (per-car serialization).
        set((s) => ({ cars: s.cars.filter((c) => c.id !== carId) }));
        armWakeTimer();
        await cancelCarNotifications(carId);
      },

      parkCar: async (carId, location) => {
        if (get().loadError) return; // see addCar
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId ? { ...c, location, schedule: undefined, nextCleaning: undefined } : c,
          ),
        }));
        await get().refreshCar(carId);
      },

      addReminder: async (carId, preset) => {
        const car = get().cars.find((c) => c.id === carId);
        if (!car || hasTiming(car.reminders, preset)) return false;
        set((s) => ({ cars: updateReminders(s.cars, carId, (rs) => [...rs, ...remindersFrom(carId, [preset])]) }));
        await get().refreshCar(carId);
        return true;
      },

      updateReminder: async (carId, reminderId, patch) => {
        const car = get().cars.find((c) => c.id === carId);
        if (!car || !car.reminders.some((r) => r.id === reminderId)) return false;
        if (hasTiming(car.reminders, patch, reminderId)) return false;
        set((s) => ({
          cars: updateReminders(s.cars, carId, (rs) =>
            rs.map((r) =>
              r.id === reminderId
                ? {
                    ...r,
                    label: patch.label,
                    offsetMinutes: patch.offsetMinutes,
                    timeOfDayOverride: patch.timeOfDayOverride || undefined,
                    channel: patch.channel ?? r.channel,
                  }
                : r,
            ),
          ),
        }));
        await get().refreshCar(carId);
        return true;
      },

      removeReminder: async (carId, reminderId) => {
        set((s) => ({ cars: updateReminders(s.cars, carId, (rs) => rs.filter((r) => r.id !== reminderId)) }));
        await get().refreshCar(carId);
      },

      toggleReminder: async (carId, reminderId) => {
        set((s) => ({
          cars: updateReminders(s.cars, carId, (rs) =>
            rs.map((r) => (r.id === reminderId ? { ...r, enabled: !r.enabled } : r)),
          ),
        }));
        await get().refreshCar(carId);
      },

      setReminderChannel: async (carId, reminderId, channel) => {
        set((s) => ({
          cars: updateReminders(s.cars, carId, (rs) =>
            rs.map((r) => (r.id === reminderId ? { ...r, channel, enabled: true } : r)),
          ),
        }));
        await get().refreshCar(carId);
      },

      addDefaultReminder: (preset) => {
        const s = get();
        if (s.loadError || hasTiming(s.defaultReminders, preset)) return false;
        set({
          defaultReminders: [
            ...s.defaultReminders,
            {
              id: uid('def'),
              label: preset.label,
              offsetMinutes: preset.offsetMinutes,
              timeOfDayOverride: preset.timeOfDayOverride || undefined,
              channel: preset.channel,
            },
          ],
        });
        return true;
      },

      updateDefaultReminder: (id, patch) => {
        const s = get();
        if (s.loadError || !s.defaultReminders.some((d) => d.id === id)) return false;
        if (hasTiming(s.defaultReminders, patch, id)) return false;
        set({
          defaultReminders: s.defaultReminders.map((d) =>
            d.id === id
              ? {
                  ...d,
                  label: patch.label,
                  offsetMinutes: patch.offsetMinutes,
                  timeOfDayOverride: patch.timeOfDayOverride || undefined,
                  channel: patch.channel ?? d.channel,
                }
              : d,
          ),
        });
        return true;
      },

      removeDefaultReminder: (id) => {
        if (get().loadError) return;
        set((s) => ({ defaultReminders: s.defaultReminders.filter((d) => d.id !== id) }));
      },

      setDefaultReminderChannel: (id, channel) => {
        if (get().loadError) return;
        set((s) => ({ defaultReminders: s.defaultReminders.map((d) => (d.id === id ? { ...d, channel } : d)) }));
      },

      applyDefaultsToAllCars: async () => {
        if (get().loadError) return false; // see addCar
        const defaults = get().defaultReminders;
        set((s) => ({ cars: s.cars.map((c) => ({ ...c, reminders: remindersFrom(c.id, defaults) })) }));
        // Per car (like the reminder CRUD actions) rather than refreshAll: a
        // non-forced refreshAll could piggyback on an in-flight one that already
        // synced some cars with their old reminders.
        for (const c of get().cars) {
          await get().refreshCar(c.id);
        }
        return true;
      },

      refreshCar: async (carId, force = false) => {
        const car = get().cars.find((c) => c.id === carId);
        if (!car) return;
        const resolved = await resolveSchedule(car, force);
        // The lookup can be slow (launch refreshes every car over the network), so
        // re-read the car: if it was removed or re-parked meanwhile, this result is
        // stale — the newer mutation runs its own refresh. Otherwise apply the
        // schedule onto the *current* record so concurrent edits aren't reverted.
        const cur = get().cars.find((c) => c.id === carId);
        if (!cur || cur.location !== car.location) return;
        const target: Car = { ...cur, schedule: resolved.schedule, nextCleaning: resolved.nextCleaning };
        const notifIds = await syncCarNotifications(target, perCarCap(get().cars.length));
        const after = get().cars.find((c) => c.id === carId);
        if (!after) {
          // Removed while we were scheduling: don't leave orphan alerts behind.
          await cancelCarNotifications(carId);
          return;
        }
        if (after.location !== car.location) return;
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId
              ? {
                  ...c,
                  schedule: resolved.schedule,
                  nextCleaning: resolved.nextCleaning,
                  reminders: c.reminders.map((r) => ({ ...r, notificationId: notifIds[r.id] })),
                }
              : c,
          ),
        }));
        armWakeTimer();
      },

      refreshAll: (force = false) => {
        // A non-forced refresh (foreground / wake timer) piggybacks on one that
        // is already running over the same cars; a forced one, or one whose car
        // list changed (addCar re-planning budgets), waits for it, then runs in full.
        if (refreshing && !force && (refreshingIds === null || refreshingIds === carIdsKey(get().cars))) {
          return refreshing;
        }
        const run = (refreshing ?? Promise.resolve())
          .catch(() => undefined)
          .then(async () => {
            const cars = get().cars;
            if (refreshing === run) refreshingIds = carIdsKey(cars);
            for (const c of cars) {
              // Sequential to keep notification scheduling ordered & predictable.
              await get().refreshCar(c.id, force);
            }
            armWakeTimer();
          })
          .finally(() => {
            if (refreshing === run) {
              refreshing = null;
              refreshingIds = null;
            }
          });
        refreshing = run;
        refreshingIds = null; // queued: will read the current list when it starts
        return run;
      },
    }),
    {
      name: 'sweepalert-v1',
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => guardedStorage),
      // Only persist the durable domain data; derived fields are recomputed.
      partialize: (s) => ({
        theme: s.theme,
        showEmpty: s.showEmpty,
        seeded: s.seeded,
        cars: s.cars,
        defaultReminders: s.defaultReminders,
      }),
      // < v3 drops cached schedules; < v4 marks existing installs as seeded;
      // < v5 adds the initial default reminders.
      migrate: (persisted, fromVersion) => migratePersisted(persisted, fromVersion) as StoreState,
      onRehydrateStorage: () => (_state, error) => {
        // Kick the engine once persisted state is back. This is the only init
        // call site, so seeding never sees the pre-hydration empty cars list.
        // (AsyncStorage is async, so useStore is assigned by now.)
        if (error) {
          // Hydration failed (storage read / parse / migrate threw): the store
          // still holds defaults, and any set() would persist them over the
          // user's real data — so keep writes blocked, don't seed, and flag the
          // UI. onAppActive retries hydration when the app is foregrounded.
          log.warn('[sweepalert] hydration failed; blocking writes and skipping init:', error);
          persistBlocked = true;
          useStore.setState({ loadError: true });
          return;
        }
        // Real data is in memory now: open the write gate, then run the engine.
        // init() is guarded by initPromise, so a later successful retry after a
        // failure runs it, and a redundant rehydrate doesn't run it twice.
        persistBlocked = false;
        if (useStore.getState().loadError) useStore.setState({ loadError: false });
        useStore.getState().init();
      },
    },
  ),
);
