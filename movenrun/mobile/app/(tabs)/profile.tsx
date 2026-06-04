import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { StatCard } from "@/components/StatCard";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { XPBar } from "@/components/XPBar";
import { Button } from "@/components/Button";
import { colors, radius, spacing } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";
import { tapFeedback } from "@/lib/haptics";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const questsCompleted = useGameStore((s) => s.questsCompleted);
  const history = useGameStore((s) => s.history);
  const reset = useGameStore((s) => s.reset);
  const level = getLevelInfo(totalXp);

  const onReset = () => {
    tapFeedback();
    reset();
  };

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={36} color={colors.text} />
          </View>
          <Text style={styles.name}>Mover</Text>
          <Text style={styles.subtitle}>Level {level.level} • {totalXp} XP total</Text>
          <View style={styles.heroBar}>
            <XPBar
              progress={level.progress}
              label={`${level.xpForLevel - level.xpIntoLevel} XP to level ${level.level + 1}`}
            />
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatCard icon="flame" value={streak} label="Day streak" tint={colors.warning} />
          <StatCard icon="trophy" value={level.level} label="Level" tint={colors.accent} />
          <StatCard icon="checkmark-done" value={questsCompleted} label="Completed" tint={colors.primary} />
        </View>

        <SectionHeader title="Recent Activity" trailing={history.length ? `${history.length}` : undefined} />
        {history.length === 0 ? (
          <EmptyState
            icon="walk-outline"
            title="No quests yet"
            message="Complete your first quest to earn XP and start a daily streak."
            actionLabel="Browse quests"
            onAction={() => router.navigate("/")}
          />
        ) : (
          <View style={styles.list}>
            {history.slice(0, 10).map((rec, i) => (
              <View key={`${rec.questId}-${i}`} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="checkmark" size={16} color={colors.accent} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{rec.questTitle}</Text>
                  <Text style={styles.rowTime}>{timeAgo(rec.completedAt)}</Text>
                </View>
                <Text style={styles.rowXp}>+{rec.xp} XP</Text>
              </View>
            ))}
          </View>
        )}

        {history.length > 0 ? (
          <Button
            label="Reset progress"
            variant="ghost"
            icon="refresh-outline"
            onPress={onReset}
            style={styles.resetBtn}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { alignItems: "center", gap: spacing.xs },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  name: { color: colors.text, fontSize: 24, fontWeight: "800" },
  subtitle: { color: colors.textDim, fontSize: 14 },
  heroBar: { alignSelf: "stretch", marginTop: spacing.md },
  statsRow: { flexDirection: "row", gap: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: `${colors.accent}22`,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  rowTime: { color: colors.textFaint, fontSize: 12 },
  rowXp: { color: colors.warning, fontSize: 14, fontWeight: "700" },
  resetBtn: { marginTop: spacing.sm },
});
