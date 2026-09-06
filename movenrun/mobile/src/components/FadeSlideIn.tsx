import { ReactNode, useEffect, useRef } from "react";
import { Animated, type ViewStyle } from "react-native";
import { motion } from "@/theme";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface FadeSlideInProps {
  children: ReactNode;
  /** Stagger start, in ms. */
  delay?: number;
  /** Initial vertical offset. */
  dy?: number;
  style?: ViewStyle | ViewStyle[];
}

/** Soft fade + rise entrance for cards and list items (native driver only). */
export function FadeSlideIn({ children, delay = 0, dy = 14, style }: FadeSlideInProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(1);
      return;
    }
    const animation = Animated.spring(progress, {
      toValue: 1,
      delay,
      friction: 9,
      tension: 50,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, reducedMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [dy, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Shared stagger step so lists animate with one rhythm. */
export const STAGGER_MS = Math.round(motion.base / 4);
