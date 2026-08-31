import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { StatTrio } from "@/components/StatTrio";
import { TaskHero } from "@/components/TaskHero";
import { TaskRow } from "@/components/TaskRow";
import { SectionHeader } from "@/components/SectionHeader";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { NotificationBell } from "@/components/NotificationBell";
import { colors, palette, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { useSessionStart } from "@/hooks/useSessionStart";
import { zoneStatus } from "@/lib/territory";
import { getLocalDateKey } from "@/lib/date";
import { tapFeedback } from "@/lib/haptics";
import { buildTodayBoard, type Task, type TaskAction } from "@/lib/tasks";

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Home — today's board.
 *
 * The screen decides nothing. It reads state, hands it to `buildTodayBoard`,
 * and renders what comes back. The previous version imported twelve builder
 * modules and computed eighty lines of derived state inline, which is why its
 * "exactly one primary action" rule kept breaking: the rule lived here, where
 * nothing could test it.
 *
 * Four blocks, in the order a moving person needs them: who/when, what to do,
 * how you're doing, what's left. Every other destination lives in the tab bar
 * or the Profile directory — Home does not need to be a menu.
 */
export default function TodayScreen() {
  const router = useRouter();
  const { dailyQuest, dailyCompletedToday } = useSessionStart();

  const streak = useGameStore((s) => s.streak);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const selectedClubId = useGameStore((s) => s.selectedClubId);

  const todayKey = getLocalDateKey();
  const todaysRecords = history.filter(
    (rec) => getLocalDateKey(new Date(rec.completedAt)) === todayKey,
  );
  const xpToday = todaysRecords.reduce((sum, rec) => sum + rec.xp, 0);
  const atRiskCount = zones.filter((z) => zoneStatus(z).health !== "yours").length;

  const board = buildTodayBoard({
    /* Persistent movement recovery isn't implemented — finished routes live only
       in memory during the summary flow — so there is genuinely never a session
       to resume. Honest today; the board already supports the state. */
    hasRecoverableMovement: false,
    movedToday: todaysRecords.length > 0,
    atRiskZoneCount: atRiskCount,
    zonesOwned: zones.length,
    dailyQuestTitle: dailyQuest.title,
    dailyQuestXp: dailyQuest.xpReward,
    dailyQuestDone: dailyCompletedToday,
    hasClub: selectedClubId != null,
  });

  /** Semantic task actions become concrete routes here, and only here. */
  const go = (action: TaskAction) => {
    tapFeedback();
    switch (action) {
      case "move":
        return router.push("/move");
      case "territory":
        return router.push("/territory/map");
      case "clubs":
        return router.push("/clubs");
      case "quest":
        return router.push({ pathname: "/quest/[id]", params: { id: dailyQuest.id } });
    }
  };
  const openTask = (task: Task) => go(task.action);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.brand}>MOVENRUN</Text>
            <Text style={styles.greeting}>{greeting()}</Text>
          </View>
          <NotificationBell
            unread={atRiskCount > 0}
            onPress={() => {
              tapFeedback();
              router.push("/territory/alerts");
            }}
          />
        </View>

        <FadeSlideIn>
          <TaskHero board={board} onStart={openTask} onMoveAnyway={() => go("move")} />
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <Card>
            <StatTrio
              items={[
                { value: streak, label: "Day streak", tint: palette.heatCoral },
                { value: `+${xpToday}`, label: "XP today", tint: palette.moveGold },
                { value: zones.length, label: "Zones held", tint: palette.pulseGreen },
              ]}
            />
          </Card>
        </FadeSlideIn>

        {board.tasks.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.list}>
              <SectionHeader title="Today" trailing={board.progressLabel} />
              {board.tasks.map((task) => (
                <TaskRow key={task.id} task={task} onPress={() => openTask(task)} />
              ))}
            </View>
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footer}>Move → Capture → Defend → Own</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  brand: { ...type.kicker, color: colors.primary },
  greeting: { ...type.display, fontSize: 28, lineHeight: 34 },
  list: { gap: spacing.sm },
  footer: {
    ...type.mono,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
