import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton.js';
import { COLORS } from '../../constants/design.js';

/** Matches ProfileScreen layout: avatar circle + stats + zone grid */
export function ProfileSkeleton() {
  return (
    <View style={styles.container}>
      {/* Heading */}
      <Skeleton width={100} height={30} borderRadius={6} />

      {/* Wallet card */}
      <View style={styles.card}>
        <Skeleton width={60} height={11} borderRadius={3} />
        <Skeleton width="90%" height={14} borderRadius={4} />
      </View>

      {/* Token balance card */}
      <View style={styles.card}>
        <Skeleton width={50} height={11} borderRadius={3} />
        <Skeleton width={160} height={24} borderRadius={4} />
      </View>

      {/* Daily cap card */}
      <View style={styles.card}>
        <Skeleton width={130} height={11} borderRadius={3} />
        <Skeleton width={120} height={22} borderRadius={4} />
      </View>

      {/* Owned zones card */}
      <View style={styles.card}>
        <Skeleton width={110} height={11} borderRadius={3} />
        <View style={styles.zoneGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="48%" height={14} borderRadius={4} />
          ))}
        </View>
      </View>

      {/* Sign out button */}
      <Skeleton width="100%" height={50} borderRadius={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, flex: 1, backgroundColor: COLORS.bg },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  zoneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
});
