import React, { useEffect } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';
import { timingEnter } from '../theme/animations';
import { PressableScale } from './PressableScale';

type EmptyVariant = 'noZones' | 'noBattles' | 'noHistory';

interface Props {
  variant: EmptyVariant;
  onAction?: () => void;
}

const CONTENT: Record<
  EmptyVariant,
  { headline: string; sub: string; action?: string; motif: React.ReactNode }
> = {
  noZones: {
    headline: 'Your territory awaits.',
    sub: 'Start moving to claim your first zone.',
    action: 'Start Moving',
    motif: null, // rendered below with animation
  },
  noBattles: {
    headline: 'All quiet on your front.',
    sub: 'Your zones are secure.',
    motif: null,
  },
  noHistory: {
    headline: 'Your journey starts here.',
    sub: '',
    motif: null,
  },
};

function HexMotif() {
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((rm: boolean) => {
      if (rm) { pulse.value = 0.5; return; }
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1400 }),
          withTiming(0.5, { duration: 1400 }),
        ),
        -1,
        true,
      );
    });
  }, [pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.6,
    transform: [{ scale: 0.9 + pulse.value * 0.2 }],
  }));

  return (
    <View style={motifStyles.hexWrapper}>
      {/* Outer glow */}
      <Animated.View style={[motifStyles.hexGlow, glowStyle]} />
      {/* Hex outline using a large bordered View rotated */}
      <View style={motifStyles.hex}>
        <Text style={motifStyles.hexText}>⬡</Text>
      </View>
    </View>
  );
}

function ShieldMotif() {
  return (
    <View style={motifStyles.shieldWrapper}>
      <Text style={motifStyles.shieldText}>🛡</Text>
    </View>
  );
}

function PathMotif() {
  // Dotted path: a row of dots
  return (
    <View style={motifStyles.pathWrapper}>
      {Array.from({ length: 7 }).map((_, i) => (
        <View
          key={i}
          style={[
            motifStyles.dot,
            {
              opacity: 0.2 + (i / 6) * 0.8,
              transform: [{ scale: 0.6 + (i / 6) * 0.6 }],
            },
          ]}
        />
      ))}
    </View>
  );
}

export function EmptyState({ variant, onAction }: Props) {
  const content = CONTENT[variant];

  const fadeIn = useSharedValue(0);
  useEffect(() => {
    fadeIn.value = withTiming(1, timingEnter);
  }, [fadeIn]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeIn.value }));

  const Motif =
    variant === 'noZones' ? HexMotif :
    variant === 'noBattles' ? ShieldMotif :
    PathMotif;

  return (
    <Animated.View style={[styles.container, fadeStyle]}>
      <Motif />
      <Text style={styles.headline}>{content.headline}</Text>
      {content.sub ? <Text style={styles.sub}>{content.sub}</Text> : null}
      {content.action && onAction ? (
        <PressableScale onPress={onAction} style={styles.action}>
          <Text style={styles.actionText}>{content.action}</Text>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[8],
    gap: space[4],
  },
  headline: {
    fontFamily: fonts.display,
    fontSize: textSize.xl,
    color: colors.snow,
    textAlign: 'center',
    marginTop: space[4],
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: textSize.base,
    color: colors.mist,
    textAlign: 'center',
    lineHeight: 22,
  },
  action: {
    marginTop: space[4],
    backgroundColor: colors.signal,
    paddingHorizontal: space[8],
    paddingVertical: space[4],
    borderRadius: radius.full,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: fonts.sans,
    fontSize: textSize.md,
    fontWeight: '700',
    color: colors.void,
  },
});

const motifStyles = StyleSheet.create({
  hexWrapper: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexGlow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.signal,
  },
  hex: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexText: {
    fontSize: 80,
    color: `${colors.signal}40`,
    lineHeight: 90,
  },
  shieldWrapper: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  shieldText: {
    fontSize: 64,
  },
  pathWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: space[4],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.signal,
  },
});
