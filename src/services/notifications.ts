/**
 * Local-notification service on expo-notifications.
 *
 * Responsibilities:
 *  - request/report permission (with denied-state fallback for the UI)
 *  - schedule one OS notification per (enabled, future) reminder fire time for
 *    each of the next few cleanings (planCarNotifications in scheduling.ts), so
 *    alerts keep coming even if the app isn't reopened between sweeps
 *  - cancel a car's notifications and reschedule when the next cleaning advances
 *    or the car is moved.
 *
 * The store (state/store.ts) calls syncCarNotifications() whenever a car's
 * schedule, location, or reminders change.
 */
import * as Notifications from 'expo-notifications';
import { DateTime } from 'luxon';
import { Platform } from 'react-native';

import { Car } from '../types';
import { log } from './log';
import { ANDROID_CHANNEL_DEFAULT, ANDROID_CHANNEL_URGENT, deliveryFor } from './notificationChannels';
import { MAX_PER_CAR, planCarNotifications } from './scheduling';
import { keyedSerial } from './serial';

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
  await ensureAndroidChannels();
  return status as PermissionState;
}

let channelsReady: Promise<void> | null = null;

/**
 * Create the two Android channels once per process (idempotent; a no-op on
 * iOS/web). Called before every schedule, not only from requestPermission, so
 * an install that granted permission earlier still gets 'sweep-urgent'.
 * Android won't change an existing channel's importance from code, so installs
 * that created 'sweep' at MAX before keep it there — harmless.
 */
export function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelsReady) {
    channelsReady = Promise.all([
      Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_DEFAULT, {
        name: 'Street-sweeping reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      }),
      Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_URGENT, {
        name: 'Urgent street-sweeping reminders',
        description: 'Reminders you marked Urgent',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 500, 250, 500, 250, 500],
        enableVibrate: true,
        enableLights: true,
        lightColor: '#b3261e',
      }),
    ])
      .then(() => undefined)
      .catch((err) => {
        channelsReady = null; // retry next time
        log.warn('[sweepalert] could not create notification channels:', err);
      });
  }
  return channelsReady;
}

// Cancel/sync calls for the same car run one at a time, so two concurrent
// syncs (e.g. launch refresh + a reminder toggle) can't both cancel and then
// both schedule, leaving duplicate sets behind.
const perCar = keyedSerial();

/** Cancel every scheduled notification whose data.carId matches. */
export function cancelCarNotifications(carId: string): Promise<void> {
  return perCar(carId, () => cancelNow(carId));
}

async function cancelNow(carId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { carId?: string })?.carId === carId)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Reconcile a car's OS notifications with its current reminders + schedule.
 * Cancels the car's existing notifications and re-schedules the planned ones
 * (next CLEANINGS_AHEAD cleanings, capped at `maxPerCar` — the store passes
 * perCarCap(cars) so all cars together stay under iOS's 64; see scheduling.ts).
 * Serialized per car with cancelCarNotifications.
 * Returns reminderId -> id of that reminder's soonest notification so the store
 * can persist it.
 */
export function syncCarNotifications(car: Car, maxPerCar: number = MAX_PER_CAR): Promise<Record<string, string>> {
  return perCar(car.id, () => syncNow(car, maxPerCar));
}

async function syncNow(car: Car, maxPerCar: number): Promise<Record<string, string>> {
  await cancelNow(car.id);
  const ids: Record<string, string> = {};

  const schedule = car.schedule;
  if (!schedule) return ids;
  const perm = await getPermissionState();
  if (perm !== 'granted') return ids;
  await ensureAndroidChannels();

  // Plan is sorted soonest first, so the first id per reminder is its soonest.
  for (const p of planCarNotifications(car, new Date(), undefined, maxPerCar)) {
    const urgent = p.reminder.channel === 'alarm';
    const delivery = deliveryFor(p.reminder.channel);
    const when = DateTime.fromJSDate(p.cleaning, { zone: schedule.timezone }).toFormat('ccc LLL d, h:mm a');
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: urgent ? `🚨 Move ${car.name}` : `🚗 Move ${car.name}`,
        body: `Sweeping ${when}. ${car.location?.address ?? schedule.address} — ${p.reminder.label}.`,
        data: { carId: car.id, reminderId: p.reminder.id, cleaning: p.cleaning.getTime() },
        sound: 'default',
        // iOS: time-sensitive needs an entitlement this build doesn't carry;
        // without it iOS delivers the notification as 'active' (see README).
        interruptionLevel: delivery.iosInterruptionLevel,
        // Android 8+ takes importance from the channel; priority only matters
        // on Android 7 (still within Expo 54's minSdk 24), so it stays.
        ...(urgent ? { priority: Notifications.AndroidNotificationPriority.MAX } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.fireAt,
        channelId: Platform.OS === 'android' ? delivery.androidChannelId : undefined,
      },
    });
    if (!ids[p.reminder.id]) ids[p.reminder.id] = id;
  }
  return ids;
}

/** Fire an immediate local notification (used by the "Preview push" affordance). */
export async function firePreview(car?: Car): Promise<void> {
  const perm = await getPermissionState();
  if (perm !== 'granted') {
    if ((await requestPermission()) !== 'granted') return;
  }
  await ensureAndroidChannels();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚗 Move your ${car?.name ?? 'car'}`,
      body: `${car?.schedule?.address ?? 'Beacon St'} cleaning starts soon. Tap to see open blocks nearby.`,
      data: { preview: true },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_DEFAULT : undefined,
    },
  });
}
