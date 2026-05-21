import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton.js';
import { COLORS } from '../../constants/design.js';

/** Matches ZoneScreen's layout exactly: hex ID + card rows + mint button */
export function ZoneSkeleton() {
  return (
    <View style={styles.container}>
      {/* hex ID line */}
      <Skeleton width={160} height={14} borderRadius={4} />

      {/* Owner / Status / Weekly Movers card */}
      <View style={styles.card}>
        <Skeleton width={60} height={11} borderRadius={3} />
        <Skeleton width="80%" height={18} borderRadius={4} />
        <View style={styles.divider} />
        <Skeleton width={60} height={11} borderRadius={3} />
        <Skeleton width={100} height={18} borderRadius={4} />
        <View style={styles.divider} />
        <Skeleton width={100} height={11} borderRadius={3} />
        <Skeleton width={40} height={18} borderRadius={4} />
      </View>

      {/* Mint button placeholder */}
      <Skeleton width="100%" height={72} borderRadius={12} />
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
  divider: { height: 1, backgroundColor: COLORS.line, marginVertical: 4 },
});
