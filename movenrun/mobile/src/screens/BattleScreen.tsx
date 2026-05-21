import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useStore } from "../store/index.js";
import { BattleCard } from "../components/BattleCard.js";
import { ZoneChallenge } from "@movenrun/shared";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type Tab = "my" | "nearby";

export default function BattleScreen() {
  const activeBattles = useStore((s) => s.activeBattles);
  const nearbyBattles = useStore((s) => s.nearbyBattles);
  const setActiveBattles = useStore((s) => s.setActiveBattles);
  const setNearbyBattles = useStore((s) => s.setNearbyBattles);
  const walletAddress = useStore((s) => s.walletAddress);

  const [tab, setTab] = useState<Tab>("my");
  const [refreshing, setRefreshing] = useState(false);

  const fetchBattles = async () => {
    setRefreshing(true);
    try {
      const [myRes, nearbyRes] = await Promise.allSettled([
        fetch(`${API_BASE}/battles?participant=${walletAddress}`),
        fetch(`${API_BASE}/battles/nearby`),
      ]);
      if (myRes.status === "fulfilled" && myRes.value.ok) {
        const data: ZoneChallenge[] = await myRes.value.json();
        setActiveBattles(data);
      }
      if (nearbyRes.status === "fulfilled" && nearbyRes.value.ok) {
        const data: ZoneChallenge[] = await nearbyRes.value.json();
        setNearbyBattles(data);
      }
    } catch (e) {
      console.error("fetchBattles error:", e);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBattles();
  }, [walletAddress]);

  const handleReconquest = (hexId: string) => {
    // Navigate to ZoneScreen / challenge flow
    useStore.getState().selectHex(hexId);
  };

  const displayed = tab === "my" ? activeBattles : nearbyBattles;

  const empty =
    tab === "my"
      ? "No battles you're involved in.\nChallenge a zone from the map."
      : "No battles nearby.\nExplore the map to find active conflicts.";

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Battles</Text>

      {/* Tab bar */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "my" && styles.tabActive]}
          onPress={() => setTab("my")}
        >
          <Text style={[styles.tabText, tab === "my" && styles.tabTextActive]}>
            My Battles
            {activeBattles.length > 0 && (
              <Text style={styles.badge}> {activeBattles.length}</Text>
            )}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "nearby" && styles.tabActive]}
          onPress={() => setTab("nearby")}
        >
          <Text style={[styles.tabText, tab === "nearby" && styles.tabTextActive]}>
            Nearby Battles
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayed}
        keyExtractor={(item) => `${item.hexId}-${item.challengeStart}`}
        renderItem={({ item }) => (
          <BattleCard
            challenge={item}
            walletAddress={walletAddress}
            onReconquest={handleReconquest}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={fetchBattles}
            tintColor="#00ff88"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>{empty}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d", paddingTop: 20 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "700", paddingHorizontal: 20, marginBottom: 16 },
  tabs: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  tabActive: { backgroundColor: "#2a2a2a" },
  tabText: { color: "#666", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  badge: { color: "#ff6400" },
  list: { paddingHorizontal: 20, gap: 12, paddingBottom: 32 },
  emptyWrap: { paddingTop: 60, alignItems: "center" },
  empty: { color: "#555", fontSize: 15, textAlign: "center", lineHeight: 24 },
});
