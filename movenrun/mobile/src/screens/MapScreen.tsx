import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
} from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Modal,
  Platform,
} from "react-native";
import MapView, { Polyline, Region } from "react-native-maps";
import { useRouter } from "expo-router";
import { Zone } from "@movenrun/shared";
import { useStore } from "../store/index.js";
import { useGPS, SubmitResult } from "../hooks/useGPS.js";
import { ZoneHex } from "../components/ZoneHex.js";
import { MoveTracker } from "../components/MoveTracker.js";
import { TokenBalance } from "../components/TokenBalance.js";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const SHEET_COLLAPSED = 96;
const SHEET_EXPANDED = 340;
const DEBOUNCE_MS = 600;

export default memo(function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const { isTracking, startTracking, stopTracking, routePoints, isSubmitting } =
    useGPS();

  const visibleZones = useStore((s) => s.visibleZones);
  const setVisibleZones = useStore((s) => s.setVisibleZones);
  const selectHex = useStore((s) => s.selectHex);
  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const distanceThisSession = useStore((s) => s.currentDistanceMeters);
  const walletAddress = useStore((s) => s.walletAddress);
  const ownedZoneIds = useStore((s) => s.ownedZoneIds);

  const [region, setRegion] = useState<Region>({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [visibleHexIds, setVisibleHexIds] = useState<string[]>([]);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const sheetHeight = useRef(new Animated.Value(SHEET_COLLAPSED)).current;
  const [summaryResult, setSummaryResult] = useState<SubmitResult | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchViewportHexes = useCallback(
    async (r: Region) => {
      try {
        const q = new URLSearchParams({
          minLat: String(r.latitude - r.latitudeDelta / 2),
          maxLat: String(r.latitude + r.latitudeDelta / 2),
          minLng: String(r.longitude - r.longitudeDelta / 2),
          maxLng: String(r.longitude + r.longitudeDelta / 2),
        });
        const res = await fetch(`${API_BASE}/api/hexes/viewport?${q}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          hexes: Zone[];
          hexIds: string[];
        };
        setVisibleZones(data.hexes);
        setVisibleHexIds(data.hexIds);
      } catch {
        // No-op — map still renders h3 hexes without backend data
      }
    },
    [setVisibleZones],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => void fetchViewportHexes(region),
      DEBOUNCE_MS,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [region, fetchViewportHexes]);

  const toggleSheet = useCallback(() => {
    const toValue = sheetExpanded ? SHEET_COLLAPSED : SHEET_EXPANDED;
    Animated.spring(sheetHeight, {
      toValue,
      useNativeDriver: false,
      tension: 60,
      friction: 10,
    }).start();
    setSheetExpanded((prev) => !prev);
  }, [sheetExpanded, sheetHeight]);

  const handleStartRun = useCallback(async () => {
    await startTracking();
  }, [startTracking]);

  const handleStopRun = useCallback(async () => {
    const result = await stopTracking();
    if (result) {
      setSummaryResult(result);
      setShowSummary(true);
    }
  }, [stopTracking]);

  const handleHexPress = useCallback(
    (hexId: string) => {
      selectHex(hexId);
      router.push(`/zone/${hexId}` as never);
    },
    [selectHex, router],
  );

  const routeCoords = routePoints.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
  }));

  const earnedDisplay = (Number(earnedThisRun) / 1e18).toFixed(4);
  const distKm = (distanceThisSession / 1000).toFixed(2);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        showsMyLocationButton={false}
        userInterfaceStyle="dark"
        onRegionChangeComplete={setRegion}
      >
        {visibleHexIds.map((hexId) => (
          <ZoneHex
            key={hexId}
            hexId={hexId}
            zone={visibleZones.find((z) => z.hexId === hexId) ?? null}
            walletAddress={walletAddress}
            ownedByUser={ownedZoneIds.includes(hexId)}
            onPress={() => handleHexPress(hexId)}
          />
        ))}

        {routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#3B82F6"
            strokeWidth={3}
          />
        )}
      </MapView>

      {/* Top-left balance pill */}
      <View style={styles.topBar}>
        <TokenBalance />
      </View>

      {/* Floating start/stop run button */}
      <View style={styles.fabWrap}>
        {isTracking && (
          <View style={styles.earnBadge}>
            <Text style={styles.earnLabel}>EARNED THIS RUN</Text>
            <Text style={styles.earnValue}>{earnedDisplay} $MOVE</Text>
            <Text style={styles.earnDist}>{distKm} km</Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.fab,
            isTracking ? styles.fabStop : styles.fabStart,
            isSubmitting && styles.fabDisabled,
          ]}
          onPress={isTracking ? handleStopRun : handleStartRun}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          <Text style={styles.fabText}>
            {isSubmitting
              ? "SUBMITTING…"
              : isTracking
                ? "STOP RUN"
                : "START RUN"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bottom sheet */}
      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <TouchableOpacity
          style={styles.sheetHandle}
          onPress={toggleSheet}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 48, right: 48 }}
        >
          <View style={styles.handleBar} />
        </TouchableOpacity>

        {/* Collapsed stats strip */}
        <View style={styles.sheetStats}>
          <MoveTracker />
        </View>

        {/* Expanded: nearby zone list */}
        {sheetExpanded && (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle}>Nearby Zones</Text>
            {visibleZones.length === 0 ? (
              <Text style={styles.sheetEmpty}>
                Move around to discover zones
              </Text>
            ) : (
              visibleZones.slice(0, 6).map((zone) => (
                <TouchableOpacity
                  key={zone.hexId}
                  style={styles.zoneRow}
                  onPress={() => handleHexPress(zone.hexId)}
                >
                  <View style={styles.zoneRowLeft}>
                    <Text style={styles.zoneHexId} numberOfLines={1}>
                      {zone.hexId}
                    </Text>
                    <Text style={styles.zoneStatus}>{zone.status}</Text>
                  </View>
                  <Text style={styles.zoneMoverCount}>
                    {zone.weeklyMoverCount} movers
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </Animated.View>

      {/* Run summary modal */}
      <Modal visible={showSummary} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Run Complete!</Text>
            <Text style={styles.modalSub}>Route verified on-chain</Text>

            <View style={styles.modalStats}>
              <View style={styles.modalStat}>
                <Text style={styles.modalStatVal}>{distKm}</Text>
                <Text style={styles.modalStatLabel}>km</Text>
              </View>
              <View style={styles.modalDivider} />
              <View style={styles.modalStat}>
                <Text style={[styles.modalStatVal, styles.green]}>
                  {summaryResult
                    ? (Number(summaryResult.moveEarned) / 1e18).toFixed(3)
                    : "0.000"}
                </Text>
                <Text style={styles.modalStatLabel}>$MOVE earned</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setShowSummary(false)}
            >
              <Text style={styles.modalDoneText}>DONE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  map: { ...StyleSheet.absoluteFillObject },

  topBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 32,
    left: 16,
  },

  fabWrap: {
    position: "absolute",
    bottom: SHEET_COLLAPSED + 20,
    left: 16,
    right: 16,
    alignItems: "center",
    gap: 10,
  },
  earnBadge: {
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3B82F650",
  },
  earnLabel: {
    color: "#9CA3AF",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  earnValue: {
    color: "#3B82F6",
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  earnDist: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  fab: {
    width: "100%",
    borderRadius: 32,
    paddingVertical: 18,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabStart: { backgroundColor: "#3B82F6" },
  fabStop: { backgroundColor: "#EF4444" },
  fabDisabled: { opacity: 0.6 },
  fabText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 1.4,
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(13,13,13,0.96)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    borderTopWidth: 1,
    borderColor: "#1F2937",
  },
  sheetHandle: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#374151",
  },
  sheetStats: { paddingHorizontal: 16 },
  sheetBody: { paddingHorizontal: 16, paddingTop: 4 },
  sheetTitle: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 8,
  },
  sheetEmpty: { color: "#6B7280", fontSize: 14 },
  zoneRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  zoneRowLeft: { flex: 1 },
  zoneHexId: {
    color: "#9CA3AF",
    fontFamily: "monospace",
    fontSize: 11,
  },
  zoneStatus: { color: "#6B7280", fontSize: 11, marginTop: 2 },
  zoneMoverCount: { color: "#3B82F6", fontSize: 12, fontWeight: "600" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  modalTitle: { color: "#fff", fontSize: 24, fontWeight: "800" },
  modalSub: { color: "#6B7280", fontSize: 14 },
  modalStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    marginVertical: 8,
  },
  modalStat: { alignItems: "center", gap: 4 },
  modalStatVal: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  modalStatLabel: { color: "#9CA3AF", fontSize: 13 },
  modalDivider: { width: 1, height: 48, backgroundColor: "#1F2937" },
  green: { color: "#3B82F6" },
  modalDoneBtn: {
    backgroundColor: "#3B82F6",
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 8,
  },
  modalDoneText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 1 },
});
