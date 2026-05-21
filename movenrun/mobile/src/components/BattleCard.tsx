import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Animated,
} from "react-native";
import { ZoneChallenge } from "@movenrun/shared";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

interface Props {
  challenge: ZoneChallenge;
  walletAddress: string | null;
  onReconquest?: (hexId: string) => void;
}

function useCountdown(endTs: number) {
  const [remaining, setRemaining] = useState(Math.max(0, endTs - Date.now() / 1000));

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [endTs]);

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = Math.floor(remaining % 60);

  return { remaining, days, hours, mins, secs };
}

function HexMiniMap({ hexId }: { hexId: string }) {
  return (
    <View style={miniStyles.container}>
      <View style={miniStyles.hexWrapper}>
        <Text style={miniStyles.hexId} numberOfLines={1}>
          {hexId.slice(-6)}
        </Text>
      </View>
    </View>
  );
}

function Avatar({ address, color }: { address: string; color: string }) {
  const initials = address.slice(2, 4).toUpperCase();
  return (
    <View style={[avatarStyles.circle, { backgroundColor: color + "33", borderColor: color }]}>
      <Text style={[avatarStyles.text, { color }]}>{initials}</Text>
    </View>
  );
}

function RallyClubModal({
  visible,
  onClose,
  hexId,
}: {
  visible: boolean;
  onClose: () => void;
  hexId: string;
}) {
  type Member = { address: string; contribution: number };
  const mockMembers: Member[] = [
    { address: "0xabc1230000000000", contribution: 12.4 },
    { address: "0xdef4560000000000", contribution: 8.1 },
    { address: "0x9876540000000000", contribution: 3.2 },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <Text style={modalStyles.title}>Rally Club</Text>
          <Text style={modalStyles.sub}>Zone {hexId.slice(-6)} — Club members can contribute movement</Text>

          <FlatList
            data={mockMembers}
            keyExtractor={(m) => m.address}
            renderItem={({ item }) => (
              <View style={modalStyles.memberRow}>
                <Avatar address={item.address} color="#00ff88" />
                <Text style={modalStyles.memberAddr}>{item.address.slice(0, 10)}…</Text>
                <Text style={modalStyles.memberContrib}>{item.contribution.toFixed(1)} km</Text>
              </View>
            )}
            style={{ marginVertical: 12 }}
          />

          <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose}>
            <Text style={modalStyles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export function BattleCard({ challenge, walletAddress, onReconquest }: Props) {
  const { remaining, days, hours, mins, secs } = useCountdown(challenge.challengeEnd);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const challengerScore = Number(challenge.challengerScore) / 1e18;
  const defenderScore = Number(challenge.defenderScore) / 1e18;
  const total = challengerScore + defenderScore || 1;
  const challengerPct = (challengerScore / total) * 100;

  const isDefender = walletAddress?.toLowerCase() === challenge.defender.toLowerCase();
  const isChallenger = walletAddress?.toLowerCase() === challenge.challenger.toLowerCase();
  const isEnded = challenge.resolved || remaining <= 0;

  const userWon =
    isEnded &&
    challenge.winner?.toLowerCase() === walletAddress?.toLowerCase();
  const userLost = isEnded && (isDefender || isChallenger) && !userWon;

  const [rallyVisible, setRallyVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (remaining > 0 && remaining < 3600) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.04, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [remaining]);

  const handleBoost = async () => {
    setActionLoading("boost");
    try {
      await fetch(`${API_BASE}/battles/${challenge.hexId}/boost`, { method: "POST" });
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExtension = async () => {
    setActionLoading("extend");
    try {
      await fetch(`${API_BASE}/battles/${challenge.hexId}/extend`, { method: "POST" });
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
      {/* Header row: hex mini-map + zone info */}
      <View style={styles.header}>
        <HexMiniMap hexId={challenge.hexId} />
        <View style={styles.headerInfo}>
          <Text style={styles.hexId} numberOfLines={1}>
            Zone {challenge.hexId.slice(-6)}
          </Text>
          {isEnded ? (
            <View style={[styles.badge, userWon ? styles.badgeWin : styles.badgeLoss]}>
              <Text style={styles.badgeText}>{userWon ? "VICTORY" : isDefender || isChallenger ? "DEFEAT" : "ENDED"}</Text>
            </View>
          ) : (
            <View style={styles.timerRow}>
              <Text style={styles.timerDot}>●</Text>
              <Text style={styles.timer}>
                {days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m ${secs}s`}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Participants */}
      <View style={styles.participants}>
        <View style={styles.side}>
          <Avatar address={challenge.challenger} color="#ff6400" />
          <Text style={styles.role}>ATTACKER</Text>
          <Text style={styles.addr}>{challenge.challenger.slice(0, 6)}…{challenge.challenger.slice(-4)}</Text>
          <Text style={[styles.score, { color: "#ff6400" }]}>{challengerScore.toFixed(1)} km</Text>
        </View>

        <View style={styles.vsCol}>
          <Text style={styles.vs}>VS</Text>
          {challenge.strongholdBoostExpiry > Date.now() / 1000 && (
            <Text style={styles.boostActive}>⚡ BOOST</Text>
          )}
        </View>

        <View style={[styles.side, styles.rightSide]}>
          <Avatar address={challenge.defender} color="#00ff88" />
          <Text style={styles.role}>DEFENDER</Text>
          <Text style={styles.addr}>{challenge.defender.slice(0, 6)}…{challenge.defender.slice(-4)}</Text>
          <Text style={[styles.score, { color: "#00ff88" }]}>{defenderScore.toFixed(1)} km</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${challengerPct}%` }]} />
        <View
          style={[
            styles.progressLabel,
            { left: `${Math.min(Math.max(challengerPct - 5, 2), 88)}%` as any },
          ]}
        />
      </View>
      <View style={styles.progressLegend}>
        <Text style={styles.legendAttack}>{challengerPct.toFixed(0)}%</Text>
        <Text style={styles.legendDefend}>{(100 - challengerPct).toFixed(0)}%</Text>
      </View>

      {/* Defender actions */}
      {isDefender && !isEnded && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.boostBtn]}
            onPress={handleBoost}
            disabled={actionLoading === "boost"}
          >
            <Text style={styles.actionBtnTitle}>Activate Stronghold Boost</Text>
            <Text style={styles.actionBtnSub}>300 $MOVE · +20% score · 24h</Text>
          </TouchableOpacity>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtnSm, styles.rallyBtn]}
              onPress={() => setRallyVisible(true)}
            >
              <Text style={styles.actionBtnSmTitle}>Rally Club</Text>
              <Text style={styles.actionBtnSmSub}>Members contribute</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtnSm, styles.extendBtn, challenge.timeExtensionUsed && styles.disabled]}
              onPress={handleExtension}
              disabled={challenge.timeExtensionUsed || actionLoading === "extend"}
            >
              <Text style={styles.actionBtnSmTitle}>
                {challenge.timeExtensionUsed ? "Extended" : "Request Extension"}
              </Text>
              <Text style={styles.actionBtnSmSub}>
                {challenge.timeExtensionUsed ? "Already used" : "500 $MOVE · +3 days"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* End state */}
      {isEnded && userLost && isDefender && (
        <TouchableOpacity
          style={styles.reconquestBtn}
          onPress={() => onReconquest?.(challenge.hexId)}
        >
          <Text style={styles.reconquestTitle}>Reconquest Available</Text>
          <Text style={styles.reconquestSub}>Challenge back to reclaim your zone</Text>
        </TouchableOpacity>
      )}

      {isEnded && userWon && (
        <View style={styles.winBanner}>
          <Text style={styles.winText}>Zone secured! Yield continues.</Text>
        </View>
      )}

      <RallyClubModal
        visible={rallyVisible}
        onClose={() => setRallyVisible(false)}
        hexId={challenge.hexId}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#1a1a1a", borderRadius: 16, padding: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerInfo: { flex: 1, gap: 4 },
  hexId: { color: "#fff", fontWeight: "700", fontSize: 15 },
  timerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  timerDot: { color: "#ff6400", fontSize: 8 },
  timer: { color: "#ff6400", fontSize: 13, fontVariant: ["tabular-nums"] },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeWin: { backgroundColor: "#00ff8830" },
  badgeLoss: { backgroundColor: "#ff003320" },
  badgeText: { fontWeight: "700", fontSize: 11, color: "#fff" },
  participants: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1, alignItems: "flex-start", gap: 4 },
  rightSide: { alignItems: "flex-end" },
  vsCol: { alignItems: "center", paddingHorizontal: 8 },
  vs: { color: "#555", fontWeight: "900", fontSize: 14 },
  boostActive: { color: "#ffe000", fontSize: 10, fontWeight: "700", marginTop: 4 },
  role: { color: "#555", fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  addr: { color: "#aaa", fontFamily: "monospace", fontSize: 11 },
  score: { fontSize: 22, fontWeight: "800", fontVariant: ["tabular-nums"] },
  progressBg: { height: 6, backgroundColor: "#2a2a2a", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: "#ff6400", borderRadius: 3 },
  progressLabel: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "#fff" },
  progressLegend: { flexDirection: "row", justifyContent: "space-between" },
  legendAttack: { color: "#ff6400", fontSize: 11, fontWeight: "700" },
  legendDefend: { color: "#00ff88", fontSize: 11, fontWeight: "700" },
  actions: { gap: 8 },
  actionBtn: { borderRadius: 12, padding: 14, alignItems: "center" },
  boostBtn: { backgroundColor: "#ffe00015", borderWidth: 1, borderColor: "#ffe00040" },
  actionBtnTitle: { color: "#ffe000", fontWeight: "700", fontSize: 14 },
  actionBtnSub: { color: "#ffe00099", fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtnSm: { flex: 1, borderRadius: 12, padding: 12, alignItems: "center" },
  rallyBtn: { backgroundColor: "#00ff8810", borderWidth: 1, borderColor: "#00ff8840" },
  extendBtn: { backgroundColor: "#6060ff10", borderWidth: 1, borderColor: "#6060ff40" },
  actionBtnSmTitle: { color: "#fff", fontWeight: "700", fontSize: 12 },
  actionBtnSmSub: { color: "#888", fontSize: 10, marginTop: 2 },
  disabled: { opacity: 0.4 },
  reconquestBtn: {
    backgroundColor: "#ff003315",
    borderWidth: 1,
    borderColor: "#ff003350",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  reconquestTitle: { color: "#ff4444", fontWeight: "700", fontSize: 14 },
  reconquestSub: { color: "#ff444499", fontSize: 12, marginTop: 2 },
  winBanner: {
    backgroundColor: "#00ff8815",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  winText: { color: "#00ff88", fontWeight: "600", fontSize: 13 },
});

const miniStyles = StyleSheet.create({
  container: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  hexWrapper: {
    width: 56,
    height: 56,
    backgroundColor: "#ff640020",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ff640060",
    alignItems: "center",
    justifyContent: "center",
  },
  hexId: { color: "#ff6400", fontSize: 9, fontFamily: "monospace", fontWeight: "700" },
});

const avatarStyles = StyleSheet.create({
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { fontSize: 12, fontWeight: "800" },
});

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000099", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#161616", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" },
  sub: { color: "#888", fontSize: 13, marginTop: 4 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  memberAddr: { flex: 1, color: "#ccc", fontFamily: "monospace", fontSize: 12 },
  memberContrib: { color: "#00ff88", fontWeight: "700", fontSize: 13 },
  closeBtn: { backgroundColor: "#2a2a2a", borderRadius: 12, padding: 14, alignItems: "center" },
  closeBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
