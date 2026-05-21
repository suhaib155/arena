import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useChain } from '../hooks/useChain.js';
import { useToken } from '../hooks/useToken.js';
import { useStore } from '../store/index.js';
import { TokenBalance } from '../components/TokenBalance.js';
import { PressableScale } from '../components/PressableScale.js';
import { AnimatedNumber } from '../components/AnimatedNumber.js';
import { EmptyState } from '../components/EmptyState.js';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';

export default function ProfileScreen() {
  const { authenticated, walletAddress, login, logout } = useChain();
  const { dailyCapRemaining } = useToken();
  const ownedZoneIds = useStore((s) => s.ownedZoneIds);
  const capRemaining = dailyCapRemaining ? parseFloat(dailyCapRemaining) : 0;

  if (!authenticated) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Connect Wallet</Text>
        <Text style={styles.sub}>Sign in to start earning $MOVE.</Text>
        <PressableScale onPress={login} style={styles.btn}>
          <Text style={styles.btnText}>Sign In with Privy</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Profile</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Wallet</Text>
        <Text style={styles.mono}>{walletAddress}</Text>
      </View>

      <TokenBalance />

      <View style={styles.card}>
        <Text style={styles.label}>Daily Cap Remaining</Text>
        <AnimatedNumber
          value={capRemaining}
          decimals={0}
          compact
          showMoveGlyph
          style={styles.value}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Owned Zones ({ownedZoneIds.length})</Text>
        {ownedZoneIds.length === 0 ? (
          <Text style={styles.dim}>No zones yet. Become the top mover in a hex!</Text>
        ) : (
          ownedZoneIds.map((id) => (
            <Text key={id} style={styles.mono}>{id}</Text>
          ))
        )}
      </View>

      <PressableScale onPress={logout} style={styles.logoutBtn}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </PressableScale>
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.abyss,
    gap: space[5],
    padding: space[8],
  },
  heading: {
    color: colors.snow,
    fontFamily: fonts.display,
    fontSize: textSize['2xl'],
    fontWeight: '700',
  },
  sub: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.base,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.depth,
    borderRadius: radius.sm,
    padding: space[4],
    gap: space[2],
    borderWidth: 1,
    borderColor: colors.line,
  },
  label: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    color: colors.snow,
    fontFamily: fonts.mono,
    fontSize: textSize.lg,
    fontWeight: '700',
  },
  mono: {
    color: colors.frost,
    fontFamily: fonts.mono,
    fontSize: textSize.sm,
  },
  dim: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.base,
  },
  btn: {
    backgroundColor: colors.signal,
    paddingHorizontal: space[8],
    paddingVertical: space[4],
    borderRadius: radius.full,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: colors.void,
    fontFamily: fonts.sans,
    fontWeight: '700',
    fontSize: textSize.md,
  },
  logoutBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: space[4],
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  logoutText: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.base,
  },
});
