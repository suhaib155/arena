import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { healthVisual } from "@/components/ZoneCard";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { HEALTH_LABEL } from "@/lib/territory";
import { buildTerritoryOverview, MAP_COLUMNS, type MapCell } from "@/lib/territoryMap";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildRivalGhosts } from "@/lib/rivalGhosts";
import { tapFeedback } from "@/lib/haptics";

function lastDefendedText(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "defended today";
  if (days === 1) return "defended yesterday";
  return `defended ${days}d ago`;
}

const LEGEND: { label: string; core: string }[] = [
  { label: "Healthy", core: palette.pulseGreen },
  { label: "At risk", core: palette.heatCoral },
  { label: "Dormant", core: palette.silverTrail },
  { label: "Deed preview", core: palette.deedViolet },
];

/**
 * Territory Map — a local territory *board* (not a real map). Renders captured
 * zones as a deterministic pseudo-hex grid from safe zone state only: no raw
 * GPS, coordinates, route paths, or location names. Read-only; gates nothing.
 */
export default function TerritoryMapScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const now = Date.now();
  const overview = useMemo(() => buildTerritoryOverview(zones, now), [zones, now]);
  const city = useMemo(() => buildCityDistricts(zones, now), [zones, now]);
  const rivals = useMemo(() => buildRivalGhosts(zones, now), [zones, now]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = overview.cells.find((c) => c.zone.id === selectedId) ?? null;
  const rows = useMemo(() => {
    const out: MapCell[][] = [];
    for (const cell of overview.cells) {
      (out[cell.row] ??= [])[cell.col] = cell;
    }
    return out.map((r) => r.filter(Boolean));
  }, [overview.cells]);

  const needsDefense = overview.atRisk + overview.contestedPreview + overview.dormant;

  const viewZone = (id: string) => {
    tapFeedback();
    router.push({ pathname: "/zone/[id]", params: { id } });
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Territory</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Territory Map</Text>
            <Text style={styles.heroTitle}>Your local captured zones at a glance.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="grid-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}1A` }]}>
                <Ionicons name="location-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No raw GPS</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Map board */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.board}>
            {overview.total === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="map-outline" size={30} color={colors.textFaint} />
                <Text style={styles.emptyText}>
                  No territory yet. Start Move to capture your first zone.
                </Text>
                <Button label="Start Move" icon="walk" onPress={() => { tapFeedback(); router.push("/move"); }} />
              </View>
            ) : (
              rows.map((row, ri) => (
                <View key={ri} style={[styles.boardRow, ri % 2 === 1 ? styles.boardRowOffset : null]}>
                  {row.map((cell) => {
                    const hv = healthVisual(cell.status.health);
                    const sel = cell.zone.id === selectedId;
                    return (
                      <ScalePress
                        key={cell.zone.id}
                        to={0.92}
                        style={sel ? [styles.cell, styles.cellSelected] : styles.cell}
                        onPress={() => {
                          tapFeedback();
                          setSelectedId(sel ? null : cell.zone.id);
                        }}
                      >
                        <Hexagon
                          size={40}
                          color={cell.zone.isDeedPreview ? "#E1DAFF" : hv.fill}
                          coreColor={cell.zone.isDeedPreview ? palette.deedViolet : hv.core}
                        />
                      </ScalePress>
                    );
                  })}
                </View>
              ))
            )}
          </View>
        </FadeSlideIn>

        {overview.total > 0 ? (
          <>
            {/* Stats strip */}
            <FadeSlideIn delay={STAGGER_MS * 2}>
              <View style={styles.strip}>
                <Stat value={overview.total} label="zones" />
                <View style={styles.stripDivider} />
                <Stat value={overview.healthy} label="healthy" tint="#0A8F60" />
                <View style={styles.stripDivider} />
                <Stat value={needsDefense} label="need defense" tint={needsDefense > 0 ? "#C2492E" : undefined} />
                <View style={styles.stripDivider} />
                <Stat value={overview.territoryScore} label="score" tint={palette.baseBlue} />
              </View>
            </FadeSlideIn>

            {/* Selected zone preview */}
            {selected ? (
              <FadeSlideIn delay={STAGGER_MS / 2}>
                <View style={styles.selectedCard}>
                  <Hexagon
                    size={36}
                    color={selected.zone.isDeedPreview ? "#E1DAFF" : healthVisual(selected.status.health).fill}
                    coreColor={selected.zone.isDeedPreview ? palette.deedViolet : healthVisual(selected.status.health).core}
                  />
                  <View style={styles.selectedBody}>
                    <Text style={styles.selectedName} numberOfLines={1}>{selected.zone.name}</Text>
                    <Text style={[styles.selectedHealth, { color: healthVisual(selected.status.health).text }]}>
                      {HEALTH_LABEL[selected.status.health]} · {lastDefendedText(selected.zone.lastDefendedAt, now)}
                    </Text>
                    <Text style={styles.selectedMeta}>
                      Control {selected.status.control}% · Defense {selected.status.defense}%
                    </Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => viewZone(selected.zone.id)}>
                    <Text style={styles.viewLink}>View</Text>
                  </Pressable>
                </View>
              </FadeSlideIn>
            ) : null}

            {/* Priority card */}
            {overview.priority ? (
              <FadeSlideIn delay={STAGGER_MS * 3}>
                <View style={styles.priorityCard}>
                  <View style={styles.priorityIcon}>
                    <Ionicons name="shield-outline" size={18} color={palette.heatCoral} />
                  </View>
                  <View style={styles.priorityBody}>
                    <Text style={styles.priorityKicker}>Defend next</Text>
                    <Text style={styles.priorityName} numberOfLines={1}>{overview.priority.name}</Text>
                  </View>
                  <Button
                    label="View Zone"
                    variant="secondary"
                    onPress={() => viewZone(overview.priority!.id)}
                  />
                </View>
              </FadeSlideIn>
            ) : (
              <FadeSlideIn delay={STAGGER_MS * 3}>
                <View style={styles.allClear}>
                  <Ionicons name="checkmark-circle" size={16} color={palette.pulseGreen} />
                  <Text style={styles.allClearText}>All zones healthy — strengthen your territory by moving.</Text>
                </View>
              </FadeSlideIn>
            )}

            {/* Legend */}
            <FadeSlideIn delay={STAGGER_MS * 4}>
              <View style={styles.legend}>
                {LEGEND.map((l) => (
                  <View key={l.label} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: l.core }]} />
                    <Text style={styles.legendText}>{l.label}</Text>
                  </View>
                ))}
              </View>
            </FadeSlideIn>
          </>
        ) : null}

        {overview.total > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 5}>
            <ScalePress
              to={0.98}
              style={styles.collectionsCta}
              onPress={() => {
                tapFeedback();
                router.push("/territory/alerts");
              }}
            >
              <View style={[styles.collectionsIcon, { backgroundColor: `${palette.heatCoral}14` }]}>
                <Ionicons name="notifications-outline" size={18} color={palette.heatCoral} />
              </View>
              <View style={styles.collectionsBody}>
                <Text style={styles.collectionsName}>Territory Alerts</Text>
                <Text style={styles.collectionsNote}>Local reminders for what needs attention</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        <FadeSlideIn delay={STAGGER_MS * 6}>
          <ScalePress
            to={0.98}
            style={styles.collectionsCta}
            onPress={() => {
              tapFeedback();
              router.push("/city-districts");
            }}
          >
            <View style={[styles.collectionsIcon, { backgroundColor: `${palette.baseBlue}14` }]}>
              <Ionicons name="business-outline" size={18} color={palette.baseBlue} />
            </View>
            <View style={styles.collectionsBody}>
              <Text style={styles.collectionsName}>City Districts</Text>
              <Text style={styles.collectionsNote}>
                {city.hasZones
                  ? `${city.controlledDistricts}/${city.activeDistricts} controlled · local city preview`
                  : "Group your zones into a local city preview"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {overview.total > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 7}>
            <ScalePress
              to={0.98}
              style={styles.collectionsCta}
              onPress={() => {
                tapFeedback();
                router.push("/rivals");
              }}
            >
              <View style={[styles.collectionsIcon, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="color-wand-outline" size={18} color={palette.deedViolet} />
              </View>
              <View style={styles.collectionsBody}>
                <Text style={styles.collectionsName}>Rival Ghosts</Text>
                <Text style={styles.collectionsNote}>
                  {rivals.hasPressure
                    ? `${rivals.highPressure > 0 ? `${rivals.highPressure} high-pressure · ` : ""}fictional rivals circling`
                    : "Fictional pressure preview · no real users"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        <FadeSlideIn delay={STAGGER_MS * 8}>
          <ScalePress
            to={0.98}
            style={styles.collectionsCta}
            onPress={() => {
              tapFeedback();
              router.push("/collections");
            }}
          >
            <View style={styles.collectionsIcon}>
              <Ionicons name="ribbon-outline" size={18} color={palette.deedViolet} />
            </View>
            <View style={styles.collectionsBody}>
              <Text style={styles.collectionsName}>Zone Collections</Text>
              <Text style={styles.collectionsNote}>Local badges for your territory journey</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          This is a local territory board, not a real map. Raw GPS and paths are
          not stored.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, tint }: { value: number; label: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
    paddingBottom: spacing.xs,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.heading, fontSize: 16 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 48, gap: spacing.lg },

  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  heroKicker: { ...type.kicker, color: colors.primary },
  heroTitle: { ...type.display, fontSize: 23, lineHeight: 29 },
  badgeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },

  board: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minHeight: 160,
    justifyContent: "center",
    ...shadows.card,
  },
  boardRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  boardRowOffset: { marginLeft: 24 },
  cell: { borderRadius: radius.pill, padding: 3 },
  cellSelected: { backgroundColor: `${palette.baseBlue}1F` },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  emptyText: { ...type.body, fontSize: 13.5, textAlign: "center", color: colors.textDim },

  strip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  stripDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },

  selectedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  selectedBody: { flex: 1, gap: 2 },
  selectedName: { ...type.heading, fontSize: 15 },
  selectedHealth: { ...type.caption, fontSize: 12, fontWeight: "700" },
  selectedMeta: { ...type.mono, fontSize: 11, color: colors.textFaint },
  viewLink: { ...type.caption, fontSize: 13, fontWeight: "700", color: colors.primary },

  priorityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  priorityIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.heatCoral}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  priorityBody: { flex: 1, gap: 1 },
  priorityKicker: { ...type.kicker, color: palette.heatCoral, fontSize: 10.5 },
  priorityName: { ...type.heading, fontSize: 15 },
  allClear: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.pulseGreen}12`,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  allClearText: { flex: 1, ...type.caption, fontSize: 12.5, color: "#0A8F60", fontWeight: "600" },

  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { ...type.caption, fontSize: 11, color: colors.textDim },

  collectionsCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  collectionsIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionsBody: { flex: 1, gap: 1 },
  collectionsName: { ...type.heading, fontSize: 14.5 },
  collectionsNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
