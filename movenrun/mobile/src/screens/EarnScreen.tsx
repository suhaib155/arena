import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useStore } from "../store/index.js";
import { useGPS } from "../hooks/useGPS.js";
import { useToken } from "../hooks/useToken.js";
import { MoveTracker } from "../components/MoveTracker.js";

export default function EarnScreen() {
  const { isTracking, currentPoints } = useGPS();
  const { moveBalance, currentRate, dailyCapRemaining } = useToken();
  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Earn $MOVE</Text>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{(currentDistanceMeters / 1000).toFixed(2)}</Text>
          <Text style={styles.statLabel}>km this run</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{(Number(earnedThisRun) / 1e18).toFixed(2)}</Text>
          <Text style={styles.statLabel}>$MOVE earned</Text>
        </View>
      </View>

      <MoveTracker />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rate Info</Text>
        <Text style={styles.cardRow}>Current rate: {currentRate ?? "—"}</Text>
        <Text style={styles.cardRow}>Daily cap left: {dailyCapRemaining ?? "—"} $MOVE</Text>
        <Text style={styles.cardRow}>Balance: {(Number(moveBalance) / 1e18).toFixed(2)} $MOVE</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How to Earn More</Text>
        <Text style={styles.cardRow}>• Own a Zone NFT — skip the 2% tax</Text>
        <Text style={styles.cardRow}>• Equip gear for multipliers (up to 3x)</Text>
        <Text style={styles.cardRow}>• Move in high-activity zones</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 16 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "700" },
  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 12, padding: 20, alignItems: "center" },
  statValue: { color: "#00ff88", fontSize: 32, fontWeight: "700" },
  statLabel: { color: "#888", fontSize: 13, marginTop: 4 },
  card: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { color: "#fff", fontWeight: "700", fontSize: 16, marginBottom: 4 },
  cardRow: { color: "#aaa", fontSize: 14 },
});
