import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, shadows } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";

interface FloatingMapControlProps {
  icon: IoniconName;
  /** Required — the control is icon-only, so it must describe itself. */
  accessibilityLabel: string;
  onPress: () => void;
  /** Toggle/filter controls expose their selected state (not colour-only: the
   *  a11y state is also set). */
  active?: boolean;
  /** Work is in flight (e.g. waiting for a location fix). Shows a spinner in
   *  place of the icon and exposes `accessibilityState.busy`, so a screen
   *  reader hears that the press was received. */
  busy?: boolean;
  /** Presses do nothing and the a11y state says so. */
  disabled?: boolean;
}

/** A single floating, sunlit-glass map control (recenter, layers, filter…).
 *  44×44 target, labelled, with an exposed selected state for toggles. */
export function FloatingMapControl({
  icon,
  accessibilityLabel,
  onPress,
  active = false,
  busy = false,
  disabled = false,
}: FloatingMapControlProps) {
  const tint = active ? colors.surface : colors.text;
  return (
    <ScalePress
      to={0.88}
      onPress={busy || disabled ? () => {} : onPress}
      style={[styles.button, active && styles.active, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, busy, disabled }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <Ionicons name={icon} size={20} color={tint} />
      )}
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.float,
  },
  active: { backgroundColor: palette.baseBlue },
  disabled: { opacity: 0.5 },
});
