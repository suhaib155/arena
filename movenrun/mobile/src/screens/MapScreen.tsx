import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import MapView, { Polyline, Region } from "react-native-maps";
import * as h3 from "h3-js";
import { useStore } from "../store/index.js";
import { useGPS } from "../hooks/useGPS.js";
import { ZoneHex } from "../components/ZoneHex.js";
import { MoveTracker } from "../components/MoveTracker.js";
import { TokenBalance } from "../components/TokenBalance.js";

const H3_RESOLUTION = 8;

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

  // Recompute visible hex IDs when region changes
  useEffect(() => {
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLng = longitude - longitudeDelta / 2;
    const maxLng = longitude + longitudeDelta / 2;

    const hexIds = h3.polygonToCells(
      [[minLat, minLng], [minLat, maxLng], [maxLat, maxLng], [maxLat, minLng]],
      H3_RESOLUTION
    );
    setVisibleHexIds(hexIds);
  }, [region]);

  const routeCoords = currentPoints.map((p) => ({ latitude: p.lat, longitude: p.lng }));

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        onRegionChangeComplete={setRegion}
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
          <Polyline coordinates={routeCoords} strokeColor="#00ff88" strokeWidth={3} />
        )}
      </MapView>

      <View style={styles.overlay}>
        <TokenBalance />
        <MoveTracker />
        <TouchableOpacity
          style={[styles.trackBtn, isTracking && styles.trackBtnActive]}
          onPress={isTracking ? stop : start}
        >
          <Text style={styles.trackBtnText}>{isTracking ? "STOP" : "START RUN"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  overlay: {
    position: "absolute",
    bottom: 32,
    left: 16,
    right: 16,
    gap: 12,
  },
  trackBtn: {
    backgroundColor: "#00ff88",
    borderRadius: 32,
    paddingVertical: 18,
    alignItems: "center",
  },
  trackBtnActive: { backgroundColor: "#ff4444" },
  trackBtnText: { color: "#000", fontWeight: "700", fontSize: 16, letterSpacing: 1.2 },
});
