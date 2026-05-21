import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useStore } from "../store/index.js";
import { BattleCard } from "../components/BattleCard.js";
import { ZoneChallenge } from "@movenrun/shared";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

// NOTE: Replace FlatList with @shopify/flash-list when installed for virtualisation on large lists:
// import { FlashList } from "@shopify/flash-list";

export default function BattleScreen() {
  const activeBattles = useStore((s) => s.activeBattles);
  const setActiveBattles = useStore((s) => s.setActiveBattles);
  const selectedHexId = useStore((s) => s.selectedHexId);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const fetchBattles = useCallback(async () => {
    setRefreshing(true);
    setNetworkError(null);
    try {
      // TODO: implement GET /battles endpoint with full list
      // const res = await fetch(`${API_BASE}/battles`);
      // if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // const data = await res.json();
      // setActiveBattles(data.battles);
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRefreshing(false);
    }
  }, [setActiveBattles]);

  const renderItem = useCallback(
    ({ item }: { item: ZoneChallenge }) => <BattleCard challenge={item} />,
    []
  );

  const keyExtractor = useCallback((item: ZoneChallenge) => item.hexId, []);

  // Network error state
  if (networkError && activeBattles.length === 0) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Couldn't Load Battles</Text>
        <Text style={styles.stateError}>{networkError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchBattles}>
          <Text style={styles.retryBtnText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Active Battles</Text>

      {networkError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠ {networkError}</Text>
          <TouchableOpacity onPress={fetchBattles}>
            <Text style={styles.errorBannerRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color="#00ff88" style={{ marginTop: 40 }} />
      ) : activeBattles.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Active Battles</Text>
          <Text style={styles.emptyBody}>
            Declare a challenge from the Zone screen to start a 14-day battle.
          </Text>
        </View>
      ) : (
        <FlatList
          data={activeBattles}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={fetchBattles}
              tintColor="#00ff88"
            />
          }
          // Performance: draw 5 items outside viewport for smooth scrolling
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d", padding: 20 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 16 },
  state: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d0d0d",
    padding: 32,
    gap: 16,
  },
  stateTitle: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "center" },
  stateError: { color: "#ff4444", fontSize: 14, textAlign: "center" },
  retryBtn: {
    backgroundColor: "#00ff88",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  retryBtnText: { color: "#000", fontWeight: "700", fontSize: 14 },
  errorBanner: {
    backgroundColor: "#1a0606",
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#ff4444",
  },
  errorBannerText: { color: "#ff4444", fontSize: 13, flex: 1 },
  errorBannerRetry: {
    color: "#ff4444",
    fontWeight: "700",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "600", textAlign: "center" },
  emptyBody: { color: "#666", fontSize: 15, textAlign: "center", lineHeight: 22 },
  list: { gap: 12, paddingBottom: 16 },
});
