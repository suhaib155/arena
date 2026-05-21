import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { useStore } from '../store/index.js';
import { useZone } from '../hooks/useZone.js';
import { useChain } from '../hooks/useChain.js';
import { useOptimistic } from '../hooks/useOptimistic.js';
import { SkeletonClockProvider, ZoneSkeleton } from '../components/skeleton/index.js';
import { LoadingButton } from '../components/ui/LoadingButton.js';
import { OptimisticChip } from '../components/ui/OptimisticChip.js';
import { TopProgressBar } from '../components/ui/TopProgressBar.js';
import { COLORS, CROSSFADE_MS } from '../constants/design.js';

export default function ZoneScreen() {
  const selectedHexId = useStore((s) => s.selectedHexId);
  const { zone, eligibility, loading, requestMintSig } = useZone(selectedHexId);
  const { walletAddress, getSigner } = useChain();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [contentReady, setContentReady] = useState(false);

  // Crossfade skeleton → content when data arrives
  useEffect(() => {
    if (!loading) {
      setContentReady(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: CROSSFADE_MS,
        useNativeDriver: true,
      }).start();
    } else {
      fadeAnim.setValue(0);
      setContentReady(false);
    }
  }, [loading, selectedHexId, fadeAnim]);

  const doMint = async () => {
    if (!walletAddress || !selectedHexId || !eligibility) return;
    const { mintCost, oracleSig } = await requestMintSig(walletAddress);
    const signer = await getSigner();
    // TODO: call ZoneNFT.mintZone via ethers contract
    console.log('Minting zone, cost:', mintCost, 'sig:', oracleSig, 'signer:', signer);
  };

  const { execute: executeMint, status: mintStatus, error: mintError } = useOptimistic(doMint, {
    onError: (e) => console.error('Mint failed:', e.message),
  });

  const canMint =
    eligibility?.isEligible &&
    eligibility.topMover.toLowerCase() === walletAddress?.toLowerCase();

  if (!selectedHexId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Select a hex on the map to view zone details.</Text>
      </View>
    );
  }

  const skeletonOpacity = fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.root}>
      <TopProgressBar loading={loading} />

      {/* Skeleton overlays content, fades out when data arrives */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: skeletonOpacity }]}
        pointerEvents={contentReady ? 'none' : 'auto'}
      >
        <SkeletonClockProvider>
          <ZoneSkeleton />
        </SkeletonClockProvider>
      </Animated.View>

      {/* Real content fades in */}
      <Animated.View style={[styles.flex, { opacity: fadeAnim }]}>
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.hexId}>{selectedHexId}</Text>

          {zone ? (
            <View style={styles.card}>
              <Text style={styles.label}>Owner</Text>
              <Text style={styles.value}>{zone.owner}</Text>
              <Text style={styles.label}>Status</Text>
              <Text style={styles.value}>{zone.status}</Text>
              <Text style={styles.label}>Weekly Movers</Text>
              <Text style={styles.value}>{zone.weeklyMoverCount}</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.label}>Zone not yet minted</Text>
              <Text style={styles.dim}>Be the first top mover to claim it.</Text>
            </View>
          )}

          {mintError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{mintError.message}</Text>
            </View>
          )}

          {canMint && (
            <View style={styles.mintWrap}>
              <LoadingButton
                onPress={executeMint}
                status={mintStatus === 'pending' ? 'loading' : mintStatus === 'confirmed' ? 'success' : 'idle'}
              >
                MINT THIS ZONE
              </LoadingButton>
              {eligibility && (
                <Text style={styles.mintCost}>
                  Cost: {Number(eligibility.mintCost) / 1e18} $MOVE
                </Text>
              )}
              <OptimisticChip status={mintStatus} />
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  emptyText: { color: COLORS.textDim, fontSize: 16 },
  hexId: { color: COLORS.signal, fontFamily: 'monospace', fontSize: 13 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  label: { color: COLORS.textMuted, fontSize: 12, textTransform: 'uppercase' },
  value: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  dim: { color: COLORS.textDim, fontSize: 14 },
  mintWrap: { gap: 8, alignItems: 'stretch' },
  mintCost: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  errorBanner: {
    backgroundColor: 'rgba(255,68,68,0.12)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  errorText: { color: COLORS.danger, fontSize: 13 },
});
