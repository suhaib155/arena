import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useStore } from "../store/index.js";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

interface CityEntry {
  rank: number;
  city: string;
  country: string;
  totalKm: number;
  memberCount: number;
  projectedBurn: number;
}

interface IndividualEntry {
  rank: number;
  address: string;
  points: number;
  distanceKm: number;
  isCurrentUser?: boolean;
}

interface SeasonInfo {
  seasonNumber: number;
  daysRemaining: number;
  endsAt: number;
  totalBurnProjected: number;
}

type LeaderboardTab = "cities" | "individual";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const MOCK_CITIES: CityEntry[] = [
  { rank: 1, city: "New York", country: "US", totalKm: 142800, memberCount: 3412, projectedBurn: 28560 },
  { rank: 2, city: "Tokyo", country: "JP", totalKm: 138200, memberCount: 4120, projectedBurn: 27640 },
  { rank: 3, city: "London", country: "GB", totalKm: 119600, memberCount: 2870, projectedBurn: 23920 },
  { rank: 4, city: "Berlin", country: "DE", totalKm: 98400, memberCount: 2100, projectedBurn: 19680 },
  { rank: 5, city: "Paris", country: "FR", totalKm: 87200, memberCount: 1950, projectedBurn: 17440 },
  { rank: 6, city: "Seoul", country: "KR", totalKm: 76500, memberCount: 1780, projectedBurn: 15300 },
  { rank: 7, city: "Singapore", country: "SG", totalKm: 65300, memberCount: 1560, projectedBurn: 13060 },
  { rank: 8, city: "Sydney", country: "AU", totalKm: 54200, memberCount: 1240, projectedBurn: 10840 },
  { rank: 9, city: "Toronto", country: "CA", totalKm: 43800, memberCount: 980, projectedBurn: 8760 },
  { rank: 10, city: "Amsterdam", country: "NL", totalKm: 38400, memberCount: 870, projectedBurn: 7680 },
];

const MOCK_SEASON: SeasonInfo = {
  seasonNumber: 3,
  daysRemaining: 47,
  endsAt: Math.floor(Date.now() / 1000) + 47 * 86400,
  totalBurnProjected: 240000,
};

