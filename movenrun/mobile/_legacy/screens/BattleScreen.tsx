import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl } from "react-native";
import { useStore } from "../store/index.js";
import { BattleCard } from "../components/BattleCard.js";
import { ZoneChallenge } from "@movenrun/shared";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export default function BattleScreen() {
  const activeBattles = useStore((s) => s.activeBattles);
  const setActiveBattles = useStore((s) => s.setActiveBattles);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBattles = async () => {
    // TODO: implement GET /battles endpoint with full list
    setRefreshing(false);
  };

  useEffect(() => { fetchBattles(); }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Active Battles</Text>
      {activeBattles.length === 0 ? (
        <Text style={styles.empty}>No active battles. Declare a challenge from the Zone screen.</Text>
      ) : (
        <FlatList
          data={activeBattles}
          keyExtractor={(item) => item.hexId}
          renderItem={({ item }) => <BattleCard challenge={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchBattles} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d", padding: 20 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 16 },
  empty: { color: "#666", fontSize: 15, textAlign: "center", marginTop: 40 },
  list: { gap: 12 },
});
