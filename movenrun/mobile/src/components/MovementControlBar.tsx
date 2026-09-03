import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, palette, radius, shadows, spacing, type } from "@/theme";
import { ScalePress } from "./ScalePress";

interface MovementControlBarProps {
  paused: boolean;
  /**
   * True while the session is still starting — the tracker has been asked to
   * run and has not confirmed yet.
   *
   * The controls are inert rather than hidden: the bar keeps its size and
   * position, so nothing shifts under a thumb already reaching for it.
   * `ScalePress` turns this into `accessibilityState.disabled` itself, so the
   * state is announced rather than only dimmed.
   */
  disabled?: boolean;
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
export function MovementControlBar({
  paused,
  disabled = false,
  onPauseResume,
  onFinish,
}: MovementControlBarProps) {
  return (
    <View style={styles.bar}>
      <ScalePress
        to={0.96}
        onPress={onPauseResume}
        disabled={disabled}
        style={[styles.control, styles.secondary, disabled && styles.inert]}
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
        disabled={disabled}
        style={[styles.control, styles.finish, disabled && styles.inert]}
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
  /* Dimmed, not removed. The control keeps its box so the layout cannot shift
     between "starting" and "moving" while a thumb is on the way to it. */
  inert: { opacity: 0.5 },
  finish: { backgroundColor: colors.primary, ...glow(colors.primary) },
  controlLabel: { ...type.heading, fontSize: 16, color: colors.text },
  finishLabel: { color: colors.surface },
});
