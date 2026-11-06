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
import { createJSONStorage, persist } from 'zustand/middleware';

import { Car, ParkingSpot, Reminder } from '../types';
import { ThemeName as _ThemeName } from '../theme/tokens';
import { getProvider } from '../data/providers';
import { syncCarNotifications, cancelCarNotifications } from '../services/notifications';
import { seedCars, uid } from '../services/seed';
import { ReminderPreset } from '../services/presets';
import { perCarCap } from '../services/scheduling';
import { migratePersisted, PERSIST_VERSION, shouldSeed } from './persistence';

// Re-export for convenience.
export type { ThemeName } from '../theme/tokens';

interface StoreState {
  theme: _ThemeName;
  hydrated: boolean;
  /** Force the first-run empty state (Settings toggle / design "Empty state"). */
  showEmpty: boolean;
  /** Persisted: demo cars were seeded once (or this install predates the flag). */
  seeded: boolean;
  cars: Car[];

  // ---- lifecycle ----
  init: () => Promise<void>;
  setTheme: (t: _ThemeName) => void;
  toggleTheme: () => void;
  toggleEmpty: () => void;

  // ---- car CRUD ----
  addCar: (input: { name: string; color: string; plate?: string; location?: ParkingSpot }) => Promise<string>;
  updateCar: (carId: string, patch: Partial<Pick<Car, 'name' | 'color' | 'plate'>>) => void;
  removeCar: (carId: string) => Promise<void>;
  /** Park/re-park a car: set location, resolve schedule, reschedule alerts. */
  parkCar: (carId: string, location: ParkingSpot) => Promise<void>;

  // ---- reminder CRUD (per car) ----
  addReminder: (carId: string, preset: ReminderPreset) => Promise<void>;
  removeReminder: (carId: string, reminderId: string) => Promise<void>;
  toggleReminder: (carId: string, reminderId: string) => Promise<void>;
  setReminderChannel: (carId: string, reminderId: string, channel: Reminder['channel']) => Promise<void>;

  // ---- engine glue ----
  /** Recompute schedule + nextCleaning for a car and resync notifications. */
  refreshCar: (carId: string, force?: boolean) => Promise<void>;
  /** Recompute every car (called on init and when the day rolls over). */
  refreshAll: (force?: boolean) => Promise<void>;
}

async function resolveSchedule(car: Car, force = false): Promise<Car> {
  const provider = getProvider();
  if (!car.location) {
    return { ...car, schedule: undefined, nextCleaning: null };
  }
  // `force` re-runs the live lookup even if a schedule is cached, so improved
  // resolution (neighborhood/cross-street matching) reaches already-parked cars.
  // A null/failed lookup (e.g. offline) keeps the existing schedule rather than
  // wiping it. parkCar clears the schedule first, so a new spot never inherits it.
  let fetched = car.schedule;
  if (force || !car.schedule) {
    try {
      fetched = (await provider.getScheduleForLocation(car.location.lat, car.location.lng)) ?? car.schedule;
    } catch (err) {
      console.warn('[sweepalert] schedule lookup failed, keeping cached schedule:', err);
    }
  }
  const schedule = fetched ?? undefined;
  const next = schedule ? provider.getNextCleaning(schedule, new Date()) : null;
  console.log(
    `[sweepalert] ${car.name} @ ${car.location.address} -> ${schedule?.address ?? 'none'} · ` +
      `${schedule?.scheduleLabel ?? 'no schedule'} · next ${next ? next.toISOString() : 'n/a'}`,
  );
  return { ...car, schedule, nextCleaning: next ? next.getTime() : null };
}

// In-flight/completed init, so init() runs once even if called again (e.g. a
// second rehydrate) and never starts a concurrent refreshAll.
let initPromise: Promise<void> | null = null;

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      hydrated: false,
      showEmpty: false,
      seeded: false,
      cars: [],

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
            console.warn('[sweepalert] init failed:', err);
            initPromise = null; // allow a later retry
          })
          .finally(() => set({ hydrated: true }));
        return initPromise;
      },

      setTheme: (t) => set({ theme: t }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleEmpty: () => set((s) => ({ showEmpty: !s.showEmpty })),

      addCar: async ({ name, color, plate, location }) => {
        const id = uid('car');
        const car: Car = {
          id,
          name: name.trim() || 'New car',
          color,
          plate: plate ?? 'MA — — —',
          location,
          reminders: [
            {
              id: uid('rem'),
              carId: id,
              label: 'Night before at 8pm',
              offsetMinutes: 24 * 60,
              timeOfDayOverride: '20:00',
              channel: 'push',
              enabled: true,
            },
          ],
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
        await cancelCarNotifications(carId);
      },

      parkCar: async (carId, location) => {
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId ? { ...c, location, schedule: undefined, nextCleaning: undefined } : c,
          ),
        }));
        await get().refreshCar(carId);
      },

      addReminder: async (carId, preset) => {
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId
              ? {
                  ...c,
                  reminders: [
                    ...c.reminders,
                    {
                      id: uid('rem'),
                      carId,
                      label: preset.label,
                      offsetMinutes: preset.offsetMinutes,
                      timeOfDayOverride: preset.timeOfDayOverride,
                      channel: preset.channel,
                      enabled: true,
                    },
                  ],
                }
              : c,
          ),
        }));
        await get().refreshCar(carId);
      },

      removeReminder: async (carId, reminderId) => {
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId ? { ...c, reminders: c.reminders.filter((r) => r.id !== reminderId) } : c,
          ),
        }));
        await get().refreshCar(carId);
      },

      toggleReminder: async (carId, reminderId) => {
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId
              ? {
                  ...c,
                  reminders: c.reminders.map((r) =>
                    r.id === reminderId ? { ...r, enabled: !r.enabled } : r,
                  ),
                }
              : c,
          ),
        }));
        await get().refreshCar(carId);
      },

      setReminderChannel: async (carId, reminderId, channel) => {
        set((s) => ({
          cars: s.cars.map((c) =>
            c.id === carId
              ? {
                  ...c,
                  reminders: c.reminders.map((r) =>
                    r.id === reminderId ? { ...r, channel, enabled: true } : r,
                  ),
                }
              : c,
          ),
        }));
        await get().refreshCar(carId);
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
      },

      refreshAll: async (force = false) => {
        const cars = get().cars;
        for (const c of cars) {
          // Sequential to keep notification scheduling ordered & predictable.
          // eslint-disable-next-line no-await-in-loop
          await get().refreshCar(c.id, force);
        }
      },
    }),
    {
      name: 'sweepalert-v1',
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the durable domain data; derived fields are recomputed.
      partialize: (s) => ({ theme: s.theme, showEmpty: s.showEmpty, seeded: s.seeded, cars: s.cars }),
      // < v3 drops cached schedules; < v4 marks existing installs as seeded.
      migrate: (persisted, fromVersion) => migratePersisted(persisted, fromVersion) as StoreState,
      onRehydrateStorage: () => (_state, error) => {
        // Kick the engine once persisted state is back. This is the only init
        // call site, so seeding never sees the pre-hydration empty cars list.
        // (AsyncStorage is async, so useStore is assigned by now.)
        if (error) {
          // Hydration failed (storage read / parse / migrate threw): the store
          // still holds defaults, and any set() would persist them over the
          // user's real data — so don't seed or write anything this launch.
          console.warn('[sweepalert] hydration failed; skipping init:', error);
          return;
        }
        useStore.getState().init();
      },
    },
  ),
);
