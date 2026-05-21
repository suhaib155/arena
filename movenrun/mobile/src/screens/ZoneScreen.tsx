import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useStore } from "../store/index.js";
import { useChain } from "../hooks/useChain.js";
import { useZone } from "../hooks/useZone.js";

const MIN_MOVE_FOR_MINT = BigInt("500000000000000000000"); // 500 $MOVE

export default function ZoneScreen() {
  const selectedHexId = useStore((s) => s.selectedHexId);
  const moveBalance = useStore((s) => s.moveBalance);
  const { zone, eligibility, loading, error: zoneError, requestMintSig } = useZone(selectedHexId);
  const { walletAddress, authenticated, login, getSigner } = useChain();
  const [mintError, setMintError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);

  const handleMint = async () => {
    if (!walletAddress || !selectedHexId || !eligibility) return;
    setMintError(null);
    setMinting(true);
    try {
      const { mintCost, oracleSig } = await requestMintSig(walletAddress);
      const signer = await getSigner();
      // TODO: call ZoneNFT.mintZone via ethers contract
      console.log("Minting zone with cost:", mintCost, "sig:", oracleSig);
    } catch (e: any) {
      setMintError(e.message ?? "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  // No wallet connected
  if (!authenticated) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Wallet Not Connected</Text>
        <Text style={styles.stateBody}>Connect your wallet to view zone details and mint zones.</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={login}>
          <Text style={styles.actionBtnText}>CONNECT WALLET</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No hex selected yet
  if (!selectedHexId) {
    return (
      <View style={styles.state}>
        <Text style={styles.emptyText}>Select a hex on the map to view zone details.</Text>
      </View>
    );
  }

  // Network / fetch error
  if (zoneError && !loading) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Couldn't Load Zone</Text>
        <Text style={styles.stateError}>{zoneError}</Text>
      </View>
    );
  }

  // Zone is under active challenge
  if (zone?.status === "UnderChallenge") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.hexId}>{selectedHexId}</Text>
        <View style={[styles.card, styles.challengeCard]}>
          <Text style={styles.challengeBadge}>⚔ BATTLE IN PROGRESS</Text>
          <Text style={styles.label}>Owner</Text>
          <Text style={styles.value}>{zone.owner}</Text>
          <Text style={styles.label}>Status</Text>
          <Text style={[styles.value, { color: "#ff6400" }]}>Under Challenge</Text>
          <Text style={styles.infoText}>
            This zone is currently being contested. Check the Battles screen for details.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const mintCostFormatted = eligibility ? Number(eligibility.mintCost) / 1e18 : null;
  const insufficientBalance =
    eligibility && walletAddress &&
    eligibility.isEligible &&
    eligibility.topMover.toLowerCase() === walletAddress.toLowerCase() &&
    moveBalance < eligibility.mintCost;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hexId}>{selectedHexId}</Text>

      {loading && <ActivityIndicator color="#00ff88" style={{ marginVertical: 20 }} />}

      {zone ? (
        <View style={styles.card}>
          <Text style={styles.label}>Owner</Text>
          <Text style={styles.value}>{zone.owner}</Text>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{zone.status}</Text>
          <Text style={styles.label}>Weekly Movers</Text>
          <Text style={styles.value}>{zone.weeklyMoverCount}</Text>
        </View>
      ) : (
        !loading && <Text style={styles.label}>Zone not yet minted</Text>
      )}

      {eligibility?.isEligible &&
        walletAddress &&
        eligibility.topMover.toLowerCase() === walletAddress.toLowerCase() && (
        <>
          {insufficientBalance ? (
            <View style={styles.insufficientCard}>
              <Text style={styles.insufficientTitle}>Insufficient $MOVE</Text>
              <Text style={styles.insufficientBody}>
                You need {mintCostFormatted?.toFixed(0)} $MOVE to mint this zone.{"\n"}
                Your balance: {(Number(moveBalance) / 1e18).toFixed(2)} $MOVE
              </Text>
              <Text style={styles.insufficientHint}>
                Complete more runs to earn $MOVE.
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.mintBtn, minting && styles.mintBtnDisabled]}
              onPress={handleMint}
              disabled={minting}
            >
              {minting ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Text style={styles.mintBtnText}>MINT THIS ZONE</Text>
                  <Text style={styles.mintCost}>
                    Cost: {mintCostFormatted?.toFixed(2)} $MOVE
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </>
      )}

      {mintError && <Text style={styles.mintError}>{mintError}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 16 },
  state: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d0d0d",
    padding: 32,
    gap: 16,
  },
  stateTitle: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "center" },
  stateBody: { color: "#888", fontSize: 15, textAlign: "center" },
  stateError: { color: "#ff4444", fontSize: 14, textAlign: "center" },
  emptyText: { color: "#666", fontSize: 16 },
  hexId: { color: "#00ff88", fontFamily: "monospace", fontSize: 13 },
  card: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, gap: 8 },
  challengeCard: { borderWidth: 1, borderColor: "#ff6400" },
  challengeBadge: { color: "#ff6400", fontWeight: "700", fontSize: 14, marginBottom: 4 },
  infoText: { color: "#888", fontSize: 13, marginTop: 8 },
  label: { color: "#888", fontSize: 12, textTransform: "uppercase" },
  value: { color: "#fff", fontSize: 16, fontWeight: "600" },
  mintBtn: {
    backgroundColor: "#00ff88",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
  },
  mintBtnDisabled: { opacity: 0.6 },
  mintBtnText: { color: "#000", fontWeight: "700", fontSize: 16 },
  mintCost: { color: "#000", fontSize: 13, marginTop: 4 },
  mintError: { color: "#ff4444", fontSize: 13, textAlign: "center" },
  actionBtn: {
    backgroundColor: "#00ff88",
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  actionBtnText: { color: "#000", fontWeight: "700", fontSize: 15, letterSpacing: 1 },
  insufficientCard: {
    backgroundColor: "#1a0a0a",
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#ff4444",
  },
  insufficientTitle: { color: "#ff4444", fontWeight: "700", fontSize: 15 },
  insufficientBody: { color: "#ccc", fontSize: 14, lineHeight: 20 },
  insufficientHint: { color: "#888", fontSize: 12 },
});
