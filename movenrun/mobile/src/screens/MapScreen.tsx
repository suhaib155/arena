import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  Animated,
  StatusBar,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import MapboxGL from "@rnmapbox/maps";
import * as Haptics from "expo-haptics";
import * as h3 from "h3-js";
import { useStore } from "../store/index";
import { useGPS } from "../hooks/useGPS";
import { HexLayer } from "../components/map/HexLayer";
import { AmbientLayer } from "../components/map/AmbientLayer";
import { RecenterButton } from "../components/map/RecenterButton";
import { TopBar } from "../components/TopBar";
import { MapBottomSheet } from "../components/MapBottomSheet";
import { COLORS } from "../constants/colors";
import type { FeatureCollection } from "geojson";

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "");

const H3_RES = 8;
const MAP_STYLE = require("../../assets/map-style.json");
const DEFAULT_LAT = 37.7749;
const DEFAULT_LNG = -122.4194;

function getDayNightTint(): string {
  const h = new Date().getHours();
  if (h >= 7 && h < 19) return "transparent";
  if (h >= 19 && h < 21) return `rgba(255, 160, 60, ${0.06 * (21 - h)})`;
  if (h >= 5 && h < 7) return `rgba(255, 160, 60, ${0.04 * (h - 5)})`;
  return "rgba(80, 110, 200, 0.04)";
}

