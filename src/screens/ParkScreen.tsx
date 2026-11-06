import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import MapView, { LatLng } from 'react-native-maps';

import { T } from '../components/primitives';
import { Screen } from '../components/Screen';
import { RootTabParamList } from '../navigation/types';
import { getProvider } from '../data/providers';
import { isAlley, nearestSegment } from '../data/providers/samSegments';
import {
  getCurrentCoord,
  getPermissionState,
  requestPermission,
  reverseGeocodeParts,
} from '../services/location';
import { log } from '../services/log';
import * as nfc from '../services/nfc';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';
import { CleaningSchedule, ParkingSpot } from '../types';
import { CaptureControls, CaptureMode } from './park/CaptureControls';
import { CarAssignPicker } from './park/CarAssignPicker';
import { DetectedBlockCard } from './park/DetectedBlockCard';
import { BOSTON, ParkMap } from './park/ParkMap';
import { SaveSpotAction } from './park/SaveSpotAction';
import { StreetPicker } from './park/StreetPicker';

type Props = BottomTabScreenProps<RootTabParamList, 'Park'>;

// ParkScreen owns all state and side effects (geocoding, GPS / NFC capture,
// saving); the pieces under ./park are presentational and take explicit props.

export function ParkScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const cars = useStore((s) => s.cars);
  const parkCar = useStore((s) => s.parkCar);

  const initialCarId = route.params?.carId ?? cars[0]?.id;
  const [assignId, setAssignId] = useState<string | undefined>(initialCarId);
  const [capture, setCapture] = useState<CaptureMode>('gps');
  const [coord, setCoord] = useState({ latitude: BOSTON.latitude, longitude: BOSTON.longitude });
  const [address, setAddress] = useState<string>('');
  const [schedule, setSchedule] = useState<CleaningSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [located, setLocated] = useState(false);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [streetCandidates, setStreetCandidates] = useState<string[]>([]);
  const [samNeighborhood, setSamNeighborhood] = useState<string | undefined>(undefined);
  const didAutoLocate = useRef(false);
  const lastAutoNonce = useRef<number | undefined>(undefined);
  const mapRef = useRef<MapView>(null);

  // Keep assign selection in sync if navigated with a specific car.
  useEffect(() => {
    if (route.params?.carId) setAssignId(route.params.carId);
  }, [route.params?.carId]);

  // Whenever the pin moves (GPS, tap, or drag), reverse-geocode the exact
  // coordinate for the real street address, and resolve its cleaning schedule.
  // The displayed address always comes from the geocoder — never from bundled
  // seed data — so it reflects where you actually are.
  useEffect(() => {
    let alive = true;
    setGeocoding(true);
    const lat = coord.latitude;
    const lng = coord.longitude;
    (async () => {
      // Reverse-geocode first (memoized) so we know the city before the rest.
      const parts = await reverseGeocodeParts(lat, lng);
      const city = (parts.city ?? '').toLowerCase();
      const isBoston = city.includes('boston');
      const isCambridge = city.includes('cambridge');
      const [s, seg] = await Promise.all([
        // The provider throws (LookupFailedError) when it can't answer — offline,
        // service error. For this preview that reads as "no data" rather than
        // leaving the card stuck on "Locating…".
        getProvider()
          .getScheduleForLocation(lat, lng)
          .catch((err) => {
            log.warn('[ParkScreen] schedule lookup failed:', err);
            return null;
          }),
        // The street-name selector is Boston-only (SAM). Skip it elsewhere so
        // Cambridge doesn't show Boston streets from across the river.
        isBoston ? nearestSegment(lat, lng).catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setAddress(parts.full);
      setSchedule(s);
      // Unsupported = not in a covered city (Boston / Cambridge).
      setUnsupported(!isBoston && !isCambridge);
      setStreetCandidates(seg?.candidates ?? []);
      setSamNeighborhood(seg?.neighborhood);
      setGeocoding(false);
    })();
    return () => {
      alive = false;
    };
  }, [coord.latitude, coord.longitude]);

  // Re-resolve for a street the user explicitly picks. Pass the nearby cross
  // streets + neighborhood so it lands on the correct block of that street.
  const chooseStreet = async (street: string) => {
    setBusy(true);
    try {
      const prov = getProvider();
      const s = prov.getScheduleForStreet
        ? await prov.getScheduleForStreet(street, {
            neighborhood: samNeighborhood,
            crossStreets: streetCandidates,
          })
        : null;
      setSchedule(s);
      setSaved(false);
    } catch (err) {
      // Lookup failed (offline / service error): keep the current schedule.
      log.warn('[ParkScreen] street lookup failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const locateWithGps = async ({ silent = false }: { silent?: boolean } = {}) => {
    setBusy(true);
    setCapture('gps');
    try {
      const fix = await getCurrentCoord({
        targetAccuracyM: 8,
        timeoutMs: 9000,
        minSampleMs: 4000,
        // Tighten the pin + accuracy readout live as GPS converges.
        onProgress: (c) => {
          const next = { latitude: c.lat, longitude: c.lng };
          setLocated(true);
          setAccuracyM(c.accuracy ?? null);
          setCoord(next);
          setSaved(false);
          mapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 350);
        },
      });
      if (!fix) {
        setPermDenied(true);
        if (!silent) {
          Alert.alert(
            'Location permission needed',
            'Enable location to save your spot from GPS. You can still drag the pin manually.',
          );
        }
        return;
      }
      setPermDenied(false);
      setAccuracyM(fix.accuracy ?? null);
    } finally {
      setBusy(false);
    }
  };

  // Ask for permission and, if granted, drop the pin on the user's location.
  const runAutoLocate = async () => {
    let state = await getPermissionState();
    if (state === 'undetermined') state = await requestPermission();
    if (state !== 'granted') {
      setPermDenied(true);
      return;
    }
    await locateWithGps({ silent: true });
  };

  // On first mount: if re-parking a car that already has a saved spot, center on
  // it and don't move the pin. Otherwise auto-locate — unless we arrived via an
  // explicit "Park a car here" tap (autoLocate nonce), which the effect below
  // handles, so we don't double-fire GPS.
  useEffect(() => {
    if (didAutoLocate.current) return;
    didAutoLocate.current = true;
    const preParked = route.params?.carId
      ? cars.find((x) => x.id === route.params!.carId)?.location
      : undefined;
    if (preParked) {
      setCoord({ latitude: preParked.lat, longitude: preParked.lng });
      setAddress(preParked.address);
      setLocated(true);
      mapRef.current?.animateToRegion(
        { latitude: preParked.lat, longitude: preParked.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        400,
      );
      return;
    }
    if (route.params?.autoLocate != null) return;
    runAutoLocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Park a car here" passes a fresh autoLocate nonce each tap; re-run GPS when
  // it changes, even if the Park tab was already mounted.
  useEffect(() => {
    const nonce = route.params?.autoLocate;
    if (nonce == null || lastAutoNonce.current === nonce) return;
    lastAutoNonce.current = nonce;
    runAutoLocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.autoLocate]);

  const useNfc = async () => {
    setCapture('nfc');
    const supported = await nfc.isSupported();
    if (!supported) {
      Alert.alert(
        'NFC unavailable',
        'This device or build has no NFC reader (Expo Go and simulators do not). Falling back to GPS. See the README to run a dev build on an NFC phone.',
      );
      setCapture('gps');
      await locateWithGps();
      return;
    }
    Alert.alert('Tap your SweepAlert tag', 'Hold your phone to the tag on your dash…');
    const tag = await nfc.readTag();
    if (tag) {
      // A real tag tap triggers a GPS capture (the tag identifies the car/action).
      await locateWithGps();
    }
  };

  const onSave = async () => {
    if (!assignId) {
      Alert.alert('Pick a car', 'Choose which car to assign this spot to.');
      return;
    }
    const spot: ParkingSpot = {
      carId: assignId,
      lat: coord.latitude,
      lng: coord.longitude,
      address: address || coordStr,
      blockId: schedule?.blockId ?? 'out-of-area',
      savedAt: Date.now(),
    };
    await parkCar(assignId, spot);
    setSaved(true);
  };

  const coordStr = `${coord.latitude.toFixed(5)}, ${coord.longitude.toFixed(5)}`;
  const detected = useMemo(
    () => ({
      // Always the geocoded address of the exact pin — no seed-data fallback.
      addr: address || (geocoding ? 'Locating address…' : coordStr),
      block: schedule?.blockLabel ?? '',
      sched: schedule?.scheduleLabel ?? '',
      season: schedule?.seasonLabel ?? '',
    }),
    [address, schedule, geocoding, coordStr],
  );

  // Nearby real streets (alleys excluded) for the "which street?" selector,
  // always including whatever's currently resolved so it shows as selected.
  const realStreetCandidates = useMemo(() => {
    const reals = streetCandidates.filter((s) => !isAlley(s));
    if (schedule?.address && !reals.includes(schedule.address)) reals.unshift(schedule.address);
    return reals.slice(0, 4);
  }, [streetCandidates, schedule?.address]);

  // Hand-placed pin (map tap or drag): re-geocode, and GPS accuracy no longer applies.
  const placePin = (next: LatLng) => {
    setCoord(next);
    setAddress('');
    setAccuracyM(null);
    setSaved(false);
  };

  const activeReminders = cars.find((x) => x.id === assignId)?.reminders.filter((r) => r.enabled).length ?? 0;

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Park a car</T>
        <T style={{ fontSize: 13, color: c.dim }}>
          {busy && !located
            ? 'Finding your location…'
            : located
              ? 'Centered on where you are — nudge the pin if needed.'
              : 'Drag the pin to the exact spot.'}
        </T>
      </View>

      <CaptureControls
        capture={capture}
        located={located}
        accuracyM={accuracyM}
        permDenied={permDenied}
        onUseGps={() => locateWithGps()}
        onUseNfc={useNfc}
      />

      <ParkMap mapRef={mapRef} coord={coord} accuracyM={accuracyM} busy={busy} onPlacePin={placePin} />

      <DetectedBlockCard unsupported={unsupported} detected={detected} schedule={schedule} geocoding={geocoding}>
        <CarAssignPicker cars={cars} assignId={assignId} onAssign={setAssignId} />
      </DetectedBlockCard>

      {/* Street selector — real streets only, nearest first; only worth
          showing when there's an actual choice to make. */}
      {!unsupported && realStreetCandidates.length > 1 && (
        <StreetPicker streets={realStreetCandidates} selected={schedule?.address} onChoose={chooseStreet} />
      )}

      <SaveSpotAction unsupported={unsupported} saved={saved} activeReminders={activeReminders} onSave={onSave} />
    </Screen>
  );
}
