import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { QuestCard } from "@/components/QuestCard";
import { SectionHeader } from "@/components/SectionHeader";
import { XPBar } from "@/components/XPBar";
import { colors, radius, spacing } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { useSessionStart } from "@/hooks/useSessionStart";
import { getLevelInfo } from "@/lib/leveling";
import { tapFeedback } from "@/lib/haptics";

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const router = useRouter();
  const {
    dailyQuest,
    recommendedQuests,
    completedTodayIds,
    dailyCompletedToday,
  } = useSessionStart();

  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const level = getLevelInfo(totalXp);

  const openQuest = (id: string) => {
    tapFeedback();
    router.push({ pathname: "/quest/[id]", params: { id } });
  };

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.brand}>
              {dailyCompletedToday ? "You've moved today" : "Ready to move?"}
            </Text>
          </View>
          <View style={styles.streakChip}>
            <Text style={styles.streakNum}>{streak}</Text>
            <Text style={styles.streakLabel}>day streak</Text>
          </View>
        </View>

        {dailyCompletedToday ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
            <Text style={styles.doneText}>
              Daily quest done — streak safe. Try a bonus quest below for more XP.
            </Text>
          </View>
        ) : null}

        <View style={styles.levelBox}>
          <View style={styles.levelHeader}>
            <Text style={styles.levelText}>Level {level.level}</Text>
            <Text style={styles.xpText}>
              {level.xpIntoLevel} / {level.xpForLevel} XP
            </Text>
          </View>
          <XPBar progress={level.progress} />
        </View>

        <SectionHeader title="Today's Quest" />
        <QuestCard
          quest={dailyQuest}
          featured
          completed={dailyCompletedToday}
          onPress={() => openQuest(dailyQuest.id)}
        />

        <SectionHeader title="More Quests" trailing={`${recommendedQuests.length}`} />
        <View style={styles.list}>
          {recommendedQuests.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              completed={completedTodayIds.includes(q.id)}
              onPress={() => openQuest(q.id)}
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1 },
  greeting: { color: colors.textDim, fontSize: 15 },
  brand: { color: colors.text, fontSize: 26, fontWeight: "800" },
  streakChip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  streakNum: { color: colors.warning, fontSize: 22, fontWeight: "800" },
  streakLabel: { color: colors.textDim, fontSize: 11 },
  doneBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${colors.accent}14`,
    borderWidth: 1,
    borderColor: `${colors.accent}40`,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  doneText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  levelBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
  list: { gap: spacing.md },
});
