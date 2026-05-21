import React, { useEffect, useRef } from 'react';
import { Text, TextStyle, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { fonts, colors } from '../theme/tokens';
import { springBouncy, timingStandard } from '../theme/animations';

interface Props {
  value: number;
  style?: TextStyle;
  /** Show $MOVE gold glyph prefix */
  showMoveGlyph?: boolean;
  /** Show $ZONE violet glyph prefix */
  showZoneGlyph?: boolean;
  /** Decimal places. Default 2. */
  decimals?: number;
  /** Format large numbers (K/M). Default true. */
  compact?: boolean;
}

function formatValue(n: number, decimals: number, compact: boolean): string {
  if (compact) {
    if (Math.abs(n) >= 1_000_000) {
      return (n / 1_000_000).toFixed(1) + 'M';
    }
    if (Math.abs(n) >= 10_000) {
      return (n / 1_000).toFixed(1) + 'K';
    }
    if (Math.abs(n) >= 1_000) {
      return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
  }
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Animated Text using Reanimated animatedProps trick
const AnimatedText = Animated.createAnimatedComponent(Text);

export function AnimatedNumber({
  value,
  style,
  showMoveGlyph = false,
  showZoneGlyph = false,
  decimals = 2,
  compact = true,
}: Props) {
  const animatedValue = useSharedValue(value);
  // We use a ref to drive a JS-side display update via a counter
  const [displayValue, setDisplayValue] = React.useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(value);
  const toRef = useRef(value);
  const durationRef = useRef(400);

  useEffect(() => {
    if (value === displayValue) return;

    fromRef.current = displayValue;
    toRef.current = value;
    startRef.current = null;
    durationRef.current = 400;

    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / durationRef.current, 1);
      // Ease-out-cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplayValue(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(toRef.current);
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  const formatted = formatValue(displayValue, decimals, compact);

  return (
    <View style={styles.row}>
      {showMoveGlyph && (
        <Text style={[styles.glyph, styles.moveGlyph]}>⬡ </Text>
      )}
      {showZoneGlyph && (
        <Text style={[styles.glyph, styles.zoneGlyph]}>◆ </Text>
      )}
      <Text style={[styles.number, style]}>{formatted}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  number: {
    fontFamily: fonts.mono,
    color: colors.snow,
    fontVariant: ['tabular-nums'],
  },
  glyph: {
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  moveGlyph: {
    color: colors.gold,
  },
  zoneGlyph: {
    color: colors.atmosphere,
  },
});
