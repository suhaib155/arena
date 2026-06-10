import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { categoryColor, colors, difficultyColor, palette, radius, shadows, spacing, type } from "@/theme";
import { questService } from "@/services/questService";
import { useIsCompletedToday } from "@/store/useGameStore";
import { tapFeedback } from "@/lib/haptics";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

export default function QuestDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const quest = questService.getQuestById(id ?? "");
  const completedToday = useIsCompletedToday(id ?? "");

  if (!quest) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Quest" }} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textFaint} />
          <Text style={styles.notFoundText}>That quest doesn&apos;t exist.</Text>
          <Button label="Back to quests" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const tint = categoryColor[quest.category] ?? colors.primary;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.topBar}>
          <Ionicons
            name="chevron-back"
            size={28}
            color={colors.text}
            onPress={() => router.back()}
          />
        </View>

        <View style={[styles.iconWrap, { backgroundColor: `${tint}22` }]}>
          <Ionicons name={quest.icon} size={40} color={tint} />
        </View>

        <Text style={styles.title}>{quest.title}</Text>
        <Text style={styles.summary}>{quest.description}</Text>

        <View style={styles.badges}>
          <Badge label={quest.category} color={tint} />
          <Badge label={quest.difficulty} color={difficultyColor[quest.difficulty] ?? colors.textDim} />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="time-outline" size={18} color={colors.textDim} />
            <Text style={styles.statValue}>{formatDuration(quest.durationSeconds)}</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Ionicons name="flash" size={18} color={palette.moveGold} />
            <Text style={[styles.statValue, { color: "#B07908" }]}>+{quest.xpReward}</Text>
            <Text style={styles.statLabel}>XP Reward</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>How it works</Text>
        <View style={styles.steps}>
          {quest.instructions.map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {completedToday ? (
          <>
            <Button label="Completed today" icon="checkmark-done" disabled onPress={() => {}} />
            <Text style={styles.doneHint}>
              You&apos;ve earned XP for this quest today. Come back tomorrow!
            </Text>
          </>
        ) : (
          <Button
            label="Start Quest"
            icon="play"
            onPress={() => {
              tapFeedback();
              router.push({ pathname: "/active", params: { id: quest.id } });
            }}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl, gap: spacing.md },
  topBar: { paddingTop: spacing.sm, marginBottom: spacing.xs },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...type.display, fontSize: 28 },
  summary: { ...type.body, lineHeight: 22 },
  badges: { flexDirection: "row", gap: spacing.sm },
  statsRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
    ...shadows.card,
  },
  stat: { flex: 1, alignItems: "center", gap: spacing.xs },
  statValue: { ...type.title, fontSize: 20 },
  statLabel: { ...type.caption, fontSize: 12 },
  divider: { width: 1, backgroundColor: colors.surfaceAlt },
  sectionTitle: {
    ...type.heading,
    fontSize: 18,
    marginTop: spacing.md,
  },
  steps: { gap: spacing.md },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  stepText: { flex: 1, color: colors.textDim, fontSize: 15, lineHeight: 22 },
  footer: { paddingVertical: spacing.md, gap: spacing.sm },
  doneHint: {
    color: colors.textDim,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  notFoundText: { color: colors.textDim, fontSize: 16 },
});
