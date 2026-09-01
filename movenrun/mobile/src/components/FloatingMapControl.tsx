import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, palette, shadows } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";

interface FloatingMapControlProps {
  icon: IoniconName;
  /** Required — the control is icon-only, so it must describe itself. */
  accessibilityLabel: string;
  onPress: () => void;
  /** Toggle/filter controls expose their selected state through
   *  `accessibilityState.selected`, so the toggle is not colour-only. */
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
      selected={active}
    >
      <Ionicons name={icon} size={20} color={active ? colors.surface : colors.text} />
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  button: { ...iconTile(44), backgroundColor: colors.surface, ...shadows.float },
  active: { backgroundColor: palette.baseBlue },
});
