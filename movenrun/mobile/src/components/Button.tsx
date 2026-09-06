import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, ink, radius, shadows, spacing } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IoniconName;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** Override the spoken label when the visible text isn't self-explanatory. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * The shared button.
 *
 * Accessibility is owned here so every caller gets it for free: a `button`
 * role, a spoken label (the visible text unless overridden), and an accurate
 * disabled/busy state. While `loading`, the button announces itself as busy and
 * refuses presses — the spinner replaces the label visually, so without this a
 * screen reader would still offer a tappable, unlabelled control.
 *
 * The press animation lives in {@link ScalePress} and never gates the press
 * handler; real double-submit protection belongs to the action/state layer.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = Boolean(disabled);
  const isBusy = Boolean(loading);
  const textColor =
    variant === "primary" || variant === "danger" ? colors.surface : variant === "ghost" ? colors.textDim : colors.text;

  const variantStyle = variantStyles[variant];

  return (
    <ScalePress
      onPress={onPress}
      disabled={isDisabled}
      busy={isBusy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={[
        styles.base,
        variantStyle,
        isDisabled || isBusy ? styles.disabled : {},
        style ?? {},
      ]}
    >
      <View style={[styles.content, loading && { opacity: 0 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      </View>
      {loading ? <ActivityIndicator style={StyleSheet.absoluteFillObject} color={textColor} /> : null}
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    // Minimum practical touch target, preserved at large font sizes.
    minHeight: 48,
  },
  label: {
    flexShrink: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
  },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, maxWidth: "100%" },
  disabled: {
    opacity: 0.45,
  },
});

const variantStyles: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary, ...glow(colors.primary) },
  secondary: { backgroundColor: colors.surface, ...shadows.card },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: ink.coral },
};
