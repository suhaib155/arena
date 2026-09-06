import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { PlayerHud } from "@/components/PlayerHud";
import { DisplayHeading } from "@/components/DisplayHeading";
import { MissionCard } from "@/components/MissionCard";
import { MeterRow } from "@/components/MeterRow";
import { TaskRow } from "@/components/TaskRow";
import { SectionHeader } from "@/components/SectionHeader";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { NotificationBell } from "@/components/NotificationBell";
import { colors, palette, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { useSessionStart } from "@/hooks/useSessionStart";
import { tapFeedback } from "@/lib/haptics";
import { lockedMovePreview } from "@/lib/lockedMove";
import {
  boardInputFromState,
  buildTodayBoard,
  TASK_ACTION_ICON,
  xpEarnedToday,
  type Task,
  type TaskAction,
} from "@/lib/tasks";

/** The core loop, as typography. Four words, in the order they happen. */
const LOOP_RAIL = ["MOVE", "CAPTURE", "DEFEND", "OWN"] as const;

/**
 * Home — today's board, as a game.
 *
 * The screen still decides nothing: it reads state, hands it to
 * `buildTodayBoard`, and renders what comes back. What changed is the *shape*
 * of what it renders.
 *
 * The previous version opened on "Good morning" over a stack of white cards of
 * near-equal weight — a greeting, a hero card, a stat card, a checklist. It was
 * tidy and it was inert: nothing on it said what game you were playing, nothing
 * carried your progress between screens, and the one action you were meant to
 * take had to be found among three other cards of similar size.
 *
 * Four blocks now, in the order a player needs them:
 *
 *  1. **Who you are** — the resource header. Level, rank, XP, Locked MOVE
 *     preview, and the bar to the next level. Persistent across screens, so the
 *     app has a continuous player rather than re-introducing you each time.
 *  2. **What this is** — one editorial headline and the loop rail. No card.
 *  3. **What to do** — the mission, on the dark ground: the only dark object on
 *     a light page, and the only primary action on the screen.
 *  4. **How it is going** — three meters, then the rest of the board.
 *
 * Every destination is one the app already had; nothing was relocated and no
 * new route exists.
 */
export default function TodayScreen() {
  const router = useRouter();
  const { dailyQuest, dailyCompletedToday } = useSessionStart();

  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const selectedClubId = useGameStore((s) => s.selectedClubId);

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
  const lockedMove = lockedMovePreview(totalXp);
  const focus = board.focus;

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
        <PlayerHud
          name="Mover"
          totalXp={totalXp}
          lockedMove={lockedMove}
          trailing={
            <NotificationBell
              unread={atRiskCount > 0}
              onPress={() => {
                tapFeedback();
                router.push("/territory/alerts");
              }}
            />
          }
        />

        <DisplayHeading
          kicker="MOVENRUN"
          title={focus ? "Make your next move." : "Today is yours."}
          rail={LOOP_RAIL}
        />

        {/* The spotlight. When the board is finished it does not vanish —
            that would collapse the layout and hide the accomplishment. It keeps
            its position and offers a deliberately subordinate "move anyway". */}
        <FadeSlideIn>
          {focus ? (
            <MissionCard
              kicker="Next mission"
              title={focus.title}
              detail={focus.detail}
              ctaLabel={focus.cta}
              ctaIcon={TASK_ACTION_ICON[focus.action]}
              onPress={() => openTask(focus)}
              icon={focus.icon}
              tone={focus.tone}
              reward={focus.reward}
              progressLabel={board.progressLabel}
              progress={board.progress}
            />
          ) : (
            <MissionCard
              kicker="All clear"
              title="Everything on today's board is done."
              detail="Nothing is owed. A move now still counts — distance, sealing and territory work every day."
              ctaLabel="Move anyway"
              ctaIcon={TASK_ACTION_ICON.move}
              onPress={() => go("move")}
              icon="checkmark-done"
              tone="green"
              progressLabel={board.progressLabel}
              progress={1}
            />
          )}
        </FadeSlideIn>

        {/* Three meters: one streak, one holding, one proportion. `xpToday` is
            a plain count and gets no bar — the game sets no daily XP target, and
            drawing an empty track under it would invent one. */}
        <FadeSlideIn delay={STAGGER_MS}>
          <MeterRow
            meters={[
              {
                icon: "flame",
                value: String(streak),
                label: "Day streak",
                tint: palette.heatCoral,
              },
              {
                icon: "shapes",
                value: String(zones.length),
                label: "Zones held",
                tint: palette.pulseGreen,
              },
              {
                icon: "flash",
                value: `+${xpToday}`,
                label: "XP today",
                tint: palette.moveGold,
              },
            ]}
          />
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
  list: { gap: spacing.sm },
  footer: {
    ...type.mono,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
