import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ZoneChallenge } from "@movenrun/shared";

interface Props {
  challenge: ZoneChallenge;
}

export function BattleCard({ challenge }: Props) {
  const now = Date.now() / 1000;
  const end = challenge.challengeEnd;
  const remaining = Math.max(0, end - now);
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);

  const challengerScore = Number(challenge.challengerScore) / 1e18;
  const defenderScore = Number(challenge.defenderScore) / 1e18;
  const total = challengerScore + defenderScore || 1;
  const challengerPct = (challengerScore / total) * 100;

  return (
    <View style={styles.card}>
      <Text style={styles.hexId}>{challenge.hexId}</Text>
      <Text style={styles.timer}>{days}d {hours}h remaining</Text>

      <View style={styles.participants}>
        <View style={styles.side}>
          <Text style={styles.role}>CHALLENGER</Text>
          <Text style={styles.addr}>{challenge.challenger.slice(0, 8)}…</Text>
          <Text style={styles.score}>{challengerScore.toFixed(0)}</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.side, styles.rightSide]}>
          <Text style={styles.role}>DEFENDER</Text>
          <Text style={styles.addr}>{challenge.defender.slice(0, 8)}…</Text>
          <Text style={styles.score}>{defenderScore.toFixed(0)}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${challengerPct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, gap: 10 },
  hexId: { color: "#00ff88", fontFamily: "monospace", fontSize: 12 },
  timer: { color: "#888", fontSize: 13 },
  participants: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1 },
  rightSide: { alignItems: "flex-end" },
  role: { color: "#555", fontSize: 10, textTransform: "uppercase" },
  addr: { color: "#fff", fontFamily: "monospace", fontSize: 13 },
  score: { color: "#00ff88", fontSize: 24, fontWeight: "700" },
  vs: { color: "#555", fontWeight: "700", paddingHorizontal: 8 },
  progressBg: { height: 4, backgroundColor: "#333", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: "#ff6400", borderRadius: 2 },
});
