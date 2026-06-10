import { ActivityIndicator, StyleSheet, Text, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, radius, shadows, spacing } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IoniconName;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const textColor =
    variant === "primary" ? colors.surface : variant === "ghost" ? colors.textDim : colors.text;

  const variantStyle = variantStyles[variant];

  return (
    <ScalePress
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.base, variantStyle, isDisabled ? styles.disabled : {}, style ?? {}]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
        </>
      )}
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
  },
  label: {
    fontSize: 16,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.45,
  },
});

const variantStyles: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary, ...glow(colors.primary) },
  secondary: { backgroundColor: colors.surface, ...shadows.card },
  ghost: { backgroundColor: "transparent" },
};
