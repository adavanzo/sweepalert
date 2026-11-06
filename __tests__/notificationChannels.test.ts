import {
  ANDROID_CHANNEL_DEFAULT,
  ANDROID_CHANNEL_URGENT,
  CHANNEL_LABELS,
  deliveryFor,
  URGENT_HELP,
} from '../src/services/notificationChannels';

describe('notification channel routing', () => {
  it('routes urgent ("alarm") reminders to the urgent Android channel and iOS time-sensitive', () => {
    expect(deliveryFor('alarm')).toEqual({ androidChannelId: ANDROID_CHANNEL_URGENT, iosInterruptionLevel: 'timeSensitive' });
    expect(ANDROID_CHANNEL_URGENT).toBe('sweep-urgent');
  });

  it('keeps push reminders on the default channel as normal notifications', () => {
    expect(deliveryFor('push')).toEqual({ androidChannelId: ANDROID_CHANNEL_DEFAULT, iosInterruptionLevel: 'active' });
    expect(ANDROID_CHANNEL_DEFAULT).toBe('sweep');
  });

  it('never claims Critical alerts', () => {
    expect(CHANNEL_LABELS.alarm).toBe('Urgent');
    expect(URGENT_HELP).toMatch(/can’t bypass silent mode/);
    // This build has no time-sensitive entitlement, so iOS can't break through Focus.
    expect(URGENT_HELP).not.toMatch(/focus/i);
    expect(Object.values(CHANNEL_LABELS).join(' ')).not.toMatch(/critical/i);
  });
});
