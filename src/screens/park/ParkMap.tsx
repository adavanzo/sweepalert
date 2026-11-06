import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import MapView, { Circle, LatLng, Marker, Region } from 'react-native-maps';

import { Mono } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeContext';

/** Default map region (and initial pin) before we have a real fix. */
export const BOSTON: Region = { latitude: 42.3554, longitude: -71.0708, latitudeDelta: 0.04, longitudeDelta: 0.04 };

type Props = {
  /** Owned by ParkScreen so GPS / pre-parked centering can animate the map. */
  mapRef: React.RefObject<MapView | null>;
  coord: LatLng;
  accuracyM: number | null;
  busy: boolean;
  /** Called when the user hand-places the pin, by tapping the map or dragging. */
  onPlacePin: (coord: LatLng) => void;
};

/** The map, GPS accuracy ring, draggable pin and "finding you" overlay. */
export function ParkMap({ mapRef, coord, accuracyM, busy, onPlacePin }: Props) {
  const { c, isDark } = useTheme();
  return (
    <View style={{ height: 290, borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: c.line }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={BOSTON}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        onPress={(e) => onPlacePin(e.nativeEvent.coordinate)}
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
          onDragEnd={(e) => onPlacePin(e.nativeEvent.coordinate)}
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
  );
}
