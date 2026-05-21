import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useStore } from '../store/index.js';
import { useGPS } from '../hooks/useGPS.js';
import { useToken } from '../hooks/useToken.js';
import { MoveTracker } from '../components/MoveTracker.js';
import { SkeletonClockProvider, Skeleton } from '../components/skeleton/index.js';
import { TopProgressBar } from '../components/ui/TopProgressBar.js';
import { COLORS, CROSSFADE_MS } from '../constants/design.js';

export default function EarnScreen() {
  const { isTracking } = useGPS();
  const { moveBalance, currentRate, dailyCapRemaining, loading } = useToken();
  const earnedThisRun = useStore((s) => s.earnedThisRun);
  const currentDistanceMeters = useStore((s) => s.currentDistanceMeters);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [contentReady, setContentReady] = useState(false);

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
  }, [loading, fadeAnim]);

  const skeletonOpacity = fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.root}>
      <TopProgressBar loading={loading} />

      {/* Skeleton overlay for rate/cap data (stat row always shows from local store) */}
      <Animated.View
        style={[styles.skeletonOverlay, { opacity: skeletonOpacity }]}
        pointerEvents={contentReady ? 'none' : 'auto'}
      >
        <SkeletonClockProvider>
          <View style={styles.content}>
            <Skeleton width={120} height={30} borderRadius={6} />
            <View style={styles.statRow}>
              <Skeleton width="48%" height={88} borderRadius={12} />
              <Skeleton width="48%" height={88} borderRadius={12} />
            </View>
            <Skeleton width="100%" height={72} borderRadius={12} />
            <Skeleton width="100%" height={110} borderRadius={12} />
            <Skeleton width="100%" height={130} borderRadius={12} />
          </View>
        </SkeletonClockProvider>
      </Animated.View>

      <Animated.ScrollView
        style={[styles.container, { opacity: fadeAnim }]}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.heading}>Earn $MOVE</Text>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {(currentDistanceMeters / 1000).toFixed(2)}
            </Text>
            <Text style={styles.statLabel}>km this run</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {(Number(earnedThisRun) / 1e18).toFixed(2)}
            </Text>
            <Text style={styles.statLabel}>$MOVE earned</Text>
          </View>
        </View>

        <MoveTracker />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rate Info</Text>
          <Text style={styles.cardRow}>Current rate: {currentRate ?? '—'}</Text>
          <Text style={styles.cardRow}>
            Daily cap left: {dailyCapRemaining ?? '—'} $MOVE
          </Text>
          <Text style={styles.cardRow}>
            Balance: {(Number(moveBalance) / 1e18).toFixed(2)} $MOVE
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How to Earn More</Text>
          <Text style={styles.cardRow}>• Own a Zone NFT — skip the 2% tax</Text>
          <Text style={styles.cardRow}>• Equip gear for multipliers (up to 3x)</Text>
          <Text style={styles.cardRow}>• Move in high-activity zones</Text>
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1 },
  skeletonOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.bg,
  },
  content: { padding: 20, gap: 16 },
  heading: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: 12 },
  stat: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  statValue: { color: COLORS.signal, fontSize: 32, fontWeight: '700' },
  statLabel: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { color: COLORS.text, fontWeight: '700', fontSize: 16, marginBottom: 4 },
  cardRow: { color: '#aaa', fontSize: 14 },
});
