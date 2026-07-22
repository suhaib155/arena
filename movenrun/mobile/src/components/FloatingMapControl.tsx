import { StyleSheet, View } from "react-native";
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
}

/** A single floating, sunlit-glass map control (recenter, layers, filter…).
 *  44×44 target, labelled, with an exposed selected state for toggles. */
export function FloatingMapControl({ icon, accessibilityLabel, onPress, active = false }: FloatingMapControlProps) {
  return (
    <ScalePress
      to={0.88}
      onPress={onPress}
      style={[styles.button, active && styles.active]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={20} color={active ? colors.surface : colors.text} />
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
});
