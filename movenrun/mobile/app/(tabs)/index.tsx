import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { StatTrio } from "@/components/StatTrio";
import { AreaMap } from "@/components/AreaMap";
import { Button } from "@/components/Button";
import { XPBar } from "@/components/XPBar";
import { getLevelInfo } from "@/lib/leveling";
import { heldCells } from "@/lib/mapCells";
import { TaskRow } from "@/components/TaskRow";
import { SectionHeader } from "@/components/SectionHeader";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { NotificationBell } from "@/components/NotificationBell";
import { colors, palette, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { useSessionStart } from "@/hooks/useSessionStart";
import { tapFeedback } from "@/lib/haptics";
import {
  boardInputFromState,
  buildTodayBoard,
  xpEarnedToday,
  type Task,
  type TaskAction,
} from "@/lib/tasks";

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
  const totalXp = useGameStore((s) => s.totalXp);
  const level = getLevelInfo(totalXp);
  const mapCells = useMemo(() => heldCells(zones), [zones]);

  /* Every derivation lives in lib/tasks.ts, so it can be unit-tested. Doing it
     inline here is how "Move today" once counted an indoor warmup quest as a
     movement session — a rule no test could reach. */
  const boardInput = boardInputFromState({
    history,
    zones,
    dailyQuestTitle: dailyQuest.title,
    dailyQuestXp: dailyQuest.xpReward,
    dailyQuestDone: dailyCompletedToday,
    hasClub: selectedClubId != null,
  });
  const board = buildTodayBoard(boardInput);
  const xpToday = xpEarnedToday(history);
  const atRiskCount = boardInput.atRiskZoneCount;

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
          <Card>
            <View style={styles.playerRow}>
              <Text style={styles.playerLevel}>Level {level.level}</Text>
              <Text style={styles.playerXp}>{totalXp.toLocaleString()} XP</Text>
            </View>
            <XPBar progress={level.progress} />
            <StatTrio
              items={[
                { value: streak, label: "Day streak", tint: palette.heatCoral },
                { value: `+${xpToday}`, label: "XP today", tint: palette.moveGold },
                { value: zones.length, label: "Preview zones", tint: palette.pulseGreen },
              ]}
            />
          </Card>
        </FadeSlideIn>

        <Card>
          <SectionHeader title="Today's objective" trailing={board.progressLabel} />
          <Text style={styles.objective}>{board.focus?.title ?? "Keep your momentum"}</Text>
          <Button label={board.focus ? "View objective" : "Explore Territory"} variant="ghost" icon="arrow-forward" onPress={() => board.focus ? openTask(board.focus) : go("territory")} />
        </Card>

        <View style={styles.mapHero}>
          <SectionHeader title="Your territory" trailing="Preview" />
          <AreaMap cells={mapCells} style={styles.mapArea} onPressCell={() => go("territory")} />
          <Button label="Start Move" icon="walk-outline" onPress={() => go("move")} />
        </View>

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

        <Text style={styles.footer}>One move closer.</Text>
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
  playerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: spacing.sm },
  playerLevel: { ...type.heading },
  playerXp: { ...type.caption },
  objective: { ...type.title },
  mapHero: { gap: spacing.sm },
  mapArea: { minHeight: 310 },
  footer: {
    ...type.mono,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
