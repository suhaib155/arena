import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, palette, radius, shadows, spacing, type } from "@/theme";
import { ScalePress } from "./ScalePress";

interface MovementControlBarProps {
  paused: boolean;
  onPauseResume: () => void;
  /** Called on an intentional finish. The caller is expected to confirm first
   *  (e.g. a dialog) so a finish is never accidental. */
  onFinish: () => void;
}

/**
 * Bottom control bar for an active session: a large Pause/Resume control and a
 * distinct, separated Finish control. Both are ≥56 px tall with clear labels
 * and accessibility roles. Finish is visually and spatially separated from
 * Pause so it can't be hit by accident, and the active vs paused state is
 * unmistakable from the Pause/Resume button's icon + label + colour (not colour
 * alone).
 */
export function MovementControlBar({ paused, onPauseResume, onFinish }: MovementControlBarProps) {
  return (
    <View style={styles.bar}>
      <ScalePress
        to={0.96}
        onPress={onPauseResume}
        style={[styles.control, styles.secondary]}
        accessibilityRole="button"
        accessibilityLabel={paused ? "Resume session" : "Pause session"}
      >
        <Ionicons
          name={paused ? "play" : "pause"}
          size={22}
          color={paused ? palette.pulseGreen : colors.text}
        />
        <Text style={[styles.controlLabel, paused && { color: palette.pulseGreen }]}>
          {paused ? "Resume" : "Pause"}
        </Text>
      </ScalePress>

      <ScalePress
        to={0.96}
        onPress={onFinish}
        style={[styles.control, styles.finish]}
        accessibilityRole="button"
        accessibilityLabel="Finish session"
        accessibilityHint="Ends and reviews this movement session"
      >
        <Ionicons name="flag" size={20} color={colors.surface} />
        <Text style={[styles.controlLabel, styles.finishLabel]}>Finish</Text>
      </ScalePress>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: spacing.md },
  control: {
    flex: 1,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  secondary: { backgroundColor: colors.surface, ...shadows.card },
  finish: { backgroundColor: colors.primary, ...glow(colors.primary) },
  controlLabel: { ...type.heading, fontSize: 16, color: colors.text },
  finishLabel: { color: colors.surface },
});
