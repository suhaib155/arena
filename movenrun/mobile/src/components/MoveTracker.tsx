import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useStore } from '../store/index.js';
import { AnimatedNumber } from './AnimatedNumber';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';

export function MoveTracker() {
  const isTracking = useStore((s) => s.isTracking);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);
  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt] = useState(Date.now());

  const mountOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isTracking) return;
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [isTracking, startedAt]);

  useEffect(() => {
    mountOpacity.value = withTiming(isTracking ? 1 : 0, { duration: 300 });
  }, [isTracking, mountOpacity]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: mountOpacity.value,
  }));

  if (!isTracking) return null;

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  const distanceKm = currentDistanceMeters / 1000;
  const earnedMove = Number(earnedThisRun) / 1e18;

  return (
    <Animated.View style={containerStyle}>
      <BlurView intensity={24} tint="dark" style={styles.container}>
        <View style={styles.stat}>
          <Animated.Text style={styles.value}>
            {minutes}:{seconds}
          </Animated.Text>
          <Animated.Text style={styles.label}>time</Animated.Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <AnimatedNumber value={distanceKm} decimals={2} compact={false} style={styles.value} />
          <Animated.Text style={styles.label}>km</Animated.Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <AnimatedNumber
            value={earnedMove}
            decimals={3}
            compact
            showMoveGlyph
            style={[styles.value, styles.earn]}
          />
          <Animated.Text style={styles.label}>$MOVE</Animated.Text>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: radius.md,
    paddingVertical: space[3],
    paddingHorizontal: space[5],
    justifyContent: 'space-around',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  stat: { alignItems: 'center' },
  value: {
    color: colors.snow,
    fontFamily: fonts.mono,
    fontSize: textSize.xl,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  earn: { color: colors.signal },
  label: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.xs,
    textTransform: 'uppercase',
    marginTop: 2,
    letterSpacing: 0.8,
  },
  divider: {
    width: 1,
    height: 30,
    backgroundColor: colors.line,
  },
});
