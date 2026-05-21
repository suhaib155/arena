import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS } from '../../constants/design.js';

interface Props {
  loading: boolean;
}

/**
 * A thin 2px --signal line that sweeps across the top of the screen
 * while loading is true. On completion sweeps to full width then fades.
 */
export function TopProgressBar({ loading }: Props) {
  const widthPct = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (loading) {
      opacity.value = withTiming(1, { duration: 100 });
      widthPct.value = withTiming(0.85, {
        duration: 2400,
        easing: Easing.out(Easing.exp),
      });
    } else {
      // Complete sweep then fade out
      widthPct.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      opacity.value = withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(0, { duration: 350 }),
      );
    }
  }, [loading, widthPct, opacity]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${widthPct.value * 100}%`,
    opacity: opacity.value,
  }));

  return (
    <View style={styles.track} pointerEvents="none">
      <Animated.View style={[styles.bar, barStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    overflow: 'hidden',
    zIndex: 999,
  },
  bar: {
    height: 2,
    backgroundColor: COLORS.signal,
    borderRadius: 1,
  },
});
