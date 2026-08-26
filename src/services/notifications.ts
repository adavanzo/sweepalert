/**
 * Local-notification service on expo-notifications.
 *
 * Responsibilities:
 *  - request/report permission (with denied-state fallback for the UI)
 *  - schedule one OS notification per (enabled, future) reminder fire time
 *  - cancel a car's notifications and reschedule when the next cleaning advances
 *    or the car is moved.
 *
 * The store (state/store.ts) calls syncCarNotifications() whenever a car's
 * schedule, location, or reminders change.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { Car } from '../types';
import { computeFireTimes } from './scheduling';

// Foreground presentation: show the banner even when the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    // SDK 53+ split the banner/list presentation flags out explicitly.
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getPermissionState(): Promise<PermissionState> {
  const { status } = await Notifications.getPermissionsAsync();
  return status as PermissionState;
}

export async function requestPermission(): Promise<PermissionState> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('sweep', {
      name: 'Street-sweeping reminders',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  }
  return status as PermissionState;
}

/** Cancel every scheduled notification whose data.carId matches. */
export async function cancelCarNotifications(carId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { carId?: string })?.carId === carId)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Reconcile a car's OS notifications with its current reminders + next cleaning.
 * Cancels the car's existing notifications and re-schedules the future ones.
 * Returns the reminder->notificationId map so the store can persist it.
 */
export async function syncCarNotifications(car: Car): Promise<Record<string, string>> {
  await cancelCarNotifications(car.id);
  const ids: Record<string, string> = {};

  if (!car.schedule || car.nextCleaning == null) return ids;
  const perm = await getPermissionState();
  if (perm !== 'granted') return ids;

  const cleaning = new Date(car.nextCleaning);
  const fires = computeFireTimes(car.schedule, cleaning, car.reminders).filter((f) => !f.past);

  for (const f of fires) {
    const critical = f.reminder.channel === 'alarm';
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: critical ? `🚨 Move ${car.name}` : `🚗 Move ${car.name}`,
        body: `${car.schedule.scheduleLabel}. ${car.location?.address ?? car.schedule.address} — ${f.reminder.label}.`,
        data: { carId: car.id, reminderId: f.reminder.id },
        sound: 'default',
        ...(critical ? { priority: Notifications.AndroidNotificationPriority.MAX } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: f.fireAt,
        channelId: Platform.OS === 'android' ? 'sweep' : undefined,
      },
    });
    ids[f.reminder.id] = id;
  }
  return ids;
}

/** Fire an immediate local notification (used by the "Preview push" affordance). */
export async function firePreview(car?: Car): Promise<void> {
  const perm = await getPermissionState();
  if (perm !== 'granted') {
    if ((await requestPermission()) !== 'granted') return;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚗 Move your ${car?.name ?? 'car'}`,
      body: `${car?.schedule?.address ?? 'Beacon St'} cleaning starts soon. Tap to see open blocks nearby.`,
      data: { preview: true },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
  });
}
