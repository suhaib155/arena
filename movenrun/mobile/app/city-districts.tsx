import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import {
  buildCityDistricts,
  DISTRICT_STATUS_LABEL,
  type CityDistrict,
  type DistrictAction,
} from "@/lib/cityDistricts";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * City Districts — a local, read-only preview that groups captured zones into
 * larger fictional districts. Not a real map: districts come from hashed safe
 * zone ids, never geography, coordinates, or location names. No backend,
 * network, chain, wallet, map SDK, or raw GPS. Read-only; gates nothing.
 */
export default function CityDistrictsScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const now = Date.now();
  const overview = useMemo(() => buildCityDistricts(zones, now), [zones, now]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = overview.districts.find((d) => d.id === selectedId) ?? null;

  const go = (action: DistrictAction) => {
    tapFeedback();
    if (action === "map") router.push("/territory/map");
    else if (action === "alerts") router.push("/territory/alerts");
    else router.push("/move");
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>City Districts</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{overview.cityLabel}</Text>
            <Text style={styles.heroTitle}>A local preview of your growing territory city.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="business-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="map-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>Not a real map</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}1A` }]}>
                <Ionicons name="location-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No raw GPS</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* City progress */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.progressCard}>
            <View style={styles.progressTopRow}>
              <View>
                <Text style={styles.progressCount}>
                  {overview.controlledDistricts}
                  <Text style={styles.progressTotal}> / {overview.activeDistricts}</Text>
                </Text>
                <Text style={styles.progressSub}>districts controlled</Text>
              </View>
              <View style={styles.pctWrap}>
                <Text style={styles.pctValue}>{overview.cityProgressPct}%</Text>
              </View>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${overview.cityProgressPct}%`,
                    backgroundColor:
                      overview.cityProgressPct === 100 ? palette.pulseGreen : palette.moveGold,
                  },
                ]}
              />
            </View>
            <View style={styles.nextRow}>
              <Ionicons name="trail-sign-outline" size={15} color={colors.primary} />
              <Text style={styles.nextText}>Next · {overview.nextAction.label}</Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Empty / new-user nudge */}
        {!overview.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="business-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to reveal your city preview.</Text>
              <Button
                label="Start Move"
                icon="play"
                onPress={() => {
                  tapFeedback();
                  router.push("/move");
                }}
                style={styles.emptyBtn}
              />
            </View>
          </FadeSlideIn>
        ) : null}

        {/* District board */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <Text style={styles.sectionLabel}>District board</Text>
          <View style={styles.board}>
            {overview.districts.map((d) => (
              <DistrictCard
                key={d.id}
                district={d}
                selected={d.id === selectedId}
                onPress={() => {
                  tapFeedback();
                  setSelectedId(d.id === selectedId ? null : d.id);
                }}
              />
            ))}
          </View>
        </FadeSlideIn>

        {/* Selected district preview */}
        {selected ? (
          <FadeSlideIn delay={STAGGER_MS / 2}>
            <View style={styles.selectedCard}>
              <View style={styles.selectedHeader}>
                <View style={[styles.selectedIcon, { backgroundColor: `${selected.accent}1A` }]}>
                  <Ionicons name={selected.icon as IoniconName} size={18} color={selected.accent} />
                </View>
                <View style={styles.selectedTitleBox}>
                  <Text style={styles.selectedName}>{selected.name}</Text>
                  <Text style={[styles.selectedStatus, { color: selected.accent }]}>
                    {DISTRICT_STATUS_LABEL[selected.status]}
                  </Text>
                </View>
              </View>
              {selected.zoneCount > 0 ? (
                <Text style={styles.selectedMeta}>
                  {selected.zoneCount} zone{selected.zoneCount === 1 ? "" : "s"} ·{" "}
                  {selected.healthy} healthy
                  {selected.atRisk > 0 ? ` · ${selected.atRisk} at risk` : ""}
                  {selected.dormant > 0 ? ` · ${selected.dormant} dormant` : ""} · control{" "}
                  {selected.controlPct}%
                </Text>
              ) : (
                <Text style={styles.selectedMeta}>
                  Locked preview · capture a zone to reveal this district.
                </Text>
              )}
              {selected.zoneCount > 0 ? (
                <Button
                  label={selected.status === "contested" || selected.status === "dormant" ? "View Alerts" : "View Territory Map"}
                  variant="secondary"
                  onPress={() =>
                    go(selected.status === "contested" || selected.status === "dormant" ? "alerts" : "map")
                  }
                  style={styles.selectedCta}
                />
              ) : (
                <Button
                  label="Start Move"
                  variant="secondary"
                  onPress={() => go("move")}
                  style={styles.selectedCta}
                />
              )}
            </View>
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footerNote}>
          Districts are local previews generated from safe zone ids. They are not
          real neighborhoods, maps, rewards, or on-chain ownership.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function DistrictCard({
  district,
  selected,
  onPress,
}: {
  district: CityDistrict;
  selected: boolean;
  onPress: () => void;
}) {
  const locked = district.status === "locked";
  return (
    <ScalePress
      to={0.96}
      style={[
        styles.card,
        ...(locked ? [styles.cardLocked] : []),
        ...(selected ? [styles.cardSelected] : []),
      ]}
      onPress={onPress}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.cardIcon, { backgroundColor: `${district.accent}1A` }]}>
          <Ionicons name={district.icon as IoniconName} size={15} color={district.accent} />
        </View>
        <View style={[styles.cardStatusChip, { backgroundColor: `${district.accent}1A` }]}>
          <Text style={[styles.cardStatusText, { color: district.accent }]}>
            {DISTRICT_STATUS_LABEL[district.status]}
          </Text>
        </View>
      </View>
      <Text style={[styles.cardName, locked ? styles.cardNameLocked : null]} numberOfLines={1}>
        {district.name}
      </Text>
      {locked ? (
        <Text style={styles.cardLockedNote}>Future district</Text>
      ) : (
        <>
          <Text style={styles.cardCounts}>
            {district.zoneCount} zone{district.zoneCount === 1 ? "" : "s"} · {district.healthy} healthy
            {district.atRisk > 0 ? ` · ${district.atRisk} at risk` : ""}
          </Text>
          <View style={styles.miniBars}>
            <MiniBar label="CTRL" pct={district.controlPct} color={palette.baseBlue} />
            <MiniBar label="DEF" pct={district.defensePct} color={palette.pulseGreen} />
          </View>
        </>
      )}
    </ScalePress>
  );
}

function MiniBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <View style={styles.miniBarRow}>
      <Text style={styles.miniBarLabel}>{label}</Text>
      <View style={styles.miniTrack}>
        <View style={[styles.miniFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }]} />
      </View>
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

  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  progressTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressCount: { ...type.display, fontSize: 30, fontVariant: ["tabular-nums"] },
  progressTotal: { ...type.title, fontSize: 18, color: colors.textFaint },
  progressSub: { ...type.caption, fontSize: 12 },
  pctWrap: {
    backgroundColor: `${palette.moveGold}1A`,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  pctValue: { ...type.heading, fontSize: 15, color: "#B07908" },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill },
  nextRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nextText: { ...type.caption, fontSize: 12.5, color: colors.textDim, flex: 1 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyText: { ...type.heading, fontSize: 15, textAlign: "center", marginTop: spacing.xs },
  emptyBtn: { alignSelf: "stretch", marginTop: spacing.sm },

  sectionLabel: { ...type.kicker, color: colors.textFaint, marginBottom: spacing.sm },
  board: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  cardLocked: { backgroundColor: colors.surfaceAlt, ...shadows.card, shadowOpacity: 0.04 },
  cardSelected: { borderWidth: 2, borderColor: palette.baseBlue },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  cardStatusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  cardStatusText: { fontSize: 10, fontWeight: "800" },
  cardName: { ...type.heading, fontSize: 14.5 },
  cardNameLocked: { color: colors.textFaint },
  cardLockedNote: { ...type.caption, fontSize: 11, color: colors.textFaint },
  cardCounts: { ...type.caption, fontSize: 11, color: colors.textDim },
  miniBars: { gap: 3, marginTop: 2 },
  miniBarRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  miniBarLabel: { ...type.mono, fontSize: 8.5, color: colors.textFaint, width: 26 },
  miniTrack: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  miniFill: { height: 5, borderRadius: radius.pill },

  selectedCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  selectedHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  selectedIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedTitleBox: { flex: 1, gap: 2 },
  selectedName: { ...type.heading, fontSize: 16 },
  selectedStatus: { ...type.caption, fontSize: 12, fontWeight: "800" },
  selectedMeta: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
  selectedCta: { alignSelf: "flex-start" },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