export default function MapScreen() {
  const mapRef = useRef<MapboxGL.MapView>(null);
  const cameraRef = useRef<MapboxGL.Camera>(null);

  const { isTracking, start, stop, currentPoints } = useGPS();

  const visibleZones = useStore((s) => s.visibleZones);
  const ownedZoneIds = useStore((s) => s.ownedZoneIds);
  const allyAddresses = useStore((s) => s.allyAddresses);
  const activeBattles = useStore((s) => s.activeBattles);
  const selectHex = useStore((s) => s.selectHex);
  const selectedHexId = useStore((s) => s.selectedHexId);
  const setCurrentHexId = useStore((s) => s.setCurrentHexId);
  const currentHexId = useStore((s) => s.currentHexId);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);
  const earnedThisRun = useStore((s) => s.earnedThisRun);

  const [visibleHexIds, setVisibleHexIds] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [showRecenter, setShowRecenter] = useState(false);
  const [dayNightTint] = useState(() => getDayNightTint());

  const lastLat = currentPoints[currentPoints.length - 1]?.lat ?? DEFAULT_LAT;
  const lastLng = currentPoints[currentPoints.length - 1]?.lng ?? DEFAULT_LNG;

  // Breathing animation (±0.5% scale over 20s)
  const breatheAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, { toValue: 1, duration: 10000, useNativeDriver: true }),
        Animated.timing(breatheAnim, { toValue: 0, duration: 10000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breatheAnim]);
  const breatheScale = breatheAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.005] });

  // Scanline sweep on current hex (subtle screen-center line when tracking)
  const scanAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isTracking) return;
    const loop = Animated.loop(
      Animated.timing(scanAnim, { toValue: 1, duration: 2500, useNativeDriver: true }),
    );
    loop.start();
    return () => { loop.stop(); scanAnim.setValue(0); };
  }, [isTracking, scanAnim]);
  const scanTranslate = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [-80, 80] });

  // Update current hex from GPS
  useEffect(() => {
    if (currentPoints.length === 0) return;
    const { lat, lng } = currentPoints[currentPoints.length - 1];
    const hex = h3.latLngToCell(lat, lng, H3_RES);
    setCurrentHexId(hex);
  }, [currentPoints, setCurrentHexId]);

  // Run timer
  useEffect(() => {
    if (!isTracking) { setElapsed(0); return; }
    setStartedAt(Date.now());
  }, [isTracking]);

  useEffect(() => {
    if (!startedAt) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  // User location GeoJSON for glow halo
  const userGlowFC = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: "user",
      geometry: { type: "Point", coordinates: [lastLng, lastLat] },
      properties: {},
    }],
  }), [lastLat, lastLng]);

  // Route GeoJSON
  const routeFC = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: currentPoints.length > 1 ? [{
      type: "Feature",
      id: "route",
      geometry: {
        type: "LineString",
        coordinates: currentPoints.map((p) => [p.lng, p.lat]),
      },
      properties: {},
    }] : [],
  }), [currentPoints]);

  // Recompute visible hexes when camera region changes
  const onRegionDidChange = useCallback(async () => {
    if (!mapRef.current) return;
    try {
      const bounds = await mapRef.current.getVisibleBounds();
      if (!bounds) return;
      const [[ne1, ne0], [sw1, sw0]] = bounds;
      const hexIds = h3.polygonToCells(
        [[ne0, ne1], [ne0, sw1], [sw0, sw1], [sw0, ne1]],
        H3_RES,
      );
      setVisibleHexIds(hexIds);
    } catch {
      // ignore
    }
  }, []);

  const handleHexPress = useCallback((hexId: string) => {
    selectHex(hexId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [selectHex]);

  const handleRecenter = useCallback(() => {
    cameraRef.current?.setCamera({
      centerCoordinate: [lastLng, lastLat],
      zoomLevel: 16,
      pitch: 55,
      animationMode: "flyTo",
      animationDuration: 800,
    });
    setShowRecenter(false);
  }, [lastLat, lastLng]);

  const hasActiveBattleAlert = activeBattles.some(
    (b) => !b.resolved && ownedZoneIds.includes(b.hexId),
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: breatheScale }] }]}>
        <MapboxGL.MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          styleJSON={JSON.stringify(MAP_STYLE)}
          pitchEnabled
          rotateEnabled
          compassEnabled={false}
          logoEnabled={false}
          attributionEnabled={false}
          onRegionDidChange={onRegionDidChange}
          onTouchMove={() => setShowRecenter(true)}
        >
          <MapboxGL.Camera
            ref={cameraRef}
            followUserLocation={isTracking}
            followUserMode="compass"
            followPitch={isTracking ? 55 : 0}
            followZoomLevel={16}
            animationMode="moveTo"
            animationDuration={600}
            defaultSettings={{
              centerCoordinate: [DEFAULT_LNG, DEFAULT_LAT],
              zoomLevel: 13,
              pitch: 0,
            }}
          />

          <MapboxGL.UserLocation
            visible
            showsUserHeadingIndicator={isTracking}
            androidRenderMode="gps"
          />

          {/* User position glow halo */}
          <MapboxGL.ShapeSource id="user-glow" shape={userGlowFC}>
            <MapboxGL.CircleLayer
              id="user-glow-outer"
              style={{
                circleRadius: 100,
                circleColor: COLORS.signal,
                circleOpacity: 0.03,
                circleBlur: 3,
              }}
            />
            <MapboxGL.CircleLayer
              id="user-glow-inner"
              style={{
                circleRadius: 40,
                circleColor: COLORS.signal,
                circleOpacity: 0.07,
                circleBlur: 2,
              }}
            />
          </MapboxGL.ShapeSource>

          <HexLayer
            visibleHexIds={visibleHexIds}
            zones={visibleZones}
            ownedZoneIds={ownedZoneIds}
            allyAddresses={allyAddresses}
            activeBattles={activeBattles}
            currentHexId={currentHexId}
            selectedHexId={selectedHexId}
            onHexPress={handleHexPress}
          />

          <AmbientLayer
            userLat={lastLat}
            userLng={lastLng}
            active
          />

          {/* Route polyline */}
          <MapboxGL.ShapeSource id="route" shape={routeFC}>
            <MapboxGL.LineLayer
              id="route-glow"
              style={{
                lineColor: COLORS.signal,
                lineWidth: 6,
                lineOpacity: 0.15,
                lineBlur: 4,
              }}
            />
            <MapboxGL.LineLayer
              id="route-line"
              style={{
                lineColor: COLORS.signal,
                lineWidth: 2.5,
                lineOpacity: 0.9,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </MapboxGL.ShapeSource>
        </MapboxGL.MapView>
      </Animated.View>

      {/* Day/night tint overlay */}
      {dayNightTint !== "transparent" && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: dayNightTint }]} pointerEvents="none" />
      )}

      {/* Scanline sweep for current hex (shows when tracking) */}
      {isTracking && (
        <Animated.View
          style={[styles.scanLine, { transform: [{ translateY: scanTranslate }] }]}
          pointerEvents="none"
        />
      )}

      <TopBar hasActiveBattleAlert={hasActiveBattleAlert} />

      <RecenterButton onPress={handleRecenter} visible={showRecenter && !isTracking} />

      <MapBottomSheet
        isTracking={isTracking}
        elapsed={elapsed}
        distanceKm={currentDistanceMeters / 1000}
        earnedThisRun={earnedThisRun}
        onStartRun={start}
        onStopRun={stop}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.abyss,
  },
  scanLine: {
    position: "absolute",
    left: "10%",
    right: "10%",
    top: "50%",
    height: 1,
    backgroundColor: COLORS.signal,
    opacity: 0.12,
    shadowColor: COLORS.signal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
});
