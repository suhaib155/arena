import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScalePress } from "./ScalePress";
import { GameBadge } from "./GameBadge";
import { colors, palette, radius, spacing, type } from "@/theme";
import type { Task } from "@/lib/tasks";

/** Task identity and qualification remain owned by the existing board. */
export function MissionCard({ task, progressLabel, onPress }: { task: Task; progressLabel: string; onPress(): void }) {
  return <ScalePress onPress={onPress} accessibilityRole="button" accessibilityLabel={`${task.title}. ${task.detail}. ${task.cta}`} style={styles.root}>
    <View style={styles.top}><Text style={styles.kicker}>TODAY'S MISSION</Text><Text style={styles.progress}>{progressLabel}</Text></View>
    <View style={styles.row}>
      <GameBadge icon={task.icon} tone={task.tone === "gold" ? "gold" : task.tone === "green" ? "green" : "blue"} size={42} />
      <View style={styles.words}><Text style={styles.title}>{task.title}</Text><Text style={styles.detail}>{task.detail}</Text></View>
      <Ionicons name="arrow-forward" size={21} color={colors.surface} />
    </View>
    {task.reward > 0 ? <Text style={styles.reward}>{task.reward} XP objective</Text> : null}
  </ScalePress>;
}
const styles = StyleSheet.create({
  root: { backgroundColor: palette.deepInk, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  top: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.xs },
  kicker: { ...type.kicker, fontSize: 9, color: palette.voltMint }, progress: { ...type.caption, fontSize: 10, color: palette.dustGray },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md }, words: { flex: 1, gap: spacing.xs },
  title: { ...type.heading, fontSize: 18, lineHeight: 24, color: colors.surface },
  detail: { ...type.caption, fontSize: 12, lineHeight: 17, color: palette.dustGray }, reward: { ...type.caption, color: palette.moveGold, textAlign: "right" },
});
