import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useStore } from '../store/index.js';
import { BattleCard } from '../components/BattleCard.js';
import { SkeletonClockProvider, LeaderboardSkeleton } from '../components/skeleton/index.js';
import { PullToRefreshHex } from '../components/ui/PullToRefreshHex.js';
import { TopProgressBar } from '../components/ui/TopProgressBar.js';
import { COLORS, CROSSFADE_MS } from '../constants/design.js';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function BattleScreen() {
  const activeBattles = useStore((s) => s.activeBattles);
  const setActiveBattles = useStore((s) => s.setActiveBattles);
  const [loading, setLoading] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [contentReady, setContentReady] = useState(false);

  const fetchBattles = async () => {
    setLoading(true);
    try {
      // TODO: implement GET /battles endpoint
      await new Promise<void>((r) => setTimeout(r, 0));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBattles();
  }, []);

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

      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: skeletonOpacity }]}
        pointerEvents={contentReady ? 'none' : 'auto'}
      >
        <SkeletonClockProvider>
          <LeaderboardSkeleton rows={4} />
        </SkeletonClockProvider>
      </Animated.View>

      <Animated.View style={[styles.flex, { opacity: fadeAnim }]}>
        <PullToRefreshHex onRefresh={fetchBattles} style={styles.scroll}>
          <View style={styles.content}>
            <Text style={styles.heading}>Active Battles</Text>
            {activeBattles.length === 0 ? (
              <Text style={styles.empty}>
                No active battles. Declare a challenge from the Zone screen.
              </Text>
            ) : (
              activeBattles.map((item) => (
                <BattleCard key={item.hexId} challenge={item} />
              ))
            )}
          </View>
        </PullToRefreshHex>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, gap: 12 },
  heading: { color: COLORS.text, fontSize: 28, fontWeight: '700', marginBottom: 4 },
  empty: { color: COLORS.textDim, fontSize: 15, textAlign: 'center', marginTop: 40 },
});
