import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import BottomSheet, {
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { BlurView } from "expo-blur";
import { useStore } from "../store/index";
import { BattleCard } from "./BattleCard";
import { COLORS } from "../constants/colors";
import { useZone } from "../hooks/useZone";
import { useChain } from "../hooks/useChain";

interface Props {
  isTracking: boolean;
  elapsed: number;
  distanceKm: number;
  earnedThisRun: bigint;
  onStartRun: () => void;
  onStopRun: () => void;
}

export function MapBottomSheet({
  isTracking,
  elapsed,
  distanceKm,
  earnedThisRun,
  onStartRun,
  onStopRun,
}: Props) {
  const sheetRef = useRef<BottomSheet>(null);

  const visibleZones = useStore((s) => s.visibleZones);
  const ownedZoneIds = useStore((s) => s.ownedZoneIds);
  const activeBattles = useStore((s) => s.activeBattles);
  const selectedHexId = useStore((s) => s.selectedHexId);
  const selectHex = useStore((s) => s.selectHex);

  const snapPoints = useMemo(() => [120, "50%", "90%"], []);

  useEffect(() => {
    if (selectedHexId) {
      sheetRef.current?.snapToIndex(1);
    } else {
      sheetRef.current?.snapToIndex(0);
    }
  }, [selectedHexId]);

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  const ownedZones = visibleZones.filter((z) => ownedZoneIds.includes(z.hexId));

  const renderHandle = useCallback(
    () => (
      <View style={styles.handleContainer}>
        <View style={styles.handlePill} />
      </View>
    ),
    [],
  );

  const renderBackground = useCallback(
    () => (
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `${COLORS.slateHi}b8` }]} />
      </BlurView>
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      handleComponent={renderHandle}
      backgroundComponent={renderBackground}
      style={styles.sheet}
      enablePanDownToClose={false}
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {selectedHexId ? (
          <ZoneDetail hexId={selectedHexId} onDismiss={() => selectHex(null)} />
        ) : isTracking ? (
          <RunStats
            minutes={minutes}
            seconds={seconds}
            distanceKm={distanceKm}
            earnedThisRun={earnedThisRun}
            onStop={onStopRun}
          />
        ) : (
          <IdlePeek onStart={onStartRun} />
        )}

        {!selectedHexId && (
          <>
            {ownedZones.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>YOUR ZONES</Text>
                {ownedZones.map((z) => (
                  <ZoneRow
                    key={z.hexId}
                    hexId={z.hexId}
                    status={z.status}
                    movers={z.weeklyMoverCount}
                  />
                ))}
              </View>
            )}

            {activeBattles.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: COLORS.ember }]}>ACTIVE BATTLES</Text>
                {activeBattles.map((b) => (
                  <BattleCard key={b.hexId} challenge={b} />
                ))}
              </View>
            )}

            {visibleZones.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>NEARBY ZONES</Text>
                {visibleZones.slice(0, 8).map((z) => (
                  <ZoneRow
                    key={z.hexId}
                    hexId={z.hexId}
                    status={z.status}
                    movers={z.weeklyMoverCount}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function RunStats({
  minutes,
  seconds,
  distanceKm,
  earnedThisRun,
  onStop,
}: {
  minutes: string;
  seconds: string;
  distanceKm: number;
  earnedThisRun: bigint;
  onStop: () => void;
}) {
  return (
    <View style={styles.runStats}>
      <View style={styles.statGroup}>
        <Text style={styles.statValue}>{minutes}:{seconds}</Text>
        <Text style={styles.statLabel}>TIME</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statGroup}>
        <Text style={styles.statValue}>{distanceKm.toFixed(2)}</Text>
        <Text style={styles.statLabel}>KM</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statGroup}>
        <Text style={[styles.statValue, { color: COLORS.gold }]}>
          {(Number(earnedThisRun) / 1e18).toFixed(3)}
        </Text>
        <Text style={styles.statLabel}>$MOVE</Text>
      </View>
      <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
        <Text style={styles.stopBtnText}>STOP</Text>
      </TouchableOpacity>
    </View>
  );
}

function IdlePeek({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.peekIdle}>
      <Text style={styles.peekPrompt}>Tap START to earn $MOVE</Text>
      <TouchableOpacity style={styles.startBtn} onPress={onStart}>
        <Text style={styles.startBtnText}>START RUN</Text>
      </TouchableOpacity>
    </View>
  );
}

function ZoneDetail({ hexId, onDismiss }: { hexId: string; onDismiss: () => void }) {
  const { zone, eligibility, loading } = useZone(hexId);
  const { walletAddress, getSigner } = useChain();

  const handleMint = async () => {
    if (!walletAddress || !eligibility) return;
    console.log("Initiating mint for", hexId);
  };

  return (
    <View style={styles.zoneDetail}>
      <View style={styles.zoneDetailHeader}>
        <Text style={styles.zoneDetailHexId} numberOfLines={1}>{hexId}</Text>
        <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn}>
          <Text style={styles.dismissText}>×</Text>
        </TouchableOpacity>
      </View>

      {loading && <Text style={styles.zoneDetailMuted}>Loading...</Text>}

      {zone ? (
        <>
          <View style={styles.zoneDetailRow}>
            <Text style={styles.zoneDetailLabel}>OWNER</Text>
            <Text style={styles.zoneDetailValue} numberOfLines={1}>
              {zone.owner.slice(0, 6)}…{zone.owner.slice(-4)}
            </Text>
          </View>
          <View style={styles.zoneDetailRow}>
            <Text style={styles.zoneDetailLabel}>STATUS</Text>
            <View style={[styles.statusChip, { borderColor: statusColor(zone.status) }]}>
              <Text style={[styles.statusChipText, { color: statusColor(zone.status) }]}>
                {zone.status}
              </Text>
            </View>
          </View>
          <View style={styles.zoneDetailRow}>
            <Text style={styles.zoneDetailLabel}>WEEKLY MOVERS</Text>
            <Text style={styles.zoneDetailValue}>{zone.weeklyMoverCount}</Text>
          </View>
          <View style={styles.zoneDetailRow}>
            <Text style={styles.zoneDetailLabel}>YIELD</Text>
            <Text style={[styles.zoneDetailValue, { color: COLORS.gold }]}>
              {(Number(zone.accumulatedZoneYield) / 1e18).toFixed(2)} $MOVE
            </Text>
          </View>
        </>
      ) : !loading ? (
        <Text style={styles.zoneDetailMuted}>Zone not yet minted</Text>
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
    </View>
  );
}

function ZoneRow({
  hexId,
  status,
  movers,
}: {
  hexId: string;
  status: string;
  movers: number;
}) {
  return (
    <View style={styles.zoneRow}>
      <View style={[styles.zoneStatusDot, { backgroundColor: statusColor(status) }]} />
      <Text style={styles.zoneHex} numberOfLines={1}>{hexId}</Text>
      <Text style={styles.zoneStat}>{movers}/wk</Text>
    </View>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "ACTIVE": return COLORS.signal;
    case "UNDER_CHALLENGE": return COLORS.ember;
    case "DORMANT": return COLORS.mist;
    default: return COLORS.line;
  }
}

const styles = StyleSheet.create({
  sheet: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: `${COLORS.slateHi}80`,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 10,
  },
  handlePill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.line,
    shadowColor: COLORS.signal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  runStats: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  statGroup: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    color: COLORS.mist,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 2,
    fontFamily: "monospace",
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.line,
  },
  stopBtn: {
    marginLeft: 12,
    backgroundColor: `${COLORS.enemy}20`,
    borderWidth: 1,
    borderColor: COLORS.enemy,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  stopBtnText: {
    color: COLORS.enemy,
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 1,
  },
  peekIdle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  peekPrompt: {
    color: COLORS.mist,
    fontSize: 14,
    fontFamily: "monospace",
  },
  startBtn: {
    backgroundColor: COLORS.signal,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  startBtnText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 1.2,
  },
  section: {
    marginTop: 24,
    gap: 8,
  },
  sectionTitle: {
    color: COLORS.mist,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 4,
    fontFamily: "monospace",
  },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: `${COLORS.slateHi}60`,
    borderRadius: 10,
    gap: 8,
    marginBottom: 4,
  },
  zoneStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  zoneHex: {
    flex: 1,
    color: COLORS.frost,
    fontSize: 12,
    fontFamily: "monospace",
  },
  zoneStat: {
    color: COLORS.mist,
    fontSize: 11,
  },
  // Zone detail
  zoneDetail: {
    paddingVertical: 8,
    gap: 12,
  },
  zoneDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  zoneDetailHexId: {
    flex: 1,
    color: COLORS.signal,
    fontFamily: "monospace",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${COLORS.slateHi}80`,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissText: {
    color: COLORS.mist,
    fontSize: 20,
    lineHeight: 24,
  },
  zoneDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: `${COLORS.line}60`,
  },
  zoneDetailLabel: {
    color: COLORS.mist,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontFamily: "monospace",
  },
  zoneDetailValue: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  zoneDetailMuted: {
    color: COLORS.mist,
    fontSize: 13,
    fontStyle: "italic",
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  mintBtn: {
    marginTop: 8,
    backgroundColor: COLORS.signal,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    gap: 4,
  },
  mintBtnText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 1,
  },
  mintCost: {
    color: "#000",
    fontSize: 12,
    opacity: 0.7,
  },
});
