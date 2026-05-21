import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated } from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';
import * as h3 from 'h3-js';
import { useStore } from '../store/index.js';
import { useGPS } from '../hooks/useGPS.js';
import { ZoneHex } from '../components/ZoneHex.js';
import { MoveTracker } from '../components/MoveTracker.js';
import { TokenBalance } from '../components/TokenBalance.js';
import { SkeletonClockProvider, MapSkeleton } from '../components/skeleton/index.js';
import { TopProgressBar } from '../components/ui/TopProgressBar.js';
import { COLORS, CROSSFADE_MS } from '../constants/design.js';

const H3_RESOLUTION = 8;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const { isTracking, start, stop, currentPoints } = useGPS();
  const visibleZones = useStore((s) => s.visibleZones);
  const selectHex = useStore((s) => s.selectHex);
  const [mapReady, setMapReady] = useState(false);
  const [refreshingZones, setRefreshingZones] = useState(false);
  const [region, setRegion] = useState<Region>({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [visibleHexIds, setVisibleHexIds] = useState<string[]>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Recompute visible hex IDs when region changes
  useEffect(() => {
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

  const handleMapReady = () => {
    setMapReady(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: CROSSFADE_MS,
      useNativeDriver: true,
    }).start();
  };

  const routeCoords = currentPoints.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
  }));

  const skeletonOpacity = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <View style={styles.container}>
      <TopProgressBar loading={refreshingZones} />

      {/* Map skeleton shown until MapView is ready */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: skeletonOpacity }]}
        pointerEvents={mapReady ? 'none' : 'auto'}
      >
        <SkeletonClockProvider>
          <MapSkeleton />
        </SkeletonClockProvider>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>
        <MapView
          ref={mapRef}
          style={styles.map}
          showsUserLocation
          onMapReady={handleMapReady}
          onRegionChangeComplete={(r) => {
            setRegion(r);
            setRefreshingZones(true);
            // simulate zone data fetch completion
            setTimeout(() => setRefreshingZones(false), 800);
          }}
        >
          {visibleHexIds.map((hexId) => (
            <ZoneHex
              key={hexId}
              hexId={hexId}
              zone={visibleZones.find((z) => z.hexId === hexId) ?? null}
              onPress={() => selectHex(hexId)}
            />
          ))}
          {routeCoords.length > 1 && (
            <Polyline
              coordinates={routeCoords}
              strokeColor={COLORS.signal}
              strokeWidth={3}
            />
          )}
        </MapView>

        <View style={styles.overlay}>
          <TokenBalance />
          <MoveTracker />
          <TouchableOpacity
            style={[styles.trackBtn, isTracking && styles.trackBtnActive]}
            onPress={isTracking ? stop : start}
          >
            <Text style={styles.trackBtnText}>{isTracking ? 'STOP' : 'START RUN'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  overlay: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    gap: 12,
  },
  trackBtn: {
    backgroundColor: COLORS.signal,
    borderRadius: 32,
    paddingVertical: 18,
    alignItems: 'center',
  },
  trackBtnActive: { backgroundColor: COLORS.danger },
  trackBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 16, letterSpacing: 1.2 },
});
