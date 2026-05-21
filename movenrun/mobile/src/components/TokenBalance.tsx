import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useStore } from '../store/index.js';
import { AnimatedNumber } from './AnimatedNumber';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';

export function TokenBalance() {
  const moveBalance = useStore((s) => s.moveBalance);
  const glowOpacity = useSharedValue(0);
  const prevBalance = useRef<bigint>(0n);

  const valueAsNumber = Number(moveBalance) / 1e18;

  useEffect(() => {
    if (moveBalance !== prevBalance.current) {
      glowOpacity.value = withTiming(0.5, { duration: 150 }, () => {
        glowOpacity.value = withTiming(0, { duration: 500 });
      });
      prevBalance.current = moveBalance;
    }
  }, [moveBalance, glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, glowStyle]} />
      <Animated.Text style={styles.label}>$MOVE</Animated.Text>
      <AnimatedNumber
        value={valueAsNumber}
        decimals={2}
        compact
        showMoveGlyph
        style={styles.balance}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingHorizontal: space[5],
    borderWidth: 1,
    borderColor: `${colors.signal}33`,
    overflow: 'hidden',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.signal,
    borderRadius: radius.lg,
  },
  label: {
    color: colors.signal,
    fontFamily: fonts.mono,
    fontSize: textSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  balance: {
    color: colors.snow,
    fontFamily: fonts.mono,
    fontSize: textSize.xl,
    fontWeight: '700',
  },
});
