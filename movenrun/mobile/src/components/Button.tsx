import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, gradients, hairline, radius, shadows, spacing } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";
import { Gradient } from "./Gradient";

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

/**
 * The app's primary action. `primary` carries the signature aurora gradient and
 * a colour-matched glow so the main move on a screen is unmistakable; the other
 * variants stay quiet so only one action can ever read as primary.
 */
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
  const isPrimary = variant === "primary";
  const textColor = isPrimary ? colors.onInk : variant === "ghost" ? colors.textDim : colors.text;

  return (
    <ScalePress
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.base, variantStyles[variant], isDisabled ? styles.disabled : {}, style ?? {}]}
    >
      {isPrimary ? (
        <Gradient colors={gradients.aurora} direction="horizontal" radius={radius.pill} />
      ) : null}
      {/* Content sits above the decorative gradient bands. */}
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
            <Text style={[styles.label, { color: textColor }]}>{label}</Text>
          </>
        )}
      </View>
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    minHeight: 54,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  label: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  disabled: {
    opacity: 0.4,
  },
});

const variantStyles: Record<Variant, ViewStyle> = {
  // Solid base under the gradient so the button never renders empty.
  primary: { backgroundColor: colors.primary, ...glow(colors.primary) },
  secondary: { backgroundColor: colors.surface, ...hairline, ...shadows.soft },
  ghost: { backgroundColor: "transparent" },
};
