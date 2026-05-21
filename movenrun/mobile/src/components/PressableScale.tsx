import React, { useCallback } from 'react';
import { Pressable, StyleProp, ViewStyle, AccessibilityInfo } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { spring, timingReduceMotion } from '../theme/animations';

interface Props {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /** Override scale-down target. Default 0.96 (button). Use 0.98 for cards. */
  pressedScale?: number;
  /** Show signal edge glow on press (for cards/list items). */
  withGlow?: boolean;
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  pressedScale = 0.96,
  withGlow = false,
  testID,
}: Props) {
  const scale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const triggerMediumHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.4 : 1,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    inset: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `rgba(0,255,136,${glowOpacity.value})`,
    opacity: glowOpacity.value,
  }));

  const onPressIn = useCallback(() => {
    if (disabled) return;
    runOnJS(triggerHaptic)();
    // Check reduce motion — swap spring for fade if enabled
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion: boolean) => {
      if (reduceMotion) {
        scale.value = withTiming(pressedScale, timingReduceMotion);
      } else {
        scale.value = withSpring(pressedScale, spring);
      }
      if (withGlow) {
        glowOpacity.value = withTiming(0.4, { duration: 80 });
      }
    });
  }, [disabled, pressedScale, withGlow, scale, glowOpacity, triggerHaptic]);

  const onPressOut = useCallback(() => {
    if (disabled) return;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion: boolean) => {
      if (reduceMotion) {
        scale.value = withTiming(1, timingReduceMotion);
      } else {
        scale.value = withSpring(1, spring);
      }
      if (withGlow) {
        glowOpacity.value = withTiming(0, { duration: 200 });
      }
    });
  }, [disabled, withGlow, scale, glowOpacity]);

  const handleLongPress = useCallback(() => {
    if (disabled) return;
    runOnJS(triggerMediumHaptic)();
    onLongPress?.();
  }, [disabled, onLongPress, triggerMediumHaptic]);

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onLongPress={handleLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      style={[animatedStyle, style]}
      testID={testID}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      {withGlow && <Animated.View style={glowStyle} pointerEvents="none" />}
      {children}
    </AnimatedPressable>
  );
}
