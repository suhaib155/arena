import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { ZoneChallenge } from '@movenrun/shared';
import { PressableScale } from './PressableScale';
import { AnimatedNumber } from './AnimatedNumber';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';
import { timingStandard } from '../theme/animations';

interface Props {
  challenge: ZoneChallenge;
  onPress?: () => void;
}

export function BattleCard({ challenge, onPress }: Props) {
  const now = Date.now() / 1000;
  const end = challenge.challengeEnd;
  const remaining = Math.max(0, end - now);
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);

  const challengerScore = Number(challenge.challengerScore) / 1e18;
  const defenderScore = Number(challenge.defenderScore) / 1e18;
  const total = challengerScore + defenderScore || 1;
  const challengerPct = (challengerScore / total) * 100;

  // Animated progress bar width
  const barWidth = useSharedValue(0);
  useEffect(() => {
    barWidth.value = withTiming(challengerPct, { duration: 800 });
  }, [challengerPct, barWidth]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
  }));

  // Contested pulse on the card border
  const borderOpacity = useSharedValue(0.3);
  useEffect(() => {
    borderOpacity.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 900 }),
        withTiming(0.3, { duration: 900 }),
      ),
      -1,
      true,
    );
  }, [borderOpacity]);

  const cardBorderStyle = useAnimatedStyle(() => ({
    borderColor: `rgba(255,100,0,${borderOpacity.value})`,
  }));

  return (
    <PressableScale onPress={onPress} pressedScale={0.98} withGlow>
      <Animated.View style={[styles.card, cardBorderStyle]}>
        <Text style={styles.hexId}>{challenge.hexId}</Text>
        <Text style={styles.timer}>{days}d {hours}h remaining</Text>

        <View style={styles.participants}>
          <View style={styles.side}>
            <Text style={styles.role}>CHALLENGER</Text>
            <Text style={styles.addr}>{challenge.challenger.slice(0, 8)}…</Text>
            <AnimatedNumber
              value={challengerScore}
              decimals={0}
              compact
              style={styles.score}
            />
          </View>
          <Text style={styles.vs}>VS</Text>
          <View style={[styles.side, styles.rightSide]}>
            <Text style={styles.role}>DEFENDER</Text>
            <Text style={styles.addr}>{challenge.defender.slice(0, 8)}…</Text>
            <AnimatedNumber
              value={defenderScore}
              decimals={0}
              compact
              style={styles.score}
            />
          </View>
        </View>

        <View style={styles.progressBg}>
          <Animated.View style={[styles.progressFill, barStyle]} />
        </View>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.depth,
    borderRadius: radius.sm,
    padding: space[4],
    gap: space[3],
    borderWidth: 1,
  },
  hexId: {
    color: colors.signal,
    fontFamily: fonts.mono,
    fontSize: textSize.sm,
  },
  timer: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.sm,
  },
  participants: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: { flex: 1 },
  rightSide: { alignItems: 'flex-end' },
  role: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  addr: {
    color: colors.frost,
    fontFamily: fonts.mono,
    fontSize: textSize.sm,
  },
  score: {
    color: colors.signal,
    fontFamily: fonts.mono,
    fontSize: textSize.xl,
    fontWeight: '700',
  },
  vs: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontWeight: '700',
    paddingHorizontal: space[2],
  },
  progressBg: {
    height: 4,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.contested,
    borderRadius: 2,
  },
});
