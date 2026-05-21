import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton.js';
import { COLORS } from '../../constants/design.js';

function BattleRowSkeleton() {
  return (
    <View style={styles.card}>
      {/* hex ID + timer */}
      <Skeleton width={140} height={12} borderRadius={3} />
      <Skeleton width={80} height={11} borderRadius={3} />

      {/* challenger vs defender */}
      <View style={styles.row}>
        <View style={styles.side}>
          <Skeleton width={60} height={10} borderRadius={3} />
          <Skeleton width={80} height={14} borderRadius={3} />
          <Skeleton width={40} height={26} borderRadius={4} />
        </View>
        <Skeleton width={24} height={16} borderRadius={4} />
        <View style={[styles.side, styles.right]}>
          <Skeleton width={60} height={10} borderRadius={3} />
          <Skeleton width={80} height={14} borderRadius={3} />
          <Skeleton width={40} height={26} borderRadius={4} />
        </View>
      </View>

      {/* progress bar */}
      <Skeleton width="100%" height={4} borderRadius={2} />
    </View>
  );
}

export function LeaderboardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.container}>
      <Skeleton width={160} height={30} borderRadius={6} style={{ marginBottom: 4 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <BattleRowSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, flex: 1, backgroundColor: COLORS.bg },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  side: { flex: 1, gap: 4 },
  right: { alignItems: 'flex-end' },
});
