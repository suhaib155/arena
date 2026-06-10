import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  categoryColor,
  colors,
  difficultyColor,
  palette,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import type { Quest } from "@/types";
import { Badge } from "./Badge";
import { ScalePress } from "./ScalePress";

interface QuestCardProps {
  quest: Quest;
  onPress: () => void;
  /** Larger "hero" treatment for the daily quest. */
  featured?: boolean;
  /** Show a "Done today" state (quest already completed this local day). */
  completed?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

export function QuestCard({ quest, onPress, featured, completed }: QuestCardProps) {
  const tint = categoryColor[quest.category] ?? colors.primary;
  return (
    <ScalePress
      onPress={onPress}
      to={0.98}
      style={[styles.card, featured ? styles.featured : {}, completed ? styles.completed : {}]}
    >
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: `${tint}1A` }]}>
          <Ionicons name={quest.icon} size={featured ? 26 : 22} color={tint} />
        </View>
        <View style={styles.headerText}>
          <Text
            style={[styles.title, featured ? styles.titleFeatured : null]}
            numberOfLines={1}
          >
            {quest.title}
          </Text>
          <Text style={styles.summary} numberOfLines={2}>
            {quest.summary}
          </Text>
        </View>
        {completed ? (
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark-circle" size={15} color={palette.pulseGreen} />
            <Text style={styles.doneBadgeText}>Done</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Badge label={quest.category} color={tint} />
        <Badge
          label={quest.difficulty}
          color={difficultyColor[quest.difficulty] ?? colors.textDim}
        />
        <View style={styles.spacer} />
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={14} color={colors.textFaint} />
          <Text style={styles.metaText}>{formatDuration(quest.durationSeconds)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="flash" size={14} color={palette.moveGold} />
          <Text style={[styles.metaText, styles.metaXp]}>+{quest.xpReward} XP</Text>
        </View>
      </View>
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  featured: {
    padding: spacing.xl,
    ...shadows.float,
  },
  completed: {
    backgroundColor: colors.surfaceAlt,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: `${palette.pulseGreen}1A`,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  doneBadgeText: { color: palette.pulseGreen, fontSize: 11, fontWeight: "700" },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 2 },
  title: { ...type.heading, fontSize: 16 },
  titleFeatured: { fontSize: 20, letterSpacing: -0.4 },
  summary: { ...type.caption, fontSize: 13, lineHeight: 18 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  spacer: { flex: 1 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { ...type.mono, fontSize: 12.5 },
  metaXp: { color: "#B07908", fontWeight: "700" },
});
