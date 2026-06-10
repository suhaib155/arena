import { ReactNode, useRef } from "react";
import { Animated, Pressable, type ViewStyle } from "react-native";
import { motion } from "@/theme";

interface ScalePressProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Scale while pressed. */
  to?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Pressable that springs to a slightly smaller scale while held — the soft,
 * tactile press used across Daylight Cartography (cards, buttons, chips).
 */
export function ScalePress({ children, onPress, disabled, to = 0.97, style }: ScalePressProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const springTo = (value: number) =>
    Animated.spring(scale, { toValue: value, ...motion.spring }).start();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && springTo(to)}
      onPressOut={() => springTo(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
