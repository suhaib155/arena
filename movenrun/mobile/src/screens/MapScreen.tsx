import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import MapView, { Polyline, Region } from 'react-native-maps';
import * as h3 from 'h3-js';
import { useStore } from '../store/index.js';
import { useGPS } from '../hooks/useGPS.js';
import { ZoneHex } from '../components/ZoneHex.js';
import { MoveTracker } from '../components/MoveTracker.js';
import { TokenBalance } from '../components/TokenBalance.js';
import { colors, space } from '../theme/tokens';

const H3_RESOLUTION = 8;
// Zoom threshold below which hexes are "detailed" (latitudeDelta < 0.02)
const DETAIL_ZOOM_THRESHOLD = 0.02;
// Hex labels fade in only at close zoom (latitudeDelta < 0.01)
const LABEL_ZOOM_THRESHOLD = 0.01;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const { isTracking, start, stop, currentPoints } = useGPS();
  const visibleZones = useStore((s) => s.visibleZones);
  const selectHex = useStore((s) => s.selectHex);
  const [region, setRegion] = useState<Region>({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [visibleHexIds, setVisibleHexIds] = useState<string[]>([]);

  const isDetailed = region.latitudeDelta < DETAIL_ZOOM_THRESHOLD;

  // Recompute visible hex IDs when region changes — skip at very zoomed-out levels
  useEffect(() => {
    if (region.latitudeDelta > 0.3) {
      setVisibleHexIds([]);
      return;
    }
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLng = longitude - longitudeDelta / 2;
    const maxLng = longitude + longitudeDelta / 2;

    const hexIds = h3.polygonToCells(
      [
        [minLat, minLng],
        [minLat, maxLng],
        [maxLat, maxLng],
        [maxLat, minLng],
      ],
      H3_RESOLUTION,
    );
    setVisibleHexIds(hexIds);
  }, [region]);

  const routeCoords = currentPoints.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
  }));

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        showsCompass={false}
        mapType="mutedStandard"
        onRegionChangeComplete={setRegion}
        userInterfaceStyle="dark"
      >
        {visibleHexIds.map((hexId) => (
          <ZoneHex
            key={hexId}
            hexId={hexId}
            zone={visibleZones.find((z) => z.hexId === hexId) ?? null}
            onPress={() => selectHex(hexId)}
            detailed={isDetailed}
          />
        ))}
        {routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={colors.signal}
            strokeWidth={3}
            lineDashPattern={undefined}
          />
        )}
      </MapView>

      <View style={styles.overlay} pointerEvents="box-none">
        <TokenBalance />
        <MoveTracker />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.void },
  map: { ...StyleSheet.absoluteFillObject },
  overlay: {
    position: 'absolute',
    top: 56,
    left: space[4],
    right: space[4],
    gap: space[3],
  },
});
