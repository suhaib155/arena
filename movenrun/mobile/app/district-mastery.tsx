import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import { zoneStatus } from "@/lib/territory";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildRivalGhosts } from "@/lib/rivalGhosts";
import { buildSeasonObjectives } from "@/lib/seasonObjectives";
import { buildCollections } from "@/lib/zoneCollections";
import { buildCityWarBoard } from "@/lib/cityWarBoard";
import { buildClubTerritory } from "@/lib/clubTerritory";
import { buildSponsorZones } from "@/lib/sponsorZones";
import { buildEventZones } from "@/lib/eventZones";
import { buildCrewMissions } from "@/lib/crewMissions";
import {
  buildDistrictMastery,
  MASTERY_LEVEL_LABEL,
  type DistrictMastery,
  type MasteryAction,
} from "@/lib/districtMastery";
import { tapFeedback } from "@/lib/haptics";

/**
 * District Mastery — a local, read-only view of long-term progress across the
 * fictional city districts. Local progress only — not ownership, deeds, market/
 * rarity value, rewards, rankings, real members, backend, chain, wallet, map
 * SDK, or raw GPS. Read-only; gates nothing.
 */
export default function DistrictMasteryScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const history = useGameStore((s) => s.history);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const streak = useGameStore((s) => s.streak);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);

  const overview = useMemo(() => {
    const now = Date.now();
    const clubName = getClubById(selectedClubId)?.name ?? null;
    const recap = buildWeeklyRecap({ history, routeTrustHistory, zones, streak, clubName });
    const city = buildCityDistricts(zones, now);
    const rivals = buildRivalGhosts(zones, now);
    const atRiskOrWorse = zones.filter((z) => zoneStatus(z, now).health !== "yours").length;
    const fortifyCount = zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0);
    const hasStrongTrust = routeTrustHistory.some((r) => r.trustLabel === "Strong");
    const collections = buildCollections({
      savedRoutes: routeTrustHistory.length,
      cleanRoutes: routeTrustHistory.filter((r) => r.riskFlags.length === 0).length,
      hasStrongTrust,
      zonesCaptured: zones.length,
      atRiskOrWorse,
      timesDefended,
      fortifyCount,
      hasClub: selectedClubId != null,
      viewedPassport: viewedRoutePassport,
      viewedProof: viewedRouteProof,
    });
    const objectives = buildSeasonObjectives({
      routesThisWeek: recap.routes,
      savedRoutes: routeTrustHistory.length,
      hasStrongTrust,
      zonesOwned: zones.length,
      atRiskOrWorse,
      timesDefended,
      fortifyCount,
      hasClub: selectedClubId != null,
      streak,
      viewedPassport: viewedRoutePassport,
      viewedProof: viewedRouteProof,
      weeklyActive: recap.hasActivity,
      collectionsUnlocked: collections.unlocked,
    });
    const war = buildCityWarBoard({ zones, city, rivals, objectives, recap, clubName, streak });
    const club = buildClubTerritory({
      clubName,
      hasZones: zones.length > 0,
      city,
      rivals,
      war,
      zoneStats: zones.map((z) => {
        const s = zoneStatus(z, now);
        return { id: z.id, name: z.name, control: s.control, defense: s.defense, healthy: s.health === "yours" };
      }),
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      streak,
      avgTrust: recap.averageTrustScore ?? 0,
    });
    const sponsors = buildSponsorZones({
      hasZones: zones.length > 0,
      city,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      weeklyActive: recap.hasActivity,
    });
    const events = buildEventZones({
      hasZones: zones.length > 0,
      city,
      rivals,
      sponsors,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      streak,
    });
    const crew = buildCrewMissions({
      clubName,
      hasZones: zones.length > 0,
      zonesOwned: zones.length,
      atRiskOrWorse,
      city,
      rivals,
      war,
      club,
      sponsors,
      events,
      objectives,
      savedRoutes: routeTrustHistory.length,
      hasStrongTrust,
      weekLabel: recap.rangeLabel,
    });
    return buildDistrictMastery({
      hasZones: zones.length > 0,
      city,
      war,
      clubPresence: club.territoryScore,
      momentum: recap.momentum,
      streak,
      objectivesProgress: objectives.progressPct,
      missionsComplete: crew.completePreview,
      missionsTotal: crew.total,
      avgTrust: recap.averageTrustScore ?? 0,
    });
  }, [
    zones,
    history,
    routeTrustHistory,
    streak,
    timesDefended,
    selectedClubId,
    viewedRoutePassport,
    viewedRouteProof,
  ]);

  const go = (action: MasteryAction) => {
    tapFeedback();
    switch (action) {
      case "districts":
        router.push("/city-districts");
        break;
      case "alerts":
        router.push("/territory/alerts");
        break;
      case "map":
        router.push("/territory/map");
        break;
      case "crew":
        router.push("/crew-missions");
        break;
      case "objectives":
        router.push("/season-objectives");
        break;
      case "signal":
        router.push("/route/review-history");
        break;
      case "rivals":
        router.push("/rivals");
        break;
      case "club":
        router.push("/club-territory");
        break;
      default:
        router.push("/move");
    }
  };

  const top = overview.topDistrict;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>District Mastery</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>District Mastery</Text>
            <Text style={styles.heroTitle}>Long-term local progress across fictional districts.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No ownership</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="gift-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No rewards</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Summary */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Stat value={overview.mastered} label="signature" tint={palette.deedViolet} />
              <View style={styles.sumDivider} />
              <Stat value={overview.fortified} label="fortified" tint="#0A8F60" />
              <View style={styles.sumDivider} />
              <Stat value={overview.rising} label="rising" tint="#B07908" />
              <View style={styles.sumDivider} />
              <Stat value={overview.locked} label="locked" tint={colors.textFaint} />
            </View>
            {overview.nextToImprove ? (
              <Text style={styles.summaryNext}>
                Next to improve · {overview.nextToImprove.name}
              </Text>
            ) : null}
          </View>
        </FadeSlideIn>

        {!overview.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="ribbon-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to begin district mastery.</Text>
              <Button label="Start Move" icon="play" onPress={() => go("move")} style={styles.emptyBtn} />
            </View>
          </FadeSlideIn>
        ) : (
          <>
            {/* Featured top district */}
            {top ? (
              <FadeSlideIn delay={STAGGER_MS * 2}>
                <View style={styles.featuredCard}>
                  <View style={styles.featuredTop}>
                    <View style={[styles.featuredIcon, { backgroundColor: `${top.accent}1A` }]}>
                      <Ionicons name="star" size={18} color={top.accent} />
                    </View>
                    <View style={styles.featuredBody}>
                      <Text style={styles.featuredKicker}>Top district</Text>
                      <Text style={styles.featuredName} numberOfLines={1}>{top.name}</Text>
                    </View>
                    <View style={[styles.levelChip, { backgroundColor: `${top.accent}1A` }]}>
                      <Text style={[styles.levelChipText, { color: top.accent }]}>
                        {MASTERY_LEVEL_LABEL[top.level]}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.featuredNote}>{top.recommendation}</Text>
                  <Pressable hitSlop={8} style={styles.featuredCta} onPress={() => go(top.action)}>
                    <Text style={styles.featuredCtaText}>{top.ctaLabel}</Text>
                    <Ionicons name="chevron-forward" size={13} color={colors.primary} />
                  </Pressable>
                </View>
              </FadeSlideIn>
            ) : null}

            {/* District board */}
            <FadeSlideIn delay={STAGGER_MS * 3}>
              <Text style={styles.sectionLabel}>District board</Text>
              <View style={styles.list}>
                {overview.districts.map((d) => (
                  <MasteryRow key={d.id} district={d} onPress={() => go(d.action)} />
                ))}
              </View>
            </FadeSlideIn>
          </>
        )}

        {/* Deed Preview Showroom — local, educational preview of future Zone Deeds */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.deedCta}
            onPress={() => {
              tapFeedback();
              router.push("/deed-showroom");
            }}
          >
            <View style={styles.deedCtaIcon}>
              <Ionicons name="shapes-outline" size={18} color={palette.deedViolet} />
            </View>
            <View style={styles.deedCtaBody}>
              <Text style={styles.deedCtaName}>Preview future deeds</Text>
              <Text style={styles.deedCtaNote}>Local Deed Preview Showroom · no wallet, no minting</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          District Mastery is a local preview. It does not represent ownership,
          rewards, rankings, or on-chain activity.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, tint }: { value: number; label: string; tint: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barPct}>{value}</Text>
    </View>
  );
}

