import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { AreaMap } from "@/components/AreaMap";
import { Button } from "@/components/Button";
import { heldCells } from "@/lib/mapCells";
import { TaskRow } from "@/components/TaskRow";
import { SectionHeader } from "@/components/SectionHeader";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { NotificationBell } from "@/components/NotificationBell";
import { PlayerHud } from "@/components/PlayerHud";
import { MissionCard } from "@/components/MissionCard";
import { MeterRow } from "@/components/MeterRow";
import { DisplayHeading } from "@/components/DisplayHeading";
import { spacing } from "@/theme";
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
        <PlayerHud totalXp={totalXp} streak={streak} trailing={<NotificationBell
            unread={atRiskCount > 0}
            onPress={() => {
              tapFeedback();
              router.push("/territory/alerts");
            }}
          />} />
        <DisplayHeading eyebrow="MOVENRUN" title="Make your next move." />
        {board.focus ? <MissionCard task={board.focus} progressLabel={board.progressLabel} onPress={() => openTask(board.focus!)} /> : null}

        <View style={styles.mapHero}>
          <SectionHeader title="Your ground" trailing="Preview" />
          <AreaMap cells={mapCells} style={styles.mapArea} onPressCell={() => go("territory")} />
          <Button label="Start Move" icon="walk-outline" onPress={() => go("move")} />
        </View>

        <MeterRow items={[
          { value: `+${xpToday}`, label: "XP today", tone: "gold" },
          { value: zones.length, label: "Preview zones", tone: "green" },
          { value: board.progressLabel, label: "Today's objectives", tone: "blue" },
        ]} />

        {board.tasks.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.list}>
              <SectionHeader title="Keep exploring" />
              {board.tasks.map((task) => (
                <TaskRow key={task.id} task={task} onPress={() => openTask(task)} />
              ))}
            </View>
          </FadeSlideIn>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.md },
  list: { gap: spacing.sm },
  mapHero: { gap: spacing.sm },
  mapArea: { minHeight: 310 },
});
