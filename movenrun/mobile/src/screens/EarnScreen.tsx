import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useStore } from '../store/index.js';
import { useGPS } from '../hooks/useGPS.js';
import { useToken } from '../hooks/useToken.js';
import { MoveTracker } from '../components/MoveTracker.js';
import { AnimatedNumber } from '../components/AnimatedNumber.js';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';

export default function EarnScreen() {
  const { isTracking } = useGPS();
  const { moveBalance, currentRate, dailyCapRemaining } = useToken();
  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);

  const distanceKm = currentDistanceMeters / 1000;
  const earnedMove = Number(earnedThisRun) / 1e18;
  const balanceMove = Number(moveBalance) / 1e18;
  const capRemaining = dailyCapRemaining ? parseFloat(dailyCapRemaining) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Earn $MOVE</Text>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <AnimatedNumber
            value={distanceKm}
            decimals={2}
            compact={false}
            style={styles.statValue}
          />
          <Text style={styles.statLabel}>km this run</Text>
        </View>
        <View style={styles.stat}>
          <AnimatedNumber
            value={earnedMove}
            decimals={2}
            compact
            showMoveGlyph
            style={styles.statValue}
          />
          <Text style={styles.statLabel}>$MOVE earned</Text>
        </View>
      </View>

      <MoveTracker />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rate Info</Text>
        <View style={styles.cardRow}>
          <Text style={styles.cardKey}>Current rate</Text>
          <Text style={styles.cardVal}>{currentRate ?? '—'}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.cardRow}>
          <Text style={styles.cardKey}>Daily cap left</Text>
          <AnimatedNumber
            value={capRemaining}
            decimals={0}
            compact
            showMoveGlyph
            style={styles.cardVal}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.cardRow}>
          <Text style={styles.cardKey}>Balance</Text>
          <AnimatedNumber
            value={balanceMove}
            decimals={2}
            compact
            showMoveGlyph
            style={styles.cardVal}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How to Earn More</Text>
        {[
          'Own a Zone NFT — skip the 2% tax',
          'Equip gear for multipliers (up to 3×)',
          'Move in high-activity zones',
        ].map((tip) => (
          <View key={tip} style={styles.tip}>
            <Text style={styles.tipBullet}>◆</Text>
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.abyss,
  },
  content: {
    paddingTop: space[5],
    paddingHorizontal: space[5],
    paddingBottom: space[16],
    gap: space[4],
  },
  heading: {
    color: colors.snow,
    fontFamily: fonts.display,
    fontSize: textSize['2xl'],
    fontWeight: '700',
  },
  statRow: { flexDirection: 'row', gap: space[3] },
  stat: {
    flex: 1,
    backgroundColor: colors.depth,
    borderRadius: radius.sm,
    padding: space[5],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  statValue: {
    color: colors.signal,
    fontFamily: fonts.mono,
    fontSize: textSize['3xl'],
    fontWeight: '700',
  },
  statLabel: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.sm,
    marginTop: space[1],
  },
  card: {
    backgroundColor: colors.depth,
    borderRadius: radius.sm,
    padding: space[4],
    gap: space[2],
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: {
    color: colors.snow,
    fontFamily: fonts.sans,
    fontWeight: '700',
    fontSize: textSize.md,
    marginBottom: space[1],
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardKey: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.base,
  },
  cardVal: {
    color: colors.frost,
    fontFamily: fonts.mono,
    fontSize: textSize.base,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
  },
  tip: {
    flexDirection: 'row',
    gap: space[2],
    alignItems: 'flex-start',
  },
  tipBullet: {
    color: colors.atmosphere,
    fontSize: textSize.xs,
    marginTop: 3,
  },
  tipText: {
    color: colors.frost,
    fontFamily: fonts.sans,
    fontSize: textSize.base,
    flex: 1,
    lineHeight: 22,
  },
});
