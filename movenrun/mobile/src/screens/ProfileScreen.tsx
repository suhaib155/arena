import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
} from "react-native";
import { useChain } from "../hooks/useChain.js";
import { useToken } from "../hooks/useToken.js";
import { useStore, StakingPosition } from "../store/index.js";
import { StakingModal } from "../components/StakingModal.js";
import { SeasonLeaderboard } from "../components/SeasonLeaderboard.js";
import { GearSlot } from "@movenrun/shared";

// ─── Mock data (replaced by real API calls later) ───────────────────────────

const MOCK_ACHIEVEMENTS = [
  { id: "defender", title: "Defender", description: "Successfully defended a zone challenge", earned: true, earnedAt: Date.now() - 86400000 * 5 },
  { id: "reconquest", title: "Reconquest", description: "Reclaimed a lost zone", earned: false },
  { id: "season_champ", title: "Season Champion", description: "Top 10 in individual season ranking", earned: false },
  { id: "city_dom", title: "City Dominator", description: "Your city ranked #1 in City Wars", earned: false },
];

const MOCK_GEAR = [
  { tokenId: 1n, slot: GearSlot.Shoes, name: "Turbo Sneakers", multiplier: 1.5, moveUpgradeCost: 500n * BigInt(1e18), yieldImprovement: 15 },
  { tokenId: 2n, slot: GearSlot.Watch, name: "GPS Pro Watch", multiplier: 1.2, moveUpgradeCost: 300n * BigInt(1e18), yieldImprovement: 8 },
];

const MOCK_RUNS = [
  { id: "r1", date: Date.now() - 86400000, distanceKm: 5.2, moveEarned: BigInt(52) * BigInt(1e18) },
  { id: "r2", date: Date.now() - 86400000 * 2, distanceKm: 3.8, moveEarned: BigInt(38) * BigInt(1e18) },
  { id: "r3", date: Date.now() - 86400000 * 4, distanceKm: 7.1, moveEarned: BigInt(71) * BigInt(1e18) },
];

