import React, {
  useState,
  useEffect,
  useCallback,
  memo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ZoneStatus } from "@movenrun/shared";
import { useStore } from "../store/index.js";
import { useZone } from "../hooks/useZone.js";
import { useChain } from "../hooks/useChain.js";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

function truncateAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function hexName(hexId: string): string {
  return `Zone #${hexId.slice(0, 8).toUpperCase()}`;
}

function loyaltyLabel(mult: number): string {
  if (mult >= 175) return "1.75x";
  if (mult >= 150) return "1.5x";
  if (mult >= 125) return "1.25x";
  return "1.0x";
}

function statusColor(status: ZoneStatus): string {
  switch (status) {
    case ZoneStatus.Active: return "#3B82F6";
    case ZoneStatus.UnderChallenge: return "#F97316";
    case ZoneStatus.Dormant: return "#6B7280";
    default: return "#9CA3AF";
  }
}

export default memo(function ZoneScreen() {
  const params = useLocalSearchParams<{ hexId?: string }>();
  const selectedHexId = useStore((s) => s.selectedHexId);
  const hexId = params.hexId ?? selectedHexId;

  const walletAddress = useStore((s) => s.walletAddress);
  const activeBattles = useStore((s) => s.activeBattles);

  const { zone, eligibility, loading, error, requestMintSig } = useZone(hexId ?? null);
  const { getProvider, mintZone, declareChallenge } = useChain();

  const [ensName, setEnsName] = useState<string | null>(null);
  const [ensLoading, setEnsLoading] = useState(false);
  const [loyaltyMult, setLoyaltyMult] = useState(100);
  const [showMintModal, setShowMintModal] = useState(false);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [txPending, setTxPending] = useState(false);

  const activeBattle = activeBattles.find((b) => b.hexId === hexId);

  // ENS lookup for zone owner
  useEffect(() => {
    if (!zone?.owner) {
      setEnsName(null);
      return;
    }
    setEnsLoading(true);
    void (async () => {
      try {
        const provider = await getProvider();
        const name = await provider.lookupAddress(zone.owner);
        setEnsName(name);
      } catch {
        setEnsName(null);
      } finally {
        setEnsLoading(false);
      }
    })();
  }, [zone?.owner, getProvider]);

  // Fetch loyalty multiplier from backend (avoids RPC cold-path on each render)
  useEffect(() => {
    if (!hexId || !zone) return;
    void fetch(`${API_BASE}/zones/${hexId}/loyalty`)
      .then((r) => r.json())
      .then((d: { multiplier?: number }) => {
        if (d.multiplier) setLoyaltyMult(d.multiplier);
      })
      .catch(() => undefined);
  }, [hexId, zone]);

  const handleMint = useCallback(async () => {
    if (!walletAddress || !hexId || !eligibility) return;
    setTxPending(true);
    try {
      const { mintCost, oracleSig } = await requestMintSig(walletAddress);
      await mintZone(hexId, BigInt(mintCost), oracleSig);
      setShowMintModal(false);
      Alert.alert(
        "Zone Minted!",
        "You now own this territory. Earn 2% of all $MOVE generated here.",
      );
    } catch (e: unknown) {
      Alert.alert("Mint Failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTxPending(false);
    }
  }, [walletAddress, hexId, eligibility, requestMintSig, mintZone]);

  const handleChallenge = useCallback(async () => {
    if (!hexId || !walletAddress) return;
    setTxPending(true);
    try {
      const res = await fetch(`${API_BASE}/zones/challenge-sig`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hexId, walletAddress }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { defenderBaseScore, oracleSig } = (await res.json()) as {
        defenderBaseScore: string;
        oracleSig: string;
      };
      await declareChallenge(hexId, BigInt(defenderBaseScore), oracleSig);
      setShowChallengeModal(false);
      Alert.alert(
        "Challenge Declared!",
        "The 14-day battle begins now. Move through this zone to increase your score.",
      );
    } catch (e: unknown) {
      Alert.alert("Challenge Failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTxPending(false);
    }
  }, [hexId, walletAddress, declareChallenge]);

  if (!hexId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Tap a zone on the map to explore it.
        </Text>
      </View>
    );
  }

  const isOwner =
    walletAddress &&
    zone?.owner &&
    zone.owner.toLowerCase() === walletAddress.toLowerCase();

  const canMint =
    eligibility?.isEligible &&
    eligibility.topMover.toLowerCase() === walletAddress?.toLowerCase();

  const canChallenge =
    zone &&
    zone.status === ZoneStatus.Active &&
    !isOwner &&
    !activeBattle &&
    !loading;

  const ownerDisplay = ensLoading
    ? "Resolving…"
    : ensName ?? (zone?.owner ? truncateAddr(zone.owner) : "Unminted");

  const challengerPct =
    activeBattle
      ? (() => {
          const total =
            Number(activeBattle.challengerScore) +
            Number(activeBattle.defenderScore);
          return total > 0
            ? (Number(activeBattle.challengerScore) / total) * 100
            : 50;
        })()
      : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <Text style={styles.zoneName}>{hexName(hexId)}</Text>
      <Text style={styles.hexId}>{hexId}</Text>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#3B82F6" size="small" />
          <Text style={styles.loadingText}>Loading zone data…</Text>
        </View>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Owner & stats card */}
      <View style={styles.card}>
        {zone ? (
          <>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>OWNER</Text>
              <Text style={styles.fieldValue}>{ownerDisplay}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>STATUS</Text>
              <Text
                style={[
                  styles.fieldValue,
                  { color: statusColor(zone.status) },
                ]}
              >
                {zone.status}
              </Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>WEEKLY MOVERS</Text>
              <Text style={styles.fieldValue}>{zone.weeklyMoverCount}</Text>
            </View>
            {isOwner && (
              <View style={styles.ownerBadge}>
                <Text style={styles.ownerBadgeText}>You own this zone</Text>
              </View>
            )}
          </>
        ) : (
          !loading && (
            <Text style={styles.unmintedText}>
              This zone has not been minted yet. Be the top mover and claim it!
            </Text>
          )
        )}
      </View>

      {/* Active battle card */}
      {activeBattle && (
        <View style={styles.battleCard}>
          <Text style={styles.battleTitle}>⚔ Active Battle</Text>
          <View style={styles.battleParties}>
            <View style={styles.battleSide}>
              <Text style={styles.battleRole}>CHALLENGER</Text>
              <Text style={styles.battleAddr}>
                {truncateAddr(activeBattle.challenger)}
              </Text>
              <Text style={styles.battleScore}>
                {(Number(activeBattle.challengerScore) / 1e18).toFixed(0)}
              </Text>
            </View>
            <Text style={styles.vs}>VS</Text>
            <View style={[styles.battleSide, { alignItems: "flex-end" }]}>
              <Text style={styles.battleRole}>DEFENDER</Text>
              <Text style={styles.battleAddr}>
                {truncateAddr(activeBattle.defender)}
              </Text>
              <Text style={styles.battleScore}>
                {(Number(activeBattle.defenderScore) / 1e18).toFixed(0)}
              </Text>
            </View>
          </View>
          <View style={styles.progressBg}>
            <View
              style={[
                styles.progressFill,
                { width: `${challengerPct}%` as `${number}%` },
              ]}
            />
          </View>
          <Text style={styles.battleEnd}>
            Ends{" "}
            {new Date(activeBattle.challengeEnd * 1000).toLocaleDateString()}
          </Text>
        </View>
      )}

      {/* Mint CTA */}
      {canMint && (
        <TouchableOpacity
          style={styles.mintBtn}
          onPress={() => setShowMintModal(true)}
        >
          <Text style={styles.mintBtnText}>MINT THIS ZONE</Text>
          <Text style={styles.mintCost}>
            Cost:{" "}
            {eligibility
              ? (Number(eligibility.mintCost) / 1e18).toFixed(0)
              : "—"}{" "}
            $MOVE
          </Text>
        </TouchableOpacity>
      )}

      {/* Challenge CTA */}
      {canChallenge && (
        <TouchableOpacity
          style={styles.challengeBtn}
          onPress={() => setShowChallengeModal(true)}
        >
          <Text style={styles.challengeBtnText}>CHALLENGE ZONE</Text>
          <Text style={styles.challengeHint}>
            Owner loyalty: {loyaltyLabel(loyaltyMult)} bonus · costs 100 $MOVE
          </Text>
        </TouchableOpacity>
      )}

      {/* Mint confirm modal */}
      <Modal visible={showMintModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mint {hexName(hexId)}?</Text>
            <Text style={styles.modalBody}>
              You are the top mover in this zone.{"\n\n"}
              Minting costs{" "}
              {eligibility
                ? (Number(eligibility.mintCost) / 1e18).toFixed(0)
                : "—"}{" "}
              $MOVE (burned).{"\n\n"}
              As owner you earn 2% of all $MOVE minted by anyone moving
              through your zone. Stay active to build your loyalty bonus
              (up to 1.75x) which protects against challenges.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowMintModal(false)}
                disabled={txPending}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, txPending && styles.btnDisabled]}
                onPress={handleMint}
                disabled={txPending}
              >
                <Text style={styles.confirmText}>
                  {txPending ? "Minting…" : "Confirm Mint"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Challenge confirm modal */}
      <Modal visible={showChallengeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Challenge {hexName(hexId)}?
            </Text>
            <Text style={styles.modalBody}>
              Cost: 100 $MOVE (burned on declaration).{"\n\n"}
              The current owner has a{" "}
              <Text style={styles.highlight}>{loyaltyLabel(loyaltyMult)}</Text>{" "}
              loyalty bonus applied to their base score.{"\n\n"}
              If you out-move the defender over 14 days, the Zone NFT
              transfers to you. If you lose, you're locked out of this zone
              for 30 days.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowChallengeModal(false)}
                disabled={txPending}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  styles.challengeConfirmBtn,
                  txPending && styles.btnDisabled,
                ]}
                onPress={handleChallenge}
                disabled={txPending}
              >
                <Text style={styles.confirmText}>
                  {txPending ? "Declaring…" : "Declare Challenge"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 16, paddingBottom: 40 },

  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d0d0d",
    padding: 24,
  },
  emptyText: { color: "#6B7280", fontSize: 16, textAlign: "center" },

  zoneName: { color: "#fff", fontSize: 26, fontWeight: "800" },
  hexId: {
    color: "#6B7280",
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: -8,
  },

  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingText: { color: "#6B7280", fontSize: 14 },
  errorText: { color: "#EF4444", fontSize: 14 },

  card: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fieldLabel: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  fieldValue: { color: "#fff", fontSize: 15, fontWeight: "600", flex: 1, textAlign: "right" },
  ownerBadge: {
    backgroundColor: "#1E3A5F",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
  },
  ownerBadgeText: { color: "#3B82F6", fontSize: 12, fontWeight: "700" },
  unmintedText: { color: "#9CA3AF", fontSize: 14, lineHeight: 22 },

  battleCard: {
    backgroundColor: "#1C1008",
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#F97316",
  },
  battleTitle: { color: "#F97316", fontWeight: "800", fontSize: 15 },
  battleParties: {
    flexDirection: "row",
    alignItems: "center",
  },
  battleSide: { flex: 1 },
  battleRole: {
    color: "#9CA3AF",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  battleAddr: { color: "#fff", fontFamily: "monospace", fontSize: 13 },
  battleScore: {
    color: "#F97316",
    fontSize: 28,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  vs: { color: "#6B7280", fontWeight: "800", paddingHorizontal: 10 },
  progressBg: {
    height: 6,
    backgroundColor: "#374151",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: "#F97316", borderRadius: 3 },
  battleEnd: { color: "#9CA3AF", fontSize: 12 },

  mintBtn: {
    backgroundColor: "#3B82F6",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  mintBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 1 },
  mintCost: { color: "rgba(255,255,255,0.7)", fontSize: 13 },

  challengeBtn: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#F97316",
  },
  challengeBtnText: {
    color: "#F97316",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 1,
  },
  challengeHint: { color: "#9CA3AF", fontSize: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#111827",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    gap: 16,
    borderTopWidth: 1,
    borderColor: "#1F2937",
  },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "800" },
  modalBody: { color: "#9CA3AF", fontSize: 14, lineHeight: 22 },
  highlight: { color: "#F97316", fontWeight: "700" },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelText: { color: "#9CA3AF", fontWeight: "600", fontSize: 14 },
  confirmBtn: {
    flex: 1,
    backgroundColor: "#3B82F6",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  challengeConfirmBtn: { backgroundColor: "#F97316" },
  confirmText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
});
