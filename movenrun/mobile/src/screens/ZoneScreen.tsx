import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useStore } from "../store/index";
import { useZone } from "../hooks/useZone";
import { useChain } from "../hooks/useChain";
import { COLORS } from "../constants/colors";

export default function ZoneScreen() {
  const selectedHexId = useStore((s) => s.selectedHexId);
  const { zone, eligibility, loading, requestMintSig } = useZone(selectedHexId);
  const { walletAddress, getSigner } = useChain();

  const handleMint = async () => {
    if (!walletAddress || !selectedHexId || !eligibility) return;
    try {
      const { mintCost, oracleSig } = await requestMintSig(walletAddress);
      const signer = await getSigner();
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

      {loading && <Text style={styles.muted}>Loading...</Text>}

      {zone ? (
        <View style={styles.card}>
          <Row label="Owner" value={`${zone.owner.slice(0, 6)}…${zone.owner.slice(-4)}`} />
          <Row label="Status" value={zone.status} valueColor={statusColor(zone.status)} />
          <Row label="Weekly Movers" value={String(zone.weeklyMoverCount)} />
          <Row
            label="Yield"
            value={`${(Number(zone.accumulatedZoneYield) / 1e18).toFixed(2)} $MOVE`}
            valueColor={COLORS.gold}
          />
        </View>
      ) : !loading ? (
        <Text style={styles.muted}>Zone not yet minted</Text>
      ) : null}

      {eligibility?.isEligible &&
        eligibility.topMover.toLowerCase() === walletAddress?.toLowerCase() && (
          <TouchableOpacity style={styles.mintBtn} onPress={handleMint}>
            <Text style={styles.mintBtnText}>MINT THIS ZONE</Text>
            <Text style={styles.mintCost}>
              {(Number(eligibility.mintCost) / 1e18).toFixed(0)} $MOVE
            </Text>
          </TouchableOpacity>
        )}
    </ScrollView>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "ACTIVE": return COLORS.signal;
    case "UNDER_CHALLENGE": return COLORS.ember;
    case "DORMANT": return COLORS.mist;
    default: return COLORS.frost;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.abyss },
  content: { padding: 20, gap: 16 },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.abyss,
  },
  emptyText: { color: COLORS.mist, fontSize: 16 },
  hexId: {
    color: COLORS.signal,
    fontFamily: "monospace",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  muted: { color: COLORS.mist, fontSize: 14, fontStyle: "italic" },
  card: {
    backgroundColor: COLORS.slateHi,
    borderRadius: 16,
    padding: 16,
    gap: 0,
    borderWidth: 1,
    borderColor: `${COLORS.line}80`,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: `${COLORS.line}40`,
  },
  rowLabel: {
    color: COLORS.mist,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: "monospace",
  },
  rowValue: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  mintBtn: {
    backgroundColor: COLORS.signal,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  mintBtnText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 1,
  },
  mintCost: {
    color: "#000",
    fontSize: 13,
    opacity: 0.7,
  },
});