const MOCK_BATTLES = [
  { hexId: "88283082edfffff", date: Date.now() - 86400000 * 3, result: "win" as const, opponentAddress: "0xabc123", myScore: 24.5, opponentScore: 18.2 },
  { hexId: "88283082e1fffff", date: Date.now() - 86400000 * 8, result: "loss" as const, opponentAddress: "0xdef456", myScore: 12.1, opponentScore: 19.7 },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={secStyles.row}>
      <Text style={secStyles.title}>{title}</Text>
      {action && (
        <TouchableOpacity onPress={onAction}>
          <Text style={secStyles.action}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const secStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  action: { color: "#00ff88", fontSize: 13, fontWeight: "600" },
});

function AnimatedBalance({ value, decimals = 2, color = "#fff", fontSize = 32 }: {
  value: number;
  decimals?: number;
  color?: string;
  fontSize?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [displayed, setDisplayed] = useState(0);
  const prevVal = useRef(0);

  useEffect(() => {
    if (value === prevVal.current) return;
    const from = prevVal.current;
    prevVal.current = value;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: false }).start();
    const listener = anim.addListener(({ value: v }) => {
      setDisplayed(from + (value - from) * v);
    });
    return () => anim.removeListener(listener);
  }, [value]);

  return <Text style={{ color, fontSize, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{displayed.toFixed(decimals)}</Text>;
}

function WalletSection({
  moveBalance,
  zoneBalance,
  stakingPosition,
  onStake,
}: {
  moveBalance: bigint;
  zoneBalance: bigint;
  stakingPosition: StakingPosition | null;
  onStake: () => void;
}) {
  const moveNum = Number(moveBalance) / 1e18;
  const zoneNum = Number(zoneBalance) / 1e18;
  const stakedNum = stakingPosition ? Number(stakingPosition.stakedAmount) / 1e18 : 0;
  const earnedZoneNum = stakingPosition ? Number(stakingPosition.earnedZone) / 1e18 : 0;

  return (
    <View style={styles.section}>
      <SectionHeader title="Wallet & Balance" />

      <View style={walletStyles.balanceRow}>
        <View style={walletStyles.balCard}>
          <Text style={walletStyles.balLabel}>$MOVE</Text>
          <AnimatedBalance value={moveNum} color="#00ff88" />
        </View>
        <View style={walletStyles.balCard}>
          <Text style={walletStyles.balLabel}>$ZONE</Text>
          <AnimatedBalance value={zoneNum} color="#6060ff" />
        </View>
      </View>

      {stakingPosition ? (
        <View style={walletStyles.stakingCard}>
          <View style={walletStyles.stakingHeader}>
            <Text style={walletStyles.stakingTitle}>Staking Position</Text>
            <View style={walletStyles.stakingBadge}>
              <Text style={walletStyles.stakingBadgeText}>{stakingPosition.lockDays}d lock</Text>
            </View>
          </View>
          <View style={walletStyles.stakingRow}>
            <Text style={walletStyles.stakingLabel}>Staked</Text>
            <Text style={walletStyles.stakingVal}>{stakedNum.toFixed(2)} $MOVE</Text>
          </View>
          <View style={walletStyles.stakingRow}>
            <Text style={walletStyles.stakingLabel}>Unlocks</Text>
            <Text style={walletStyles.stakingVal}>
              {new Date(stakingPosition.unlockDate * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </Text>
          </View>
          <View style={walletStyles.stakingRow}>
            <Text style={walletStyles.stakingLabel}>Earned $ZONE</Text>
            <Text style={[walletStyles.stakingVal, { color: "#6060ff" }]}>+{earnedZoneNum.toFixed(4)}</Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={walletStyles.stakeBtn} onPress={onStake}>
          <Text style={walletStyles.stakeBtnText}>Stake $MOVE</Text>
          <Text style={walletStyles.stakeBtnSub}>Earn $ZONE · 90 / 180 / 365 day lock</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const walletStyles = StyleSheet.create({
  balanceRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  balCard: { flex: 1, backgroundColor: "#141414", borderRadius: 14, padding: 16 },
  balLabel: { color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  stakingCard: { backgroundColor: "#141414", borderRadius: 14, padding: 16, gap: 10 },
  stakingHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stakingTitle: { color: "#fff", fontWeight: "600", fontSize: 14 },
  stakingBadge: { backgroundColor: "#6060ff22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  stakingBadgeText: { color: "#6060ff", fontSize: 11, fontWeight: "700" },
  stakingRow: { flexDirection: "row", justifyContent: "space-between" },
  stakingLabel: { color: "#666", fontSize: 13 },
  stakingVal: { color: "#ccc", fontSize: 13, fontWeight: "600" },
  stakeBtn: {
    backgroundColor: "#6060ff15",
    borderWidth: 1,
    borderColor: "#6060ff40",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  stakeBtnText: { color: "#6060ff", fontWeight: "700", fontSize: 15 },
  stakeBtnSub: { color: "#6060ff80", fontSize: 12, marginTop: 4 },
});

function MyZonesSection({ zones, onZonePress }: { zones: any[]; onZonePress: (hexId: string) => void }) {
  if (zones.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader title="My Zones" />
        <View style={zoneStyles.empty}>
          <Text style={zoneStyles.emptyText}>No zones owned yet.</Text>
          <Text style={zoneStyles.emptyHint}>Become the top mover in a hex to mint it.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="My Zones" />
      <View style={zoneStyles.grid}>
        {zones.map((zone) => (
          <TouchableOpacity
            key={zone.hexId}
            style={zoneStyles.card}
            onPress={() => onZonePress(zone.hexId)}
          >
            <View style={zoneStyles.hexIcon}>
              <Text style={zoneStyles.hexIconText}>{zone.hexId.slice(-4)}</Text>
            </View>
            <Text style={zoneStyles.zoneId} numberOfLines={1}>{zone.hexId.slice(-8)}</Text>
            <Text style={zoneStyles.yieldLabel}>Daily yield</Text>
            <Text style={zoneStyles.yieldVal}>
              {zone.accumulatedZoneYield
                ? (Number(zone.accumulatedZoneYield) / 1e18).toFixed(1)
                : "—"}{" "}
              $MOVE
            </Text>
            <View style={[zoneStyles.threatBadge, { backgroundColor: threatColor(zone.status) + "22" }]}>
              <Text style={[zoneStyles.threatText, { color: threatColor(zone.status) }]}>
                {zone.status}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function threatColor(status: string) {
  if (status === "UNDER_CHALLENGE") return "#ff6400";
  if (status === "DORMANT") return "#888";
  return "#00ff88";
}

const zoneStyles = StyleSheet.create({
  empty: { backgroundColor: "#141414", borderRadius: 14, padding: 24, alignItems: "center" },
  emptyText: { color: "#888", fontSize: 15, fontWeight: "600" },
  emptyHint: { color: "#555", fontSize: 13, marginTop: 6, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { width: "47%", backgroundColor: "#141414", borderRadius: 14, padding: 14, gap: 4 },
  hexIcon: { width: 44, height: 44, backgroundColor: "#00ff8815", borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  hexIconText: { color: "#00ff88", fontFamily: "monospace", fontSize: 10, fontWeight: "700" },
  zoneId: { color: "#aaa", fontFamily: "monospace", fontSize: 11 },
  yieldLabel: { color: "#555", fontSize: 10, textTransform: "uppercase", marginTop: 4 },
  yieldVal: { color: "#fff", fontWeight: "700", fontSize: 13 },
  threatBadge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  threatText: { fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
});

function GearSection({ gear, onUpgrade }: { gear: typeof MOCK_GEAR; onUpgrade: (tokenId: bigint) => void }) {
  if (gear.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Gear" />
        <Text style={styles.dim}>No gear equipped. Buy gear NFTs to boost earnings.</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Gear" />
      <View style={{ gap: 10 }}>
        {gear.map((item) => (
          <View key={String(item.tokenId)} style={gearStyles.card}>
            <View style={gearStyles.slotBadge}>
              <Text style={gearStyles.slotText}>{item.slot}</Text>
            </View>
            <View style={gearStyles.info}>
              <Text style={gearStyles.name}>{item.name}</Text>
              <Text style={gearStyles.mult}>{item.multiplier}x multiplier</Text>
            </View>
            <TouchableOpacity style={gearStyles.upgradeBtn} onPress={() => onUpgrade(item.tokenId)}>
              <Text style={gearStyles.upgradeCost}>
                {(Number(item.moveUpgradeCost) / 1e18).toFixed(0)} $MOVE
              </Text>
              <Text style={gearStyles.upgradeLabel}>+{item.yieldImprovement}% yield</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

const gearStyles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderRadius: 14, padding: 14, gap: 12 },
  slotBadge: { backgroundColor: "#ffe00020", borderRadius: 10, padding: 10, alignItems: "center", justifyContent: "center" },
  slotText: { color: "#ffe000", fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  info: { flex: 1 },
  name: { color: "#fff", fontWeight: "600", fontSize: 14 },
  mult: { color: "#00ff88", fontSize: 12, marginTop: 2 },
  upgradeBtn: { backgroundColor: "#ff640015", borderWidth: 1, borderColor: "#ff640040", borderRadius: 10, padding: 10, alignItems: "center" },
  upgradeCost: { color: "#ff6400", fontSize: 12, fontWeight: "700" },
  upgradeLabel: { color: "#ff640080", fontSize: 10, marginTop: 2 },
});

function AchievementsSection({ achievements }: { achievements: typeof MOCK_ACHIEVEMENTS }) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Achievements" />
      <View style={achStyles.grid}>
        {achievements.map((ach) => (
          <View
            key={ach.id}
            style={[achStyles.badge, !ach.earned && achStyles.badgeLocked]}
          >
            <Text style={[achStyles.icon, !ach.earned && achStyles.iconLocked]}>
              {ach.id === "defender" ? "🛡" : ach.id === "reconquest" ? "⚔" : ach.id === "season_champ" ? "🏆" : "🌆"}
            </Text>
            <Text style={[achStyles.title, !ach.earned && achStyles.titleLocked]}>{ach.title}</Text>
            <Text style={achStyles.desc} numberOfLines={2}>{ach.description}</Text>
            {ach.earned && ach.earnedAt && (
              <Text style={achStyles.earnedAt}>
                {new Date(ach.earnedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const achStyles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badge: { width: "47%", backgroundColor: "#141414", borderRadius: 14, padding: 14, gap: 4 },
  badgeLocked: { opacity: 0.35 },
  icon: { fontSize: 28 },
  iconLocked: { opacity: 0.5 },
  title: { color: "#fff", fontWeight: "700", fontSize: 13, marginTop: 4 },
  titleLocked: { color: "#666" },
  desc: { color: "#666", fontSize: 11 },
  earnedAt: { color: "#00ff88", fontSize: 10, marginTop: 4 },
});

function HistorySection({
  runs,
  battles,
}: {
  runs: typeof MOCK_RUNS;
  battles: typeof MOCK_BATTLES;
}) {
  const [tab, setTab] = useState<"runs" | "battles">("runs");

  return (
    <View style={styles.section}>
      <SectionHeader title="History" />
      <View style={histStyles.tabs}>
        <TouchableOpacity
          style={[histStyles.tab, tab === "runs" && histStyles.tabActive]}
          onPress={() => setTab("runs")}
        >
          <Text style={[histStyles.tabText, tab === "runs" && histStyles.tabTextActive]}>Runs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[histStyles.tab, tab === "battles" && histStyles.tabActive]}
          onPress={() => setTab("battles")}
        >
          <Text style={[histStyles.tabText, tab === "battles" && histStyles.tabTextActive]}>Battles</Text>
        </TouchableOpacity>
      </View>

      {tab === "runs" ? (
        <View style={{ gap: 8 }}>
          {runs.map((run) => (
            <View key={run.id} style={histStyles.row}>
              <View>
                <Text style={histStyles.date}>
                  {new Date(run.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
                <Text style={histStyles.sub}>{run.distanceKm.toFixed(2)} km</Text>
              </View>
              <Text style={histStyles.earn}>+{(Number(run.moveEarned) / 1e18).toFixed(0)} $MOVE</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {battles.map((b, i) => (
            <View key={i} style={histStyles.row}>
              <View>
                <Text style={histStyles.date}>
                  {new Date(b.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Zone {b.hexId.slice(-6)}
                </Text>
                <Text style={histStyles.sub}>
                  vs {b.opponentAddress.slice(0, 8)}… · {b.myScore.toFixed(1)} km vs {b.opponentScore.toFixed(1)} km
                </Text>
              </View>
              <View style={[histStyles.resultBadge, b.result === "win" ? histStyles.win : histStyles.loss]}>
                <Text style={[histStyles.resultText, { color: b.result === "win" ? "#00ff88" : "#ff4444" }]}>
                  {b.result.toUpperCase()}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const histStyles = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: "#141414", borderRadius: 10, padding: 3, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: "#2a2a2a" },
  tabText: { color: "#555", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#141414", borderRadius: 12, padding: 14 },
  date: { color: "#ccc", fontSize: 13, fontWeight: "600" },
  sub: { color: "#666", fontSize: 12, marginTop: 2 },
  earn: { color: "#00ff88", fontWeight: "700", fontSize: 14 },
  resultBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  win: { backgroundColor: "#00ff8815" },
  loss: { backgroundColor: "#ff444415" },
  resultText: { fontSize: 11, fontWeight: "700" },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { authenticated, walletAddress, login, logout } = useChain();
  const { moveBalance } = useToken();

  const zoneBalance = useStore((s) => s.zoneBalance);
  const stakingPosition = useStore((s) => s.stakingPosition);
  const ownedZones = useStore((s) => s.ownedZones);
  const seasonRank = useStore((s) => s.seasonRank);
  const seasonPoints = useStore((s) => s.seasonPoints);
  const selectHex = useStore((s) => s.selectHex);

  const [stakingVisible, setStakingVisible] = useState(false);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);

  if (!authenticated) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>MovenRun</Text>
        <Text style={styles.dim}>Connect your wallet to view your profile</Text>
        <TouchableOpacity style={styles.connectBtn} onPress={login}>
          <Text style={styles.connectBtnText}>Sign In with Privy</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.profileHeader}>
          <View>
            <Text style={styles.heading}>Profile</Text>
            <Text style={styles.address}>
              {walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.leaderboardBtn}
              onPress={() => setLeaderboardVisible(true)}
            >
              <Text style={styles.leaderboardBtnText}>Season #{seasonRank ?? "—"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <WalletSection
          moveBalance={moveBalance}
          zoneBalance={zoneBalance}
          stakingPosition={stakingPosition}
          onStake={() => setStakingVisible(true)}
        />

        <MyZonesSection zones={ownedZones} onZonePress={(hexId) => selectHex(hexId)} />

        <GearSection gear={MOCK_GEAR} onUpgrade={(id) => console.log("upgrade gear", id)} />

        <AchievementsSection achievements={MOCK_ACHIEVEMENTS} />

        <HistorySection runs={MOCK_RUNS} battles={MOCK_BATTLES} />

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <StakingModal visible={stakingVisible} onClose={() => setStakingVisible(false)} />
      <SeasonLeaderboard visible={leaderboardVisible} onClose={() => setLeaderboardVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 24, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0d0d0d", gap: 16, padding: 32 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "700" },
  address: { color: "#555", fontFamily: "monospace", fontSize: 12, marginTop: 2 },
  profileHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerActions: { gap: 8, alignItems: "flex-end" },
  leaderboardBtn: { backgroundColor: "#ff640015", borderWidth: 1, borderColor: "#ff640040", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  leaderboardBtnText: { color: "#ff6400", fontWeight: "700", fontSize: 13 },
  section: { gap: 4 },
  dim: { color: "#555", fontSize: 14 },
  connectBtn: { backgroundColor: "#00ff88", paddingHorizontal: 32, paddingVertical: 16, borderRadius: 32, marginTop: 8 },
  connectBtnText: { color: "#000", fontWeight: "700", fontSize: 16 },
  logoutBtn: { borderWidth: 1, borderColor: "#1e1e1e", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  logoutText: { color: "#444", fontSize: 15 },
});
