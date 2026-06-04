import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";

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
        <Ionicons name="flame" size={18} color={colors.accent} />
        <Text style={styles.brand}>MovenRun</Text>
      </View>

      <Text style={styles.label}>Quest complete</Text>
      <Text style={styles.quest} numberOfLines={1}>{questTitle}</Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.warning }]}>+{xpGained}</Text>
          <Text style={styles.statLabel}>XP</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.accent }]}>{level}</Text>
          <Text style={styles.statLabel}>Level</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.danger }]}>{streak}🔥</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brand: { color: colors.text, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  label: { color: colors.textDim, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  quest: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
});
