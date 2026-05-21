import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useStore } from '../store/index.js';
import { BattleCard } from '../components/BattleCard.js';
import { EmptyState } from '../components/EmptyState.js';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function BattleScreen() {
  const activeBattles = useStore((s) => s.activeBattles);
  const setActiveBattles = useStore((s) => s.setActiveBattles);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBattles = async () => {
    setRefreshing(false);
  };

  useEffect(() => {
    fetchBattles();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Active Battles</Text>
      {activeBattles.length === 0 ? (
        <EmptyState variant="noBattles" />
      ) : (
        <FlatList
          data={activeBattles}
          keyExtractor={(item) => item.hexId}
          renderItem={({ item }) => <BattleCard challenge={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={fetchBattles}
              tintColor={colors.signal}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.abyss,
    paddingTop: space[5],
    paddingHorizontal: space[5],
  },
  heading: {
    color: colors.snow,
    fontFamily: fonts.display,
    fontSize: textSize['2xl'],
    fontWeight: '700',
    marginBottom: space[4],
  },
  list: { gap: space[3] },
});
