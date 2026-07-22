import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Hexagon } from "./Hexagon";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";

export type RankTrend = "up" | "down" | "steady";

interface RankRowProps {
  rank: number;
  name: string;
  /** Concise supporting metadata line. */
  meta: string;
  /** Score value (already formatted). */
  score: string;
  trend: RankTrend;
  /** Club/emblem accent. */
  accent: string;
  pastel: string;
  /** Highlight this row as the user's own club. */
  isMine?: boolean;
}

const TREND_META: Record<RankTrend, { icon: "chevron-up" | "chevron-down" | "remove"; color: string; label: string }> = {
  up: { icon: "chevron-up", color: "#0A8F60", label: "rising" },
  down: { icon: "chevron-down", color: "#C2492E", label: "slipping" },
  steady: { icon: "remove", color: colors.textFaint, label: "steady" },
};

/**
 * Compact leaderboard rank row — rank, emblem, name + meta, score, and a trend
 * that pairs an arrow with a text label (never colour alone). "You" is marked
 * with a text chip, not only a background tint.
 */
export function RankRow({ rank, name, meta, score, trend, accent, pastel, isMine = false }: RankRowProps) {
  const t = TREND_META[trend];
  return (
    <View
      style={[styles.row, isMine ? styles.rowMine : null]}
      accessibilityLabel={`Rank ${rank}, ${name}${isMine ? ", your club" : ""}. Score ${score}, ${t.label}. ${meta}`}
    >
      <Text style={[styles.rank, rank === 1 ? styles.rankGold : null]}>{rank}</Text>
      <Hexagon size={30} color={pastel} coreColor={accent} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {isMine ? (
            <View style={styles.youChip}>
              <Text style={styles.youChipText}>You</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={styles.scoreWrap}>
        <Text style={styles.score}>{score}</Text>
        <View style={styles.trendRow}>
          <Ionicons name={t.icon} size={11} color={t.color} />
          <Text style={[styles.trendText, { color: t.color }]}>{t.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 60,
    ...shadows.card,
  },
  rowMine: { backgroundColor: "#F2FBF7", shadowColor: palette.pulseGreen, shadowOpacity: 0.22 },
  rank: { ...type.title, fontSize: 18, width: 22, textAlign: "center", color: colors.textDim },
  rankGold: { color: "#B07908" },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...type.heading, fontSize: 14.5, flexShrink: 1 },
  meta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  youChip: {
    backgroundColor: `${palette.pulseGreen}1A`,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  youChipText: { fontSize: 10.5, fontWeight: "800", color: "#0A8F60" },
  scoreWrap: { alignItems: "flex-end", gap: 1 },
  score: { ...type.title, fontSize: 17, fontVariant: ["tabular-nums"] },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  trendText: { fontSize: 10.5, fontWeight: "700" },
});
