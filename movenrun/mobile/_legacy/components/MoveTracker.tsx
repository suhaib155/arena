import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useStore } from "../store/index.js";

export function MoveTracker() {
  const isTracking = useStore((s) => s.isTracking);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);
  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt] = useState(Date.now());

  useEffect(() => {
    if (!isTracking) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isTracking, startedAt]);

  if (!isTracking) return null;

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  return (
    <View style={styles.container}>
      <View style={styles.stat}>
        <Text style={styles.value}>{minutes}:{seconds}</Text>
        <Text style={styles.label}>time</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.stat}>
        <Text style={styles.value}>{(currentDistanceMeters / 1000).toFixed(2)}</Text>
        <Text style={styles.label}>km</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.stat}>
        <Text style={[styles.value, styles.earn]}>{(Number(earnedThisRun) / 1e18).toFixed(3)}</Text>
        <Text style={styles.label}>$MOVE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    justifyContent: "space-around",
    alignItems: "center",
  },
  stat: { alignItems: "center" },
  value: { color: "#fff", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  earn: { color: "#00ff88" },
  label: { color: "#666", fontSize: 11, textTransform: "uppercase", marginTop: 2 },
  divider: { width: 1, height: 30, backgroundColor: "#333" },
});
