import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useStore } from "../store/index.js";
import { useZone } from "../hooks/useZone.js";
import { useChain } from "../hooks/useChain.js";

export default function ZoneScreen() {
  const selectedHexId = useStore((s) => s.selectedHexId);
  const { zone, eligibility, loading, requestMintSig } = useZone(selectedHexId);
  const { walletAddress, getSigner } = useChain();

  const handleMint = async () => {
    if (!walletAddress || !selectedHexId || !eligibility) return;
    try {
      const { mintCost, oracleSig } = await requestMintSig(walletAddress);
      const signer = await getSigner();
      // TODO: call ZoneNFT.mintZone via ethers contract
      console.log("Minting zone with cost:", mintCost, "sig:", oracleSig);
    } catch (e: any) {
      console.error("Mint error:", e.message);
    }
  };

  if (!selectedHexId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Select a hex on the map to view zone details.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hexId}>{selectedHexId}</Text>

      {loading && <Text style={styles.label}>Loading...</Text>}

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
        <Text style={styles.label}>Zone not yet minted</Text>
      )}

      {eligibility?.isEligible && eligibility.topMover.toLowerCase() === walletAddress?.toLowerCase() && (
        <TouchableOpacity style={styles.mintBtn} onPress={handleMint}>
          <Text style={styles.mintBtnText}>MINT THIS ZONE</Text>
          <Text style={styles.mintCost}>Cost: {Number(eligibility.mintCost) / 1e18} $MOVE</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 16 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0d0d0d" },
  emptyText: { color: "#666", fontSize: 16 },
  hexId: { color: "#00ff88", fontFamily: "monospace", fontSize: 13 },
  card: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, gap: 8 },
  label: { color: "#888", fontSize: 12, textTransform: "uppercase" },
  value: { color: "#fff", fontSize: 16, fontWeight: "600" },
  mintBtn: { backgroundColor: "#00ff88", borderRadius: 12, padding: 20, alignItems: "center" },
  mintBtnText: { color: "#000", fontWeight: "700", fontSize: 16 },
  mintCost: { color: "#000", fontSize: 13, marginTop: 4 },
});
