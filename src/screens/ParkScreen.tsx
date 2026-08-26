import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import MapView, { Circle, Marker, Region } from 'react-native-maps';

import { Button } from '../components/Button';
import { Mono, MonoLabel, T } from '../components/primitives';
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
import * as nfc from '../services/nfc';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';
import { CleaningSchedule, ParkingSpot } from '../types';

type Props = BottomTabScreenProps<RootTabParamList, 'Park'>;

const BOSTON: Region = { latitude: 42.3554, longitude: -71.0708, latitudeDelta: 0.04, longitudeDelta: 0.04 };

export function ParkScreen({ route, navigation }: Props) {
  const { c, isDark } = useTheme();
  const cars = useStore((s) => s.cars);
  const parkCar = useStore((s) => s.parkCar);

  const initialCarId = route.params?.carId ?? cars[0]?.id;
  const [assignId, setAssignId] = useState<string | undefined>(initialCarId);
  const [capture, setCapture] = useState<'gps' | 'nfc'>('gps');
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
        getProvider().getScheduleForLocation(lat, lng),
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
    } finally {
      setBusy(false);
    }
  };

  const useGps = async ({ silent = false }: { silent?: boolean } = {}) => {
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
    await useGps({ silent: true });
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
      await useGps();
      return;
    }
    Alert.alert('Tap your SweepAlert tag', 'Hold your phone to the tag on your dash…');
    const tag = await nfc.readTag();
    if (tag) {
      // A real tag tap triggers a GPS capture (the tag identifies the car/action).
      await useGps();
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

      {permDenied && (
        <Pressable
          onPress={() => useGps()}
          style={{ padding: 12, borderRadius: 14, backgroundColor: c.warnT, borderWidth: 1, borderColor: c.warn }}
        >
          <T style={{ fontSize: 12.5, fontWeight: '600', color: c.warn }}>
            Location is off — drop the pin manually, or tap to try GPS again.
          </T>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', gap: 9 }}>
        <CaptureBtn
          active={capture === 'gps'}
          title={located ? 'Re-center on me' : 'Use my location'}
          sub={accuracyM != null ? `accurate to ±${Math.round(accuracyM)}m` : 'phone GPS'}
          onPress={() => useGps()}
        />
        <CaptureBtn
          active={capture === 'nfc'}
          title="Tap NFC tag in car"
          sub="hands-free, no app"
          onPress={useNfc}
        />
      </View>

      <View style={{ height: 290, borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: c.line }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          initialRegion={BOSTON}
          userInterfaceStyle={isDark ? 'dark' : 'light'}
          onPress={(e) => {
            setCoord(e.nativeEvent.coordinate);
            setAddress('');
            setAccuracyM(null); // hand-placed: GPS accuracy no longer applies
            setSaved(false);
          }}
        >
          {/* GPS accuracy radius — shows how precise the fix is. */}
          {accuracyM != null && accuracyM > 0 && (
            <Circle
              center={coord}
              radius={accuracyM}
              strokeColor={c.accent}
              fillColor={`${c.accent}22`}
              strokeWidth={1}
            />
          )}
          <Marker
            coordinate={coord}
            draggable
            onDragEnd={(e) => {
              setCoord(e.nativeEvent.coordinate);
              setAddress('');
              setAccuracyM(null);
              setSaved(false);
            }}
            pinColor={c.accent}
          />
        </MapView>
        {busy && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.06)' }}>
            <ActivityIndicator color={c.accent} />
            <Mono style={{ fontSize: 11, color: c.dim }}>
              {accuracyM != null ? `refining… ±${Math.round(accuracyM)}m` : 'finding your location…'}
            </Mono>
          </View>
        )}
      </View>

      {/* Detected block, or an out-of-coverage notice */}
      <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 14 }}>
        {unsupported ? (
          <>
            <View style={{ gap: 5 }}>
              <MonoLabel>OUTSIDE COVERAGE</MonoLabel>
              <T style={{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>Not supported here yet</T>
              <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>
                {detected.addr}
              </T>
            </View>
            <View style={{ padding: 14, borderRadius: 16, backgroundColor: c.warnT, gap: 6 }}>
              <T style={{ fontSize: 14, fontWeight: '700', color: c.warn }}>
                SweepAlert covers Boston and Cambridge. This spot is outside both.
              </T>
              <Mono style={{ fontSize: 11.5, color: c.dim }}>
                You can still save where you parked, but there are no cleaning reminders for this area.
              </Mono>
            </View>
          </>
        ) : (
          <>
            <View style={{ gap: 5 }}>
              <MonoLabel>DETECTED BLOCK</MonoLabel>
              <T style={{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>{detected.addr}</T>
              {!!detected.block && (
                <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>{detected.block}</T>
              )}
            </View>
            {schedule ? (
              <View style={{ padding: 14, borderRadius: 16, backgroundColor: c.accentT, gap: 6 }}>
                <T style={{ fontSize: 14, fontWeight: '700', color: c.accent }}>{detected.sched}</T>
                <Mono style={{ fontSize: 11.5, color: c.dim }}>{detected.season}</Mono>
              </View>
            ) : (
              <View style={{ padding: 14, borderRadius: 16, backgroundColor: c.card2, gap: 6 }}>
                <T style={{ fontSize: 13, fontWeight: '600', color: c.dim }}>
                  {geocoding ? 'Looking up the cleaning schedule…' : 'No street-cleaning data for this location.'}
                </T>
                {!geocoding && (
                  <Mono style={{ fontSize: 11, color: c.dim }}>
                    SweepAlert covers Boston and Cambridge. If you’re in Boston, try picking the street below.
                  </Mono>
                )}
              </View>
            )}
          </>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>Assign to</T>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', flexShrink: 1, justifyContent: 'flex-end' }}>
            {cars.map((car) => {
              const on = assignId === car.id;
              return (
                <Pressable
                  key={car.id}
                  onPress={() => setAssignId(car.id)}
                  style={{
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? c.accent : c.line,
                    backgroundColor: on ? c.accent : c.card,
                  }}
                >
                  <T style={{ fontSize: 12, fontWeight: '600', color: on ? '#fff' : c.dim }}>{car.name}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* Street selector — GPS in a back alley can't tell which flanking street
          you parked on (Boylston vs Newbury), so make it an obvious one-tap
          choice rather than a silent guess. Real streets only, nearest first. */}
      {!unsupported && realStreetCandidates.length > 1 && (
        <View style={{ gap: 8, marginTop: -6 }}>
          <MonoLabel>WHICH STREET DID YOU PARK ON?</MonoLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {realStreetCandidates.map((st) => {
              const on = schedule?.address === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => chooseStreet(st)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? c.accent : c.line,
                    backgroundColor: on ? c.accentT : c.card2,
                  }}
                >
                  <T style={{ fontSize: 12, fontWeight: '600', color: on ? c.accent : c.ink }}>{st}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <Button title={unsupported ? 'Save location anyway' : 'Save parking spot'} onPress={onSave} />
      {saved && (
        <T style={{ textAlign: 'center', fontSize: 12.5, fontWeight: '500', color: unsupported ? c.warn : c.ok }}>
          {unsupported
            ? 'Location saved. No cleaning schedule for this area — no reminders set.'
            : `Saved. ${activeReminders} reminders set for this block.`}
        </T>
      )}
    </Screen>
  );
}

function CaptureBtn({ active, title, sub, onPress }: { active: boolean; title: string; sub: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        padding: 13,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? c.accent : c.line,
        backgroundColor: active ? c.accent : c.card,
      }}
    >
      <T style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.dim }}>{title}</T>
      <Mono style={{ fontSize: 11, marginTop: 2, color: active ? 'rgba(255,255,255,0.75)' : c.dim }}>{sub}</Mono>
    </Pressable>
  );
}
