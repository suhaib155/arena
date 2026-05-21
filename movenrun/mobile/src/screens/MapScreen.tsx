import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Polyline, Region } from "react-native-maps";
import * as h3 from "h3-js";
import { useStore } from "../store/index.js";
import { useChain } from "../hooks/useChain.js";
import { useGPS } from "../hooks/useGPS.js";
import { ZoneHex } from "../components/ZoneHex.js";
import { MoveTracker } from "../components/MoveTracker.js";
import { TokenBalance } from "../components/TokenBalance.js";

const H3_RESOLUTION = 8;
const VIEWPORT_DEBOUNCE_MS = 300;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { authenticated, login } = useChain();
  const { isTracking, permissionGranted, error: gpsError, start, stop, currentPoints } = useGPS();
  const visibleZones = useStore((s) => s.visibleZones);
  const selectHex = useStore((s) => s.selectHex);

  const [region, setRegion] = useState<Region>({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [visibleHexIds, setVisibleHexIds] = useState<string[]>([]);
  const [networkError, setNetworkError] = useState(false);

  const computeHexIds = useCallback((r: Region) => {
    const { latitude, longitude, latitudeDelta, longitudeDelta } = r;
    const minLat = latitude - latitudeDelta / 2;
    const maxLat = latitude + latitudeDelta / 2;
    const minLng = longitude - longitudeDelta / 2;
    const maxLng = longitude + longitudeDelta / 2;
    try {
      const hexIds = h3.polygonToCells(
        [[minLat, minLng], [minLat, maxLng], [maxLat, maxLng], [maxLat, minLng]],
        H3_RESOLUTION
      );
      setVisibleHexIds(hexIds);
      setNetworkError(false);
    } catch {
      setNetworkError(true);
    }
  }, []);

  // Debounce viewport changes to avoid recomputing hex IDs on every frame during pan/zoom
  const handleRegionChange = useCallback((r: Region) => {
    setRegion(r);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => computeHexIds(r), VIEWPORT_DEBOUNCE_MS);
  }, [computeHexIds]);

  useEffect(() => {
    computeHexIds(region);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleSelectHex = useCallback((hexId: string) => selectHex(hexId), [selectHex]);

  const routeCoords = currentPoints.map((p) => ({ latitude: p.lat, longitude: p.lng }));

  // No wallet connected
  if (!authenticated) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateTitle}>Connect Your Wallet</Text>
        <Text style={styles.stateBody}>
          Sign in with Privy to track your runs and earn $MOVE.
        </Text>
        <TouchableOpacity style={styles.actionBtn} onPress={login}>
          <Text style={styles.actionBtnText}>CONNECT WALLET</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // GPS permission not granted
  if (!permissionGranted) {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateTitle}>Location Access Required</Text>
        <Text style={styles.stateBody}>
          MovenRun needs background location access to record your runs and credit $MOVE earnings
          while your phone is in your pocket.
        </Text>
        {gpsError && <Text style={styles.stateError}>{gpsError}</Text>}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => Linking.openSettings()}
        >
          <Text style={styles.actionBtnText}>OPEN SETTINGS</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        onRegionChangeComplete={handleRegionChange}
      >
        {visibleHexIds.map((hexId) => (
          <ZoneHex
            key={hexId}
            hexId={hexId}
            zone={visibleZones.find((z) => z.hexId === hexId) ?? null}
            onPress={() => handleSelectHex(hexId)}
          />
        ))}
        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor="#00ff88" strokeWidth={3} />
        )}
      </MapView>

      {networkError && (
        <View style={styles.networkBanner}>
          <Text style={styles.networkBannerText}>⚠ Offline — map data unavailable</Text>
          <TouchableOpacity onPress={() => computeHexIds(region)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

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
  stateContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d0d0d",
    padding: 32,
    gap: 16,
  },
  stateTitle: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  stateBody: { color: "#888", fontSize: 15, textAlign: "center", lineHeight: 22 },
  stateError: { color: "#ff4444", fontSize: 13, textAlign: "center" },
  actionBtn: {
    backgroundColor: "#00ff88",
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  actionBtnText: { color: "#000", fontWeight: "700", fontSize: 15, letterSpacing: 1 },
  networkBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ff4444",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  networkBannerText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  retryText: { color: "#fff", fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
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
