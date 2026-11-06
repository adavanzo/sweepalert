/**
 * Pure routing of a reminder's channel to OS delivery options (no Expo
 * imports, so it is unit-tested under node in __tests__/notificationChannels.test.ts).
 *
 * The stored channel value stays 'alarm' for compatibility with saved data;
 * the UI calls it "Urgent". What it actually does:
 *  - iOS: interruptionLevel 'timeSensitive', which breaks through Focus when
 *    the user allows it — but only if the app carries the time-sensitive
 *    entitlement. This build doesn't (free-team signing), so iOS delivers it as
 *    a normal 'active' notification. It never bypasses silent mode (that would
 *    be a Critical Alert, which needs Apple's approval).
 *  - Android: the 'sweep-urgent' channel (MAX importance, vibration, lights).
 */
import { Channel } from '../types';

export const ANDROID_CHANNEL_DEFAULT = 'sweep';
export const ANDROID_CHANNEL_URGENT = 'sweep-urgent';

export const CHANNEL_LABELS: Record<Channel, string> = { push: 'Push', alarm: 'Urgent' };

/**
 * Matches this build: no time-sensitive entitlement, so nothing about Focus.
 * If the entitlement is added (paid team, see README), this can mention it.
 */
export const URGENT_HELP =
  'Urgent uses a high-priority channel on Android. On iOS it’s delivered as a normal notification unless the app is built with Time Sensitive notifications. It can’t bypass silent mode.';

export interface DeliveryOptions {
  androidChannelId: string;
  iosInterruptionLevel: 'active' | 'timeSensitive';
}

export function deliveryFor(channel: Channel): DeliveryOptions {
  return channel === 'alarm'
    ? { androidChannelId: ANDROID_CHANNEL_URGENT, iosInterruptionLevel: 'timeSensitive' }
    : { androidChannelId: ANDROID_CHANNEL_DEFAULT, iosInterruptionLevel: 'active' };
}
