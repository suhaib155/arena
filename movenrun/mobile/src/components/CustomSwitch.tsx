import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/tokens';
import { springSnappy, timingReduceMotion } from '../theme/animations';

const TRACK_W = 52;
const TRACK_H = 30;
const THUMB_SIZE = 22;
const THUMB_TRAVEL = TRACK_W - THUMB_SIZE - 8;

interface Props {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}

export function CustomSwitch({ value, onValueChange, disabled }: Props) {
  const progress = useSharedValue(value ? 1 : 0);
  const glowOpacity = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion: boolean) => {
      if (reduceMotion) {
        progress.value = withTiming(value ? 1 : 0, timingReduceMotion);
      } else {
        progress.value = withSpring(value ? 1 : 0, springSnappy);
      }
    });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.surface, `${colors.signal}33`],
    ),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.line, colors.signal],
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * THUMB_TRAVEL + 4 }],
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.mist, colors.signal],
    ),
    shadowColor: colors.signal,
    shadowOpacity: progress.value * 0.7,
    shadowRadius: progress.value * 8,
    shadowOffset: { width: 0, height: 0 },
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const toggle = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    glowOpacity.value = withTiming(1, { duration: 80 }, () => {
      glowOpacity.value = withTiming(0, { duration: 300 });
    });
    onValueChange(!value);
  }, [disabled, value, onValueChange, glowOpacity]);

  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        {/* Glow trail behind thumb */}
        <Animated.View style={[styles.glowTrail, glowStyle]} />
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: 1.5,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glowTrail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.signal,
    opacity: 0,
    borderRadius: TRACK_H / 2,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    elevation: 3,
  },
});
