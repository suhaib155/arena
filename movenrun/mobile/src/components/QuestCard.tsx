import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { categoryColor, colors, difficultyColor, radius, spacing } from "@/theme";
import type { Quest } from "@/types";
import { Badge } from "./Badge";

interface QuestCardProps {
  quest: Quest;
  onPress: () => void;
  /** Larger "hero" treatment for the daily quest. */
  featured?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

export function QuestCard({ quest, onPress, featured }: QuestCardProps) {
  const tint = categoryColor[quest.category] ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        featured && styles.featured,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: `${tint}22` }]}>
          <Ionicons name={quest.icon} size={featured ? 28 : 22} color={tint} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, featured && styles.titleFeatured]} numberOfLines={1}>
            {quest.title}
          </Text>
          <Text style={styles.summary} numberOfLines={2}>
            {quest.summary}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Badge label={quest.category} color={tint} />
        <Badge label={quest.difficulty} color={difficultyColor[quest.difficulty] ?? colors.textDim} />
        <View style={styles.spacer} />
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={14} color={colors.textDim} />
          <Text style={styles.metaText}>{formatDuration(quest.durationSeconds)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="flash-outline" size={14} color={colors.warning} />
          <Text style={[styles.metaText, { color: colors.warning }]}>+{quest.xpReward} XP</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  featured: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceAlt,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }],
  },
  header: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  titleFeatured: {
    fontSize: 20,
    fontWeight: "800",
  },
  summary: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  spacer: { flex: 1 },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: "600",
  },
});
