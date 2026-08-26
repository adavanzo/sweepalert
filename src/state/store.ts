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

// Re-export for convenience.
export type { ThemeName } from '../theme/tokens';

interface StoreState {
  theme: _ThemeName;
  hydrated: boolean;
  /** Force the first-run empty state (Settings toggle / design "Empty state"). */
  showEmpty: boolean;
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
  // A null/failed lookup keeps the existing schedule rather than wiping it.
  const fetched =
    !force && car.schedule
      ? car.schedule
      : (await provider.getScheduleForLocation(car.location.lat, car.location.lng)) ?? car.schedule;
  const schedule = fetched ?? undefined;
  const next = schedule ? provider.getNextCleaning(schedule, new Date()) : null;
  console.log(
    `[sweepalert] ${car.name} @ ${car.location.address} -> ${schedule?.address ?? 'none'} · ` +
      `${schedule?.scheduleLabel ?? 'no schedule'} · next ${next ? next.toISOString() : 'n/a'}`,
  );
  return { ...car, schedule, nextCleaning: next ? next.getTime() : null };
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      hydrated: false,
      showEmpty: false,
      cars: [],

      init: async () => {
        // Seed on very first launch (no persisted cars yet).
        if (get().cars.length === 0 && !get().showEmpty) {
          set({ cars: seedCars() });
        }
        // Unconditionally drop any cached schedule on launch, then re-resolve
        // fresh — guarantees improved matching reaches already-parked cars
        // regardless of persisted migration state.
        set((s) => ({
          cars: s.cars.map((c) => ({ ...c, schedule: undefined, nextCleaning: undefined })),
        }));
        await get().refreshAll(true);
        set({ hydrated: true });
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
        await get().refreshCar(id);
        return id;
      },

      updateCar: (carId, patch) =>
        set((s) => ({ cars: s.cars.map((c) => (c.id === carId ? { ...c, ...patch } : c)) })),

      removeCar: async (carId) => {
        await cancelCarNotifications(carId);
        set((s) => ({ cars: s.cars.filter((c) => c.id !== carId) }));
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
        const notifIds = await syncCarNotifications(resolved);
        const withIds: Car = {
          ...resolved,
          reminders: resolved.reminders.map((r) => ({ ...r, notificationId: notifIds[r.id] })),
        };
        set((s) => ({ cars: s.cars.map((c) => (c.id === carId ? withIds : c)) }));
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
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the durable domain data; derived fields are recomputed.
      partialize: (s) => ({ theme: s.theme, showEmpty: s.showEmpty, cars: s.cars }),
      // v2: drop cached schedules so cars re-resolve with the improved block
      // matching (SAM cross-street disambiguation). Runs once per device.
      migrate: (persisted, fromVersion) => {
        const p = persisted as { cars?: Car[] } | undefined;
        if (p?.cars && fromVersion < 3) {
          p.cars = p.cars.map((c) => ({ ...c, schedule: undefined, nextCleaning: undefined }));
        }
        return p as StoreState;
      },
      onRehydrateStorage: () => (state) => {
        // Kick the engine once persisted state is back.
        state?.init();
      },
    },
  ),
);