function generateMockIndividuals(walletAddress: string | null): IndividualEntry[] {
  const entries: IndividualEntry[] = [];
  for (let i = 1; i <= 50; i++) {
    entries.push({
      rank: i,
      address: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`,
      points: Math.floor(8800 - i * 85 + Math.random() * 40),
      distanceKm: Math.floor(440 - i * 4.2 + Math.random() * 20),
    });
  }
  if (walletAddress) {
    entries.push({
      rank: 73,
      address: walletAddress,
      points: 1240,
      distanceKm: 62,
      isCurrentUser: true,
    });
  }
  return entries;
}

function RankMedal({ rank }: { rank: number }) {
  const colors: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };
  const color = colors[rank] ?? "#555";
  return (
    <View style={[medalStyles.circle, { borderColor: color, backgroundColor: color + "20" }]}>
      <Text style={[medalStyles.text, { color }]}>{rank}</Text>
    </View>
  );
}

const medalStyles = StyleSheet.create({
  circle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 12, fontWeight: "800" },
});

function CityRow({ item }: { item: CityEntry }) {
  const isTop3 = item.rank <= 3;
  return (
    <View style={[rowStyles.row, isTop3 && rowStyles.rowHighlight]}>
      <RankMedal rank={item.rank} />
      <View style={rowStyles.info}>
        <Text style={rowStyles.name}>{item.city} <Text style={rowStyles.country}>{item.country}</Text></Text>
        <Text style={rowStyles.sub}>{item.memberCount.toLocaleString()} runners</Text>
      </View>
      <View style={rowStyles.right}>
        <Text style={rowStyles.primaryVal}>{(item.totalKm / 1000).toFixed(1)}k km</Text>
        <Text style={rowStyles.burnVal}>~{item.projectedBurn.toLocaleString()} $MOVE burn</Text>
      </View>
    </View>
  );
}

function IndividualRow({ item }: { item: IndividualEntry }) {
  const isMe = !!item.isCurrentUser;
  return (
    <View style={[rowStyles.row, isMe && rowStyles.rowMe]}>
      <RankMedal rank={item.rank} />
      <View style={rowStyles.info}>
        <Text style={[rowStyles.name, isMe && rowStyles.nameMe]}>
          {isMe ? "You" : `${item.address.slice(0, 6)}…${item.address.slice(-4)}`}
        </Text>
        <Text style={rowStyles.sub}>{item.distanceKm.toLocaleString()} km</Text>
      </View>
      <View style={rowStyles.right}>
        <Text style={rowStyles.primaryVal}>{item.points.toLocaleString()} pts</Text>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  rowHighlight: { backgroundColor: "#ffffff06" },
  rowMe: { backgroundColor: "#00ff8810", borderWidth: 1, borderColor: "#00ff8830", borderRadius: 10 },
  info: { flex: 1 },
  name: { color: "#fff", fontSize: 14, fontWeight: "600" },
  nameMe: { color: "#00ff88" },
  country: { color: "#666", fontWeight: "400" },
  sub: { color: "#666", fontSize: 12, marginTop: 2 },
  right: { alignItems: "flex-end" },
  primaryVal: { color: "#fff", fontWeight: "700", fontSize: 14 },
  burnVal: { color: "#ff6400", fontSize: 11, marginTop: 2 },
});

export function SeasonLeaderboard({ visible, onClose }: Props) {
  const walletAddress = useStore((s) => s.walletAddress);
  const seasonPoints = useStore((s) => s.seasonPoints);
  const seasonRank = useStore((s) => s.seasonRank);

  const [lbTab, setLbTab] = useState<LeaderboardTab>("cities");
  const [loading] = useState(false);

  const individuals = generateMockIndividuals(walletAddress);
  const userEntry = individuals.find((e) => e.isCurrentUser);
  const nextRankEntry = userEntry
    ? individuals.find((e) => e.rank === (userEntry.rank - 1))
    : null;
  const pointsToNext = nextRankEntry ? nextRankEntry.points - seasonPoints : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          {/* Season header */}
          <View style={modalStyles.header}>
            <View>
              <Text style={modalStyles.title}>Season {MOCK_SEASON.seasonNumber} Leaderboard</Text>
              <Text style={modalStyles.sub}>
                {MOCK_SEASON.daysRemaining} days remaining · ends{" "}
                {new Date(MOCK_SEASON.endsAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </Text>
            </View>
            <TouchableOpacity style={modalStyles.closeX} onPress={onClose}>
              <Text style={modalStyles.closeXText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Great Burn preview */}
          <View style={modalStyles.burnBanner}>
            <Text style={modalStyles.burnLabel}>Great Burn Preview</Text>
            <Text style={modalStyles.burnAmount}>
              ~{(MOCK_SEASON.totalBurnProjected / 1000).toFixed(0)}k $MOVE
            </Text>
            <Text style={modalStyles.burnSub}>projected burn from top zones this season</Text>
          </View>

          {/* Your rank */}
          {walletAddress && (
            <View style={modalStyles.myRank}>
              <View>
                <Text style={modalStyles.myRankLabel}>Your Rank</Text>
                <Text style={modalStyles.myRankVal}>#{userEntry?.rank ?? "—"}</Text>
              </View>
              <View style={modalStyles.myRankDiv} />
              <View>
                <Text style={modalStyles.myRankLabel}>Season Points</Text>
                <Text style={modalStyles.myRankVal}>{seasonPoints || userEntry?.points || 0}</Text>
              </View>
              {pointsToNext !== null && (
                <>
                  <View style={modalStyles.myRankDiv} />
                  <View>
                    <Text style={modalStyles.myRankLabel}>To Next Rank</Text>
                    <Text style={[modalStyles.myRankVal, { color: "#ff6400" }]}>
                      +{pointsToNext} pts
                    </Text>
                  </View>
                </>
              )}
            </View>
          )}

          {/* Tab toggle */}
          <View style={modalStyles.tabs}>
            <TouchableOpacity
              style={[modalStyles.tab, lbTab === "cities" && modalStyles.tabActive]}
              onPress={() => setLbTab("cities")}
            >
              <Text style={[modalStyles.tabText, lbTab === "cities" && modalStyles.tabTextActive]}>
                City Wars
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.tab, lbTab === "individual" && modalStyles.tabActive]}
              onPress={() => setLbTab("individual")}
            >
              <Text style={[modalStyles.tabText, lbTab === "individual" && modalStyles.tabTextActive]}>
                Individual
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#00ff88" style={{ marginTop: 32 }} />
          ) : (
            <FlatList
              data={lbTab === "cities" ? MOCK_CITIES : individuals}
              keyExtractor={(item) => String(item.rank)}
              renderItem={({ item }) =>
                lbTab === "cities" ? (
                  <CityRow item={item as CityEntry} />
                ) : (
                  <IndividualRow item={item as IndividualEntry} />
                )
              }
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000cc" },
  sheet: {
    flex: 1,
    backgroundColor: "#0f0f0f",
    marginTop: 60,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 20,
    paddingBottom: 12,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" },
  sub: { color: "#666", fontSize: 13, marginTop: 3 },
  closeX: { padding: 4 },
  closeXText: { color: "#666", fontSize: 18 },
  burnBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#ff640015",
    borderWidth: 1,
    borderColor: "#ff640040",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
  burnLabel: { color: "#ff6400", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  burnAmount: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 },
  burnSub: { color: "#888", fontSize: 12, marginTop: 2 },
  myRank: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  myRankLabel: { color: "#666", fontSize: 11, textTransform: "uppercase", textAlign: "center" },
  myRankVal: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 4 },
  myRankDiv: { width: 1, height: 36, backgroundColor: "#2a2a2a" },
  tabs: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 10 },
  tabActive: { backgroundColor: "#2a2a2a" },
  tabText: { color: "#555", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
});
