import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { ScalePress } from "@/components/ScalePress";
import { FloatingMapControl } from "@/components/FloatingMapControl";
import { MapLegend, type LegendItem } from "@/components/MapLegend";
import { ZoneSheet } from "@/components/ZoneSheet";
import { healthVisual } from "@/components/ZoneCard";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { HEALTH_LABEL } from "@/lib/territory";
import { buildTerritoryOverview, type MapCell } from "@/lib/territoryMap";
import { tapFeedback } from "@/lib/haptics";

function lastDefendedText(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Defended today";
  if (days === 1) return "Defended yesterday";
  return `Defended ${days}d ago`;
}

const LEGEND: LegendItem[] = [
  { label: "Healthy", color: palette.pulseGreen },
  { label: "At risk", color: palette.heatCoral },
  { label: "Dormant", color: palette.silverTrail },
  { label: "Deed", color: palette.deedViolet },
];

/**
 * Territory — the primary spatial surface. The territory board (real captured
 * zones, no decorative fake hexes) fills the viewport; compact floating
 * controls sit over it; the selected zone opens a collapsed/expanded sheet.
 * All geometry comes from safe zone state (no raw GPS, coordinates, or route
 * paths).
 */
export default function TerritoryMapScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const hydrated = useGameStore((s) => s._hydrated);
  const now = Date.now();
  const overview = useMemo(() => buildTerritoryOverview(zones, now), [zones, now]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showLegend, setShowLegend] = useState(true);

  const selected = overview.cells.find((c) => c.zone.id === selectedId) ?? null;
  const rows = useMemo(() => {
    const out: MapCell[][] = [];
    for (const cell of overview.cells) {
      (out[cell.row] ??= [])[cell.col] = cell;
    }
    return out.map((r) => r.filter(Boolean));
  }, [overview.cells]);

  const needsDefense = overview.atRisk + overview.contestedPreview + overview.dormant;

  const selectZone = (id: string) => {
    tapFeedback();
    setExpanded(false);
    setSelectedId((cur) => (cur === id ? null : id));
  };

  const viewZone = (id: string) => {
    tapFeedback();
    router.push({ pathname: "/zone/[id]", params: { id } });
  };

  return (
    <Screen edgeTop>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Territory</Text>
        {overview.total > 0 ? (
          <View style={styles.headerStat}>
            <Text style={styles.headerStatValue}>{overview.total}</Text>
            <Text style={styles.headerStatLabel}>{overview.total === 1 ? "zone" : "zones"}</Text>
          </View>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      {/* The board dominates the viewport */}
      <View style={styles.board}>
        {!hydrated ? (
          <MapSkeleton />
        ) : overview.total === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="map-outline" size={30} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No territory yet</Text>
            <Text style={styles.emptyText}>
              Start Move to capture your first zone. Your captured tiles appear
              here as a live local board.
            </Text>
            <Button
              label="Start Move"
              icon="walk"
              onPress={() => {
                tapFeedback();
                router.push("/move");
              }}
              style={styles.emptyCta}
            />
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={styles.boardScroll}
              showsVerticalScrollIndicator={false}
            >
              {rows.map((row, ri) => (
                <View key={ri} style={[styles.boardRow, ri % 2 === 1 ? styles.boardRowOffset : null]}>
                  {row.map((cell) => {
                    const hv = healthVisual(cell.status.health);
                    const sel = cell.zone.id === selectedId;
                    return (
                      <ScalePress
                        key={cell.zone.id}
                        to={0.9}
                        style={sel ? [styles.cell, styles.cellSelected] : styles.cell}
                        onPress={() => selectZone(cell.zone.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${cell.zone.name}, ${HEALTH_LABEL[cell.status.health]}${sel ? ", selected" : ""}`}
                      >
                        <Hexagon
                          size={44}
                          color={cell.zone.isDeedPreview ? "#E1DAFF" : hv.fill}
                          coreColor={cell.zone.isDeedPreview ? palette.deedViolet : hv.core}
                        />
                      </ScalePress>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            {/* Floating map controls */}
            <View style={styles.floatingControls}>
              <FloatingMapControl
                icon="information-circle-outline"
                accessibilityLabel={showLegend ? "Hide legend" : "Show legend"}
                active={showLegend}
                onPress={() => {
                  tapFeedback();
                  setShowLegend((v) => !v);
                }}
              />
              {selectedId ? (
                <FloatingMapControl
                  icon="scan-outline"
                  accessibilityLabel="Clear selection"
                  onPress={() => {
                    tapFeedback();
                    setSelectedId(null);
                  }}
                />
              ) : null}
            </View>

            {/* Compact legend overlay */}
            {showLegend && !selected ? (
              <View style={styles.legendWrap} pointerEvents="box-none">
                <MapLegend items={LEGEND} />
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Selected → sheet; else compact status/actions */}
      {hydrated && overview.total > 0 ? (
        selected ? (
          <ZoneSheet
            zoneName={selected.zone.name}
            statusLabel={HEALTH_LABEL[selected.status.health]}
            statusColor={healthVisual(selected.status.health).core}
            activity={lastDefendedText(selected.zone.lastDefendedAt, now)}
            actionLabel="View Zone"
            onAction={() => viewZone(selected.zone.id)}
            expanded={expanded}
            onToggle={() => {
              tapFeedback();
              setExpanded((v) => !v);
            }}
            onClose={() => {
              tapFeedback();
              setSelectedId(null);
            }}
            meters={[
              { label: "Control", value: selected.status.control, color: palette.baseBlue },
              { label: "Defence", value: selected.status.defense, color: palette.pulseGreen },
            ]}
            rows={[
              { label: "Health", value: HEALTH_LABEL[selected.status.health] },
              { label: "Risk", value: `${selected.status.risk}%` },
              { label: "Last defended", value: lastDefendedText(selected.zone.lastDefendedAt, now) },
            ]}
          />
        ) : (
          <View style={styles.statusPanel}>
            {overview.priority ? (
              <View style={styles.priorityRow}>
                <View style={styles.priorityIcon}>
                  <Ionicons name="shield-half-outline" size={18} color={palette.heatCoral} />
                </View>
                <View style={styles.priorityBody}>
                  <Text style={styles.priorityKicker}>
                    {needsDefense} zone{needsDefense === 1 ? "" : "s"} need defence
                  </Text>
                  <Text style={styles.priorityName} numberOfLines={1}>
                    Defend next · {overview.priority.name}
                  </Text>
                </View>
                <Button label="View" variant="secondary" onPress={() => viewZone(overview.priority!.id)} />
              </View>
            ) : (
              <View style={styles.allClear}>
                <Ionicons name="checkmark-circle" size={16} color={palette.pulseGreen} />
                <Text style={styles.allClearText}>All zones healthy — moving keeps them charged.</Text>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
            >
              <QuickLink icon="notifications-outline" label="Alerts" onPress={() => { tapFeedback(); router.push("/territory/alerts"); }} />
              <QuickLink icon="business-outline" label="City" onPress={() => { tapFeedback(); router.push("/city-districts"); }} />
              <QuickLink icon="color-wand-outline" label="Rivals" onPress={() => { tapFeedback(); router.push("/rivals"); }} />
              <QuickLink icon="ribbon-outline" label="Collections" onPress={() => { tapFeedback(); router.push("/collections"); }} />
            </ScrollView>
          </View>
        )
      ) : null}
    </Screen>
  );
}

function QuickLink({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  return (
    <ScalePress
      to={0.95}
      onPress={onPress}
      style={styles.quickLink}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.quickLabel}>{label}</Text>
    </ScalePress>
  );
}

function MapSkeleton() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading your territory">
      {[0, 1, 2].map((r) => (
        <View key={r} style={[styles.boardRow, r % 2 === 1 ? styles.boardRowOffset : null]}>
          {[0, 1, 2].map((c) => (
            <View key={c} style={styles.skeletonCell} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.heading, fontSize: 17 },
  headerStat: { alignItems: "center", minWidth: 40 },
  headerStatValue: { ...type.heading, fontSize: 16, fontVariant: ["tabular-nums"] },
  headerStatLabel: { ...type.caption, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.5 },

  board: {
    flex: 1,
    marginHorizontal: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    ...shadows.card,
  },
  boardScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  boardRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  boardRowOffset: { marginLeft: 26 },
  cell: { borderRadius: radius.pill, padding: 3 },
  cellSelected: { backgroundColor: `${palette.baseBlue}24` },

  floatingControls: { position: "absolute", top: spacing.md, right: spacing.md, gap: spacing.sm },
  legendWrap: { position: "absolute", left: 0, right: 0, bottom: spacing.md, alignItems: "center" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...type.heading, fontSize: 17 },
  emptyText: { ...type.body, fontSize: 13.5, textAlign: "center", color: colors.textDim },
  emptyCta: { marginTop: spacing.md, alignSelf: "stretch" },

  skeleton: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  skeletonCell: {
    width: 44,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: "#E4EAED",
    opacity: 0.7,
  },

  statusPanel: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.md,
  },
  priorityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  priorityIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: `${palette.heatCoral}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  priorityBody: { flex: 1, gap: 1 },
  priorityKicker: { ...type.kicker, color: palette.heatCoral, fontSize: 10 },
  priorityName: { ...type.heading, fontSize: 14.5 },
  allClear: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.pulseGreen}12`,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  allClearText: { flex: 1, ...type.caption, fontSize: 12.5, color: "#0A8F60", fontWeight: "600" },
  quickRow: { flexDirection: "row", gap: spacing.sm, paddingRight: spacing.sm },
  quickLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  quickLabel: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.text },
});
