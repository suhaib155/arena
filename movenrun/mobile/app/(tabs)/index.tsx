import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { QuestCard } from "@/components/QuestCard";
import { XPBar } from "@/components/XPBar";
import { colors, spacing } from "@/theme";
import { QUESTS, getDailyQuest } from "@/data/quests";
import { useGameStore } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const router = useRouter();
  const daily = useMemo(() => getDailyQuest(), []);
  const otherQuests = useMemo(
    () => QUESTS.filter((q) => q.id !== daily.id),
    [daily.id],
  );

  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const level = getLevelInfo(totalXp);

  const openQuest = (id: string) =>
    router.push({ pathname: "/quest/[id]", params: { id } });

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.brand}>Ready to move?</Text>
          </View>
          <View style={styles.streakChip}>
            <Text style={styles.streakNum}>{streak}</Text>
            <Text style={styles.streakLabel}>day streak</Text>
          </View>
        </View>

        <View style={styles.levelBox}>
          <View style={styles.levelHeader}>
            <Text style={styles.levelText}>Level {level.level}</Text>
            <Text style={styles.xpText}>
              {level.xpIntoLevel} / {level.xpForLevel} XP
            </Text>
          </View>
          <XPBar progress={level.progress} />
        </View>

        <Text style={styles.sectionTitle}>Today&apos;s Quest</Text>
        <QuestCard quest={daily} featured onPress={() => openQuest(daily.id)} />

        <Text style={styles.sectionTitle}>More Quests</Text>
        <View style={styles.list}>
          {otherQuests.map((q) => (
            <QuestCard key={q.id} quest={q} onPress={() => openQuest(q.id)} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl, gap: spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.md,
  },
  greeting: { color: colors.textDim, fontSize: 15 },
  brand: { color: colors.text, fontSize: 26, fontWeight: "800" },
  streakChip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  streakNum: { color: colors.warning, fontSize: 22, fontWeight: "800" },
  streakLabel: { color: colors.textDim, fontSize: 11 },
  levelBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  levelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  levelText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  xpText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  list: { gap: spacing.md },
});
