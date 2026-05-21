import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useChain } from '../hooks/useChain.js';
import { useToken } from '../hooks/useToken.js';
import { useStore } from '../store/index.js';
import { TokenBalance } from '../components/TokenBalance.js';
import { SkeletonClockProvider, ProfileSkeleton } from '../components/skeleton/index.js';
import { TopProgressBar } from '../components/ui/TopProgressBar.js';
import { COLORS, CROSSFADE_MS } from '../constants/design.js';

export default function ProfileScreen() {
  const { authenticated, walletAddress, login, logout } = useChain();
  const { moveBalance, dailyCapRemaining, loading } = useToken();
  const ownedZoneIds = useStore((s) => s.ownedZoneIds);

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

  if (!authenticated) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Connect Wallet</Text>
        <TouchableOpacity style={styles.btn} onPress={login}>
          <Text style={styles.btnText}>Sign In with Privy</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const skeletonOpacity = fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.root}>
      <TopProgressBar loading={loading} />

      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: skeletonOpacity }]}
        pointerEvents={contentReady ? 'none' : 'auto'}
      >
        <SkeletonClockProvider>
          <ProfileSkeleton />
        </SkeletonClockProvider>
      </Animated.View>

      <Animated.ScrollView
        style={[styles.container, { opacity: fadeAnim }]}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.heading}>Profile</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Wallet</Text>
          <Text style={styles.mono}>{walletAddress}</Text>
        </View>

        <TokenBalance />

        <View style={styles.card}>
          <Text style={styles.label}>Daily Cap Remaining</Text>
          <Text style={styles.value}>{dailyCapRemaining ?? '—'} $MOVE</Text>
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

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    gap: 20,
  },
  heading: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, gap: 8 },
  label: { color: COLORS.textMuted, fontSize: 12, textTransform: 'uppercase' },
  value: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  mono: { color: '#aaaaaa', fontFamily: 'monospace', fontSize: 12 },
  dim: { color: COLORS.textDim, fontSize: 14 },
  btn: {
    backgroundColor: COLORS.signal,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 32,
  },
  btnText: { color: COLORS.bg, fontWeight: '700', fontSize: 16 },
  logoutBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  logoutText: { color: COLORS.textMuted, fontSize: 15 },
});
