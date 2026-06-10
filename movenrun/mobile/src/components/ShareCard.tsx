import { StyleSheet, Text, View } from "react-native";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { Hexagon } from "./Hexagon";

interface ShareCardProps {
  questTitle: string;
  xpGained: number;
  level: number;
  streak: number;
}

/**
 * A branded, screenshot-style "share card" — the visual users would post.
 * For the MVP this is a mock: it renders the card and the result screen shares
 * a matching text blurb. A future PR can capture this view as an image.
 */
export function ShareCard({ questTitle, xpGained, level, streak }: ShareCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.brandRow}>
        <Hexagon size={14} color={palette.pulseGreen} />
        <Text style={styles.brand}>MovenRun</Text>
        <View style={styles.spacer} />
        <Text style={styles.loop}>Move → Capture → Own</Text>
      </View>

      <Text style={styles.label}>Quest complete</Text>
      <Text style={styles.quest} numberOfLines={1}>{questTitle}</Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: "#B07908" }]}>+{xpGained}</Text>
          <Text style={styles.statLabel}>XP</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{level}</Text>
          <Text style={styles.statLabel}>Level</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: palette.heatCoral }]}>{streak}</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.float,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brand: { ...type.heading, fontSize: 14, letterSpacing: 0.2 },
  spacer: { flex: 1 },
  loop: { ...type.mono, fontSize: 10, color: colors.textFaint },
  label: { ...type.kicker, marginTop: spacing.xs },
  quest: { ...type.title, fontSize: 20 },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  statLabel: { ...type.caption, fontSize: 11, marginTop: 2 },
});
