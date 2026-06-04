import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { XPBar } from "@/components/XPBar";
import { colors, radius, spacing } from "@/theme";
import { getQuest } from "@/data/quests";
import { useGameStore, type CompletionOutcome } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";

export default function ResultScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const quest = getQuest(id);
  const completeQuest = useGameStore((s) => s.completeQuest);

  const [outcome, setOutcome] = useState<CompletionOutcome | null>(null);
  // Award XP exactly once, even if the component re-renders.
  const awardedRef = useRef(false);

  useEffect(() => {
    if (awardedRef.current || !quest) return;
    awardedRef.current = true;
    setOutcome(completeQuest(quest));
  }, [quest, completeQuest]);

  const goHome = () => router.dismissAll();

  if (!quest || !outcome) {
    return (
      <Screen>
        <View style={styles.center} />
      </Screen>
    );
  }

  const level = getLevelInfo(outcome.totalXpAfter);

  return (
    <Screen edgeTop>
      <View style={styles.body}>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={48} color={colors.bg} />
        </View>

        <Text style={styles.title}>Quest Complete!</Text>
        <Text style={styles.questName}>{quest.title}</Text>

        <View style={styles.xpBubble}>
          <Ionicons name="flash" size={22} color={colors.warning} />
          <Text style={styles.xpGained}>+{outcome.xpGained} XP</Text>
        </View>

        {outcome.leveledUp ? (
          <View style={styles.levelUp}>
            <Ionicons name="arrow-up-circle" size={18} color={colors.accent} />
            <Text style={styles.levelUpText}>
              Level up! You reached level {outcome.levelAfter}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.levelRow}>
            <Text style={styles.levelLabel}>Level {level.level}</Text>
            <Text style={styles.levelXp}>
              {level.xpIntoLevel} / {level.xpForLevel} XP
            </Text>
          </View>
          <XPBar progress={level.progress} />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="flame" size={20} color={colors.warning} />
            <Text style={styles.statValue}>{outcome.streak}</Text>
            <Text style={styles.statLabel}>
              day streak{outcome.streakIncreased ? " 🔥" : ""}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Ionicons name="trophy" size={20} color={colors.accent} />
            <Text style={styles.statValue}>{outcome.totalXpAfter}</Text>
            <Text style={styles.statLabel}>total XP</Text>
          </View>
        </View>

        {outcome.alreadyCompletedToday ? (
          <Text style={styles.note}>
            You already moved today — streak stays the same. Keep it up tomorrow!
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Button label="Done" icon="home" onPress={goHome} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  questName: { color: colors.textDim, fontSize: 16 },
  xpBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  xpGained: { color: colors.warning, fontSize: 24, fontWeight: "800" },
  levelUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${colors.accent}1A`,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  levelUpText: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  levelRow: { flexDirection: "row", justifyContent: "space-between" },
  levelLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  levelXp: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  statsRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  stat: { flex: 1, alignItems: "center", gap: spacing.xs },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.textDim, fontSize: 12 },
  divider: { width: 1, backgroundColor: colors.border },
  note: {
    color: colors.textFaint,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  footer: { paddingVertical: spacing.md },
});
