import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../../constants/design.js';

export type ChipStatus = 'idle' | 'pending' | 'confirmed' | 'failed';

interface Props {
  status: ChipStatus;
}

export function OptimisticChip({ status }: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);
  const dotOpacity = useSharedValue(1);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (status === 'pending') {
      opacity.value = withTiming(1, { duration: 180 });
      translateY.value = withTiming(0, { duration: 180 });
      // Pulsing dot
      dotOpacity.value = withRepeat(
        withSequence(
          withTiming(0.2, { duration: 500 }),
          withTiming(1, { duration: 500 }),
        ),
        -1,
        false,
      );
    } else if (status === 'confirmed') {
      dotOpacity.value = withTiming(1, { duration: 150 });
      opacity.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) });
      translateY.value = withTiming(-6, { duration: 350 });
    } else if (status === 'failed') {
      dotOpacity.value = 1;
      // Shake
      shakeX.value = withSequence(
        withSpring(-8, { damping: 4, stiffness: 300 }),
        withSpring(8, { damping: 4, stiffness: 300 }),
        withSpring(-6, { damping: 5, stiffness: 300 }),
        withSpring(6, { damping: 5, stiffness: 300 }),
        withSpring(0, { damping: 8, stiffness: 300 }),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      opacity.value = withTiming(0, { duration: 1200, easing: Easing.in(Easing.cubic) });
    } else {
      opacity.value = 0;
      translateY.value = 8;
    }
  }, [status, opacity, translateY, dotOpacity, shakeX]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { translateX: shakeX.value }],
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  const label =
    status === 'failed'
      ? 'tx failed — reverted'
      : status === 'confirmed'
        ? 'confirmed'
        : 'confirming on Base...';

  const dotColor = status === 'failed' ? COLORS.danger : COLORS.signal;

  if (status === 'idle') return null;

  return (
    <Animated.View style={[styles.chip, containerStyle]}>
      <Animated.View style={[styles.dot, { backgroundColor: dotColor }, dotStyle]} />
      <Animated.Text style={styles.label}>{label}</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(20,20,30,0.92)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    gap: 7,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    color: COLORS.textMuted,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
