/**
 * Seeded demo state so the app runs end-to-end on first launch with zero setup.
 * Mirrors the three cars in the SweepAlert design. Schedules and next-cleaning
 * times are computed live by the store from each car's parked location, so the
 * countdowns are always real relative to "now".
 */
import { Car, ParkingSpot, Reminder } from '../types';
import { CAR_PAINTS } from '../theme/tokens';
import { SNAPSHOT_BLOCKS } from '../data/snapshot';
import { presetByLabel } from './presets';

let seq = 1;
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

function spotForBlock(carId: string, blockIdx: number): ParkingSpot {
  const b = SNAPSHOT_BLOCKS[blockIdx];
  return {
    carId,
    lat: b.lat,
    lng: b.lng,
    address: b.address,
    blockId: b.blockId,
    savedAt: Date.now(),
  };
}

function reminder(carId: string, label: string, enabled: boolean, channelOverride?: Reminder['channel']): Reminder {
  const p = presetByLabel(label);
  return {
    id: uid('rem'),
    carId,
    label,
    offsetMinutes: p?.offsetMinutes ?? 0,
    timeOfDayOverride: p?.timeOfDayOverride,
    channel: channelOverride ?? p?.channel ?? 'push',
    enabled,
  };
}

export function seedCars(): Car[] {
  const now = Date.now();

  const subaruId = uid('car');
  const vanId = uid('car');
  const jeepId = uid('car');

  return [
    {
      id: subaruId,
      name: "Alli's Subaru",
      plate: 'MA 4RK 219',
      color: CAR_PAINTS[0],
      location: spotForBlock(subaruId, 0),
      reminders: [
        reminder(subaruId, 'Night before at 8pm', true, 'push'),
        reminder(subaruId, '2 hours before', true, 'push'),
        reminder(subaruId, '30 min before', true, 'alarm'),
      ],
      createdAt: now,
    },
    {
      id: vanId,
      name: 'Work van',
      plate: 'MA V88 042',
      color: CAR_PAINTS[1],
      location: spotForBlock(vanId, 3),
      reminders: [
        reminder(vanId, 'Night before at 8pm', true, 'push'),
        reminder(vanId, '1 hour before', false, 'alarm'),
      ],
      createdAt: now,
    },
    {
      id: jeepId,
      name: 'Weekend Jeep',
      plate: 'MA 7TT 553',
      color: CAR_PAINTS[2],
      location: spotForBlock(jeepId, 1),
      reminders: [reminder(jeepId, 'Night before at 8pm', true, 'push')],
      createdAt: now,
    },
  ];
}
