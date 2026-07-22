import { ReactNode, useRef } from "react";
import {
  Animated,
  Pressable,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion } from "@/theme";

interface ScalePressProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Scale while pressed. */
  to?: number;
  style?: StyleProp<ViewStyle>;
  /** Accessibility — forwarded to the underlying Pressable so icon-only and
   *  composite controls can describe themselves to screen readers. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
}

/**
 * Pressable that springs to a slightly smaller scale while held — the soft,
 * tactile press used across Daylight Cartography (cards, buttons, chips).
 */
export function ScalePress({
  children,
  onPress,
  disabled,
  to = 0.97,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
}: ScalePressProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const springTo = (value: number) =>
    Animated.spring(scale, { toValue: value, ...motion.spring }).start();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
      onPressIn={() => !disabled && springTo(to)}
      onPressOut={() => springTo(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