function MasteryRow({ district, onPress }: { district: DistrictMastery; onPress: () => void }) {
  const locked = district.level === "locked";
  return (
    <View style={[styles.row, locked ? styles.rowLocked : null]}>
      <View style={styles.rowTop}>
        <Text style={[styles.rowName, locked ? styles.rowNameLocked : null]} numberOfLines={1}>
          {district.name}
        </Text>
        <View style={[styles.levelChip, { backgroundColor: `${district.accent}1A` }]}>
          <Text style={[styles.levelChipText, { color: district.accent }]}>
            {MASTERY_LEVEL_LABEL[district.level]}
          </Text>
        </View>
      </View>

      {locked ? (
        <Text style={styles.lockedNote}>Capture a zone here to discover it.</Text>
      ) : (
        <>
          <View style={styles.scoreLine}>
            <Text style={styles.scoreValue}>{district.masteryScore}</Text>
            <Text style={styles.scoreUnit}>/ 100 mastery</Text>
            {district.pressurePenalty > 0 ? (
              <Text style={styles.penalty}>−{district.pressurePenalty} pressure</Text>
            ) : null}
            {district.clubBonus > 0 ? (
              <Text style={styles.bonus}>+{district.clubBonus} club</Text>
            ) : null}
          </View>
          <View style={styles.nextTrack}>
            <View
              style={[
                styles.nextFill,
                { width: `${district.nextLevelProgress}%`, backgroundColor: district.accent },
              ]}
            />
          </View>
          <View style={styles.bars}>
            <Bar label="Control" value={district.controlContribution} color={palette.baseBlue} />
            <Bar label="Defense" value={district.defenseContribution} color={palette.pulseGreen} />
            <Bar label="Activity" value={district.activityContribution} color={palette.moveGold} />
            <Bar label="Signal" value={district.signalContribution} color={palette.deedViolet} />
          </View>
          <Text style={styles.rowRec}>{district.recommendation}</Text>
          <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
            <Text style={styles.ctaText}>{district.ctaLabel}</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.primary} />
          </Pressable>
        </>
      )}
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

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  sumDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },
  summaryNext: { ...type.caption, fontSize: 12.5, color: colors.textDim, textAlign: "center" },

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

  featuredCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  featuredTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  featuredIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredBody: { flex: 1, gap: 1 },
  featuredKicker: { ...type.kicker, color: colors.textFaint, fontSize: 10.5 },
  featuredName: { ...type.heading, fontSize: 16 },
  featuredNote: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  featuredCta: { flexDirection: "row", alignItems: "center", gap: 3 },
  featuredCtaText: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },

  sectionLabel: { ...type.kicker, color: colors.textFaint, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  rowLocked: { backgroundColor: colors.surfaceAlt, shadowOpacity: 0.04 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowName: { ...type.heading, fontSize: 14.5, flex: 1 },
  rowNameLocked: { color: colors.textFaint },
  levelChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  levelChipText: { fontSize: 10, fontWeight: "800" },
  lockedNote: { ...type.caption, fontSize: 12, color: colors.textFaint },
  scoreLine: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" },
  scoreValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  scoreUnit: { ...type.caption, fontSize: 11, color: colors.textFaint },
  penalty: { ...type.caption, fontSize: 11, fontWeight: "700", color: "#C2492E" },
  bonus: { ...type.caption, fontSize: 11, fontWeight: "700", color: "#0A8F60" },
  nextTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  nextFill: { height: 6, borderRadius: radius.pill },
  bars: { gap: 3, marginTop: 2 },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { ...type.mono, fontSize: 9, color: colors.textFaint, width: 48 },
  barTrack: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 5, borderRadius: radius.pill },
  barPct: { ...type.mono, fontSize: 9.5, color: colors.textDim, width: 20, textAlign: "right" },
  rowRec: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },

  deedCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  deedCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  deedCtaBody: { flex: 1, gap: 2 },
  deedCtaName: { ...type.heading, fontSize: 15 },
  deedCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
});
