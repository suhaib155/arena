import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, palette, radius, spacing, type } from "@/theme";
import type { Task } from "@/lib/tasks";
import { Card } from "./Card";
import { ScalePress } from "./ScalePress";
import { TASK_TINT } from "./taskTone";

interface TaskRowProps {
  task: Task;
  onPress: () => void;
}

/**
 * One line of the checklist.
 *
 * The anatomy is fixed — leading state disc, title over one line of detail,
 * trailing accessory — because a checklist is read as a *column*, not as a set
 * of individual cards. You should be able to see how much is left without
 * reading a word.
 *
 * The disc keeps the same square-with-soft-corners shape in both states and
 * changes only its colour and glyph. Swapping to a circle when done would make
 * the column ripple as items complete, which reads as a rendering bug — that
 * inconsistency is exactly what this design system exists to prevent.
 */
export function TaskRow({ task, onPress }: TaskRowProps) {
  const done = task.state === "done";
  const tint = done ? palette.pulseGreen : TASK_TINT[task.tone];

  return (
    <ScalePress
      to={0.985}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}. ${done ? "Done." : task.detail}`}
      accessibilityHint={done ? undefined : "Opens this task"}
    >
      <Card style={[styles.row, done ? styles.rowDone : null]}>
        <View style={[styles.disc, { backgroundColor: `${tint}18` }]}>
          <Ionicons name={done ? "checkmark" : task.icon} size={19} color={tint} />
        </View>

        <View style={styles.body}>
          <Text style={[styles.title, done ? styles.titleDone : null]} numberOfLines={1}>
            {task.title}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {task.detail}
          </Text>
        </View>

        {task.reward > 0 && !done ? (
          <View style={styles.reward}>
            <Text style={styles.rewardText}>+{task.reward}</Text>
          </View>
        ) : (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={done ? colors.textFaint : colors.textDim}
          />
        )}
      </Card>
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // Completed work recedes; it stays legible, and stays tappable.
  rowDone: { backgroundColor: colors.surfaceAlt, shadowOpacity: 0.03, elevation: 1 },
  disc: { ...iconTile(44) },
  body: { flex: 1, gap: 2 },
  title: { ...type.heading, fontSize: 15 },
  titleDone: { color: colors.textDim },
  detail: { ...type.caption, fontSize: 12, color: colors.textFaint },
  reward: {
    backgroundColor: `${palette.moveGold}1F`,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  // Darkened MOVE Gold — the token itself doesn't clear 4.5:1 on its own tint.
  rewardText: { ...type.mono, fontSize: 12, fontWeight: "700", color: "#B07908" },
});
