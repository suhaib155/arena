import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useStore } from '../store/index.js';
import { useZone } from '../hooks/useZone.js';
import { useChain } from '../hooks/useChain.js';
import { PressableScale } from '../components/PressableScale.js';
import { AnimatedNumber } from '../components/AnimatedNumber.js';
import { EmptyState } from '../components/EmptyState.js';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';

export default function ZoneScreen() {
  const selectedHexId = useStore((s) => s.selectedHexId);
  const { zone, eligibility, loading, requestMintSig } = useZone(selectedHexId);
  const { walletAddress, getSigner } = useChain();

  const handleMint = async () => {
    if (!walletAddress || !selectedHexId || !eligibility) return;
    try {
      const { mintCost, oracleSig } = await requestMintSig(walletAddress);
      const signer = await getSigner();
      // TODO: call ZoneNFT.mintZone via ethers contract
      console.log('Minting zone with cost:', mintCost, 'sig:', oracleSig);
    } catch (e: any) {
      console.error('Mint error:', e.message);
    }
  };

  if (!selectedHexId) {
    return (
      <View style={styles.emptyWrapper}>
        <EmptyState variant="noZones" />
      </View>
    );
  }

  const mintCostMove = eligibility ? Number(eligibility.mintCost) / 1e18 : 0;
  const canMint =
    eligibility?.isEligible &&
    eligibility.topMover.toLowerCase() === walletAddress?.toLowerCase();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.hexId}>{selectedHexId}</Text>

      {loading && (
        <ActivityIndicator color={colors.signal} style={styles.loader} />
      )}

      {zone ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Owner</Text>
            <Text style={styles.mono}>{zone.owner.slice(0, 12)}…</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, zone.status === 'Active' && styles.activeStatus]}>
              {zone.status}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Weekly Movers</Text>
            <AnimatedNumber
              value={zone.weeklyMoverCount}
              decimals={0}
              compact={false}
              style={styles.value}
            />
          </View>
        </View>
      ) : (
        !loading && (
          <View style={styles.card}>
            <Text style={styles.label}>Zone not yet minted</Text>
            <Text style={styles.dim}>Be the first to claim this hex.</Text>
          </View>
        )
      )}

      {canMint && (
        <PressableScale onPress={handleMint} style={styles.mintBtn}>
          <Text style={styles.mintBtnText}>MINT THIS ZONE</Text>
          <View style={styles.mintCostRow}>
            <AnimatedNumber
              value={mintCostMove}
              decimals={2}
              compact
              showMoveGlyph
              style={styles.mintCost}
            />
          </View>
        </PressableScale>
      )}
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
  emptyWrapper: {
    flex: 1,
    backgroundColor: colors.abyss,
  },
  hexId: {
    color: colors.signal,
    fontFamily: fonts.mono,
    fontSize: textSize.sm,
    letterSpacing: 0.5,
  },
  loader: {
    alignSelf: 'center',
    marginVertical: space[4],
  },
  card: {
    backgroundColor: colors.depth,
    borderRadius: radius.sm,
    padding: space[4],
    gap: space[3],
    borderWidth: 1,
    borderColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
  },
  label: {
    color: colors.mist,
    fontFamily: fonts.sans,
    fontSize: textSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    color: colors.snow,
    fontFamily: fonts.sans,
    fontSize: textSize.md,
    fontWeight: '600',
  },
  activeStatus: {
    color: colors.signal,
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
  mintBtn: {
    backgroundColor: colors.signal,
    borderRadius: radius.sm,
    padding: space[5],
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  mintBtnText: {
    color: colors.void,
    fontFamily: fonts.sans,
    fontWeight: '700',
    fontSize: textSize.md,
    letterSpacing: 1,
  },
  mintCostRow: {
    marginTop: space[1],
  },
  mintCost: {
    color: colors.void,
    fontFamily: fonts.mono,
    fontSize: textSize.sm,
    opacity: 0.7,
  },
});
