import React, { useEffect, useRef, memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
} from "react-native";
import { useStore } from "../store/index.js";
import { useGPS } from "../hooks/useGPS.js";

function formatPace(speedMs: number): string {
  if (speedMs < 0.3) return "--:--";
  const secsPerKm = 1000 / speedMs;
  const mins = Math.floor(secsPerKm / 60);
  const secs = Math.floor(secsPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatSpeed(speedMs: number): string {
  return (speedMs * 3.6).toFixed(1);
}

export default memo(function EarnScreen() {
  const { isTracking, currentPosition } = useGPS();

  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);
  const hexActivity = useStore((s) => s.hexActivity);
  const gear = useStore((s) => s.gear);
  const dailyCapRemaining = useStore((s) => s.dailyCapRemaining);

  const counterScale = useRef(new Animated.Value(1)).current;
  const prevEarned = useRef(0);

  const earnedFloat = Number(earnedThisRun) / 1e18;
  const speed = currentPosition?.speed ?? 0;

  // Pulse the counter whenever earnedThisRun increments
  useEffect(() => {
    if (earnedFloat !== prevEarned.current) {
      Animated.sequence([
        Animated.timing(counterScale, {
          toValue: 1.08,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(counterScale, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
      ]).start();
      prevEarned.current = earnedFloat;
    }
  }, [earnedFloat, counterScale]);

  const gearMultiplier =
    gear.length > 0
      ? gear.reduce((acc, g) => acc * (Number(g.multiplier) / 1e18), 1)
      : 1;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Earn $MOVE</Text>

      {/* Animated main counter */}
      <View style={styles.counterCard}>
        <Text style={styles.counterLabel}>EARNED THIS RUN</Text>
        <Animated.Text
          style={[
            styles.counter,
            { transform: [{ scale: counterScale }] },
          ]}
        >
          {earnedFloat.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })}
        </Animated.Text>
        <Text style={styles.counterUnit}>$MOVE</Text>
      </View>

      {/* Speed / distance / pace row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {(currentDistanceMeters / 1000).toFixed(2)}
          </Text>
          <Text style={styles.statLabel}>km</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{formatSpeed(speed)}</Text>
          <Text style={styles.statLabel}>km/h</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{formatPace(speed)}</Text>
          <Text style={styles.statLabel}>pace /km</Text>
        </View>
      </View>

      {/* Gear multiplier */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Gear Multiplier</Text>
        <Text style={styles.multiplierValue}>{gearMultiplier.toFixed(2)}x</Text>
        {gear.length === 0 && (
          <Text style={styles.cardHint}>
            Equip gear in the shop to earn up to 3x
          </Text>
        )}
        {gear.map((g) => (
          <Text key={String(g.tokenId)} style={styles.gearItem}>
            {g.slot} — {(Number(g.multiplier) / 1e18).toFixed(2)}x
          </Text>
        ))}
      </View>

      {/* Daily cap */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily Cap Remaining</Text>
        <Text style={styles.capValue}>
          {(Number(dailyCapRemaining) / 1e18).toFixed(2)} $MOVE
        </Text>
        {Number(dailyCapRemaining) === 0 && (
          <Text style={styles.cardHint}>Resets at midnight UTC</Text>
        )}
      </View>

      {/* Hexes covered this run */}
      {hexActivity.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Hexes Covered ({hexActivity.length})
          </Text>
          {hexActivity.map((ha) => (
            <View key={ha.hexId} style={styles.hexRow}>
              <Text style={styles.hexId} numberOfLines={1}>
                {ha.hexId}
              </Text>
              <Text style={styles.hexEarned}>
                +{(Number(ha.moveEarned) / 1e18).toFixed(3)} $MOVE
              </Text>
            </View>
          ))}
        </View>
      )}

      {!isTracking && (
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            Start a run on the Map tab to earn $MOVE
          </Text>
        </View>
      )}

      {/* Static earn info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>How Earning Works</Text>
        <Text style={styles.cardRow}>• 10 $MOVE per km (base rate, halves each epoch)</Text>
        <Text style={styles.cardRow}>• Gear multipliers stack up to 3x total</Text>
        <Text style={styles.cardRow}>• Own a Zone NFT — skip the 2% zone tax</Text>
        <Text style={styles.cardRow}>• Zone NFT owners earn 2% of all $MOVE minted in their zone</Text>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "800" },

  counterCard: {
    backgroundColor: "#111827",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1F2937",
    gap: 4,
  },
  counterLabel: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  counter: {
    color: "#3B82F6",
    fontSize: 48,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  counterUnit: { color: "#9CA3AF", fontSize: 16, fontWeight: "600" },

  statsRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  statValue: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statLabel: { color: "#6B7280", fontSize: 11, textTransform: "uppercase" },

  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  cardTitle: { color: "#fff", fontWeight: "700", fontSize: 15 },
  cardRow: { color: "#9CA3AF", fontSize: 13, lineHeight: 20 },
  cardHint: { color: "#6B7280", fontSize: 12, fontStyle: "italic" },

  multiplierValue: {
    color: "#3B82F6",
    fontSize: 32,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  gearItem: { color: "#9CA3AF", fontSize: 13 },

  capValue: {
    color: "#F59E0B",
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  hexRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  hexId: {
    color: "#6B7280",
    fontFamily: "monospace",
    fontSize: 11,
    flex: 1,
    marginRight: 8,
  },
  hexEarned: { color: "#3B82F6", fontSize: 13, fontWeight: "600" },

  hintCard: {
    backgroundColor: "#1F2937",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
  },
  hintText: { color: "#6B7280", fontSize: 15, textAlign: "center" },
});
