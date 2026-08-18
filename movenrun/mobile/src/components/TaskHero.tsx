import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, palette, spacing, type } from "@/theme";
import { TASK_ACTION_ICON, type Task, type TodayBoard } from "@/lib/tasks";
import { Button } from "./Button";
import { Card } from "./Card";
import { XPBar } from "./XPBar";
import { TASK_TINT } from "./taskTone";

interface TaskHeroProps {
  board: TodayBoard;
  /** Act on the spotlight task. Not called when the board is all done. */
  onStart: (task: Task) => void;
  /** The one thing you can always do, even with nothing outstanding. */
  onMoveAnyway: () => void;
}

/**
 * The spotlight: the single thing to do next, and the screen's only primary
 * button.
 *
 * Every mature fitness app opens the same way — Nike Run Club's start button,
 * Strava's record tab, Apple Fitness' rings — one unmissable action above
 * everything else. The failure mode is a home screen of equally-weighted cards
 * where the user has to *choose* before they can *move*, and choosing is the
 * friction that loses the session.
 *
 * So this card wins by construction: it is the only `hero` surface on the
 * screen and the only place a primary button is rendered. When the board is
 * finished it does not vanish (which would collapse the layout and hide the
 * accomplishment) — it turns into the all-clear state, keeping the position and
 * offering a deliberately subordinate "move anyway".
 */
export function TaskHero({ board, onStart, onMoveAnyway }: TaskHeroProps) {
  const task = board.focus;
  const tint = task ? TASK_TINT[task.tone] : palette.pulseGreen;

  return (
    <Card variant="hero">
      <View style={styles.head}>
        <View style={[styles.disc, { backgroundColor: `${tint}18` }]}>
          <Ionicons
            name={task ? task.icon : "checkmark-done"}
            size={22}
            color={tint}
          />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.kicker, { color: tint }]}>
            {task ? "Next up" : "All clear"}
          </Text>
          <Text style={styles.progress}>{board.progressLabel}</Text>
        </View>
      </View>

      <Text style={styles.title}>{task ? task.title : "Today is done"}</Text>
      <Text style={styles.detail}>
        {task ? task.detail : "Everything on today's board is finished. Nice work."}
      </Text>

      <XPBar progress={board.progress} />

      {task ? (
        /* The glyph follows the task's action, not the task's own icon and not
           a constant — see TASK_ACTION_ICON. */
        <Button
          label={task.cta}
          icon={TASK_ACTION_ICON[task.action]}
          onPress={() => onStart(task)}
          style={styles.cta}
        />
      ) : (
        <Button
          label="Move anyway"
          icon={TASK_ACTION_ICON.move}
          variant="secondary"
          onPress={onMoveAnyway}
          style={styles.cta}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  disc: { ...iconTile(46) },
  headText: { flex: 1, gap: 2 },
  kicker: { ...type.kicker },
  progress: { ...type.mono, fontSize: 12.5, color: colors.textDim },
  title: { ...type.title, fontSize: 24, lineHeight: 30 },
  detail: { ...type.body, fontSize: 14.5 },
  cta: { marginTop: spacing.xs },
});
