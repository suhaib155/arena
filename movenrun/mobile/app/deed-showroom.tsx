import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import { zoneStatus } from "@/lib/territory";
import { computePassport } from "@/lib/routePassport";
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
import { buildDistrictMastery } from "@/lib/districtMastery";
import {
  buildDeedShowroom,
  DEED_TIER_LABEL,
  type DeedAction,
  type DeedPreviewCard,
} from "@/lib/deedPreview";
import { tapFeedback } from "@/lib/haptics";

/**
 * Deed Preview Showroom — a local, read-only, educational look at what a
 * FUTURE Zone Deed layer might look like. Local preview only — not real
 * ownership, not minting, not claiming, not tradable, no market/rarity value,
 * no rewards, no earnings, no wallet, no chain. Read-only; gates nothing.
 */
export default function DeedShowroomScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const history = useGameStore((s) => s.history);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const streak = useGameStore((s) => s.streak);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);

  const showroom = useMemo(() => {
    const now = Date.now();
    const hasZones = zones.length > 0;
    const clubName = getClubById(selectedClubId)?.name ?? null;
    const passport = computePassport(routeTrustHistory, { zonesOwned: zones.length, timesDefended });
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
      hasZones,
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
      hasZones,
      city,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      weeklyActive: recap.hasActivity,
    });
    const events = buildEventZones({
      hasZones,
      city,
      rivals,
      sponsors,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      streak,
    });
    const crew = buildCrewMissions({
      clubName,
      hasZones,
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
    const districtMastery = buildDistrictMastery({
      hasZones,
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
    return buildDeedShowroom({ hasZones, zones, districtMastery, passport, now });
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

  const go = (action: DeedAction) => {
    tapFeedback();
    switch (action) {
      case "map":
        router.push("/territory/map");
        break;
      case "alerts":
        router.push("/territory/alerts");
        break;
      case "districtMastery":
        router.push("/district-mastery");
        break;
      case "districts":
        router.push("/city-districts");
        break;
      case "signal":
        router.push("/route/passport");
        break;
      default:
        router.push("/move");
    }
  };

  const top = showroom.topCard;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Deed Preview Showroom</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Deed Preview Showroom</Text>
            <Text style={styles.heroTitle}>A safe look at future Zone Deeds.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="wallet-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No wallet</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="hammer-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No minting</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.explainCard}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textDim} />
            <Text style={styles.explainText}>
              Zone Deeds are a future layer of MovenRun and are not live in this
              app build. This showroom is an educational preview only — it does
              not mint, claim, sell, trade, or verify ownership of anything.
            </Text>
          </View>
        </FadeSlideIn>

        {/* Summary */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Stat value={showroom.previewCount} label="previews" tint={palette.deedViolet} />
              <View style={styles.sumDivider} />
              <Stat value={showroom.readyCount} label="ready" tint="#0A8F60" />
              <View style={styles.sumDivider} />
              <Stat value={showroom.lockedCount} label="locked" tint={colors.textFaint} />
            </View>
            {top ? (
              <Text style={styles.summaryNext}>Top preview · {top.label}</Text>
            ) : (
              <Text style={styles.summaryNext}>{showroom.summaryLine}</Text>
            )}
          </View>
        </FadeSlideIn>

        {!showroom.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 3}>
            <View style={styles.emptyCard}>
              <Ionicons name="shapes-outline" size={28} color={palette.deedViolet} />
              <Text style={styles.emptyText}>Capture zones to unlock local deed previews.</Text>
              <Button label="Start Move" icon="play" onPress={() => go("move")} style={styles.emptyBtn} />
            </View>
          </FadeSlideIn>
        ) : (
          <>
            {/* Featured preview */}
            {top ? (
              <FadeSlideIn delay={STAGGER_MS * 3}>
                <FeaturedDeedCard card={top} onPress={() => go(top.action)} />
              </FadeSlideIn>
            ) : null}

            {/* Preview grid */}
            <FadeSlideIn delay={STAGGER_MS * 4}>
              <Text style={styles.sectionLabel}>All previews</Text>
              <View style={styles.list}>
                {showroom.cards.map((card) => (
                  <DeedPreviewRow key={card.id} card={card} onPress={() => go(card.action)} />
                ))}
              </View>
            </FadeSlideIn>
          </>
        )}

        {/* How future deeds may work */}
        <FadeSlideIn delay={STAGGER_MS * 5}>
          <View style={styles.howCard}>
            <Text style={styles.howTitle}>How future deeds may work</Text>
            <HowRow icon="finger-print-outline" text="A future zone identity tied to the territory you build here." />
            <HowRow icon="business-outline" text="A future layer on top of the fictional city districts you already explore." />
            <HowRow icon="people-outline" text="Possible future hooks into clubs, sponsor zones, and event zones." />
            <HowRow icon="git-network-outline" text="Possible future governance or utility roles — details are not decided yet." />
            <Text style={styles.howDisclaimer}>
              None of this is live. It does not promise ownership, rewards,
              payouts, market value, tradability, or eligibility of any kind.
            </Text>
          </View>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          Deed Preview Showroom is local and educational. It does not mint,
          claim, sell, trade, or verify ownership.
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

function HowRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.howRow}>
      <Ionicons name={icon} size={15} color={palette.deedViolet} />
      <Text style={styles.howText}>{text}</Text>
    </View>
  );
}

/** Abstract pseudo deed art: a tinted hex outline + a proof-like id string.
 *  No real NFT/token, no price, no rarity value, no marketplace frame. */
function DeedArt({ card, size = 64 }: { card: DeedPreviewCard; size?: number }) {
  const proofId = card.id.slice(0, 10).toUpperCase();
  return (
    <View style={styles.deedArtWrap}>
      <Hexagon size={size} color={`${card.accent}1F`} coreColor={card.ready ? card.accent : undefined} />
      <Text style={styles.deedArtId}>{proofId}</Text>
    </View>
  );
}

function FeaturedDeedCard({ card, onPress }: { card: DeedPreviewCard; onPress: () => void }) {
  return (
    <View style={styles.featuredCard}>
      <View style={styles.featuredTop}>
        <DeedArt card={card} size={72} />
        <View style={styles.featuredBody}>
          <Text style={styles.featuredKicker}>{card.typeLabel}</Text>
          <Text style={styles.featuredName} numberOfLines={1}>{card.label}</Text>
          <Text style={styles.featuredDistrict} numberOfLines={1}>{card.districtName}</Text>
        </View>
        <View style={[styles.tierChip, { backgroundColor: `${card.accent}1A` }]}>
          <Text style={[styles.tierChipText, { color: card.accent }]}>{DEED_TIER_LABEL[card.visualTier]}</Text>
        </View>
      </View>

      <View style={styles.scoreLine}>
        <Text style={styles.scoreValue}>{card.readinessScore}</Text>
        <Text style={styles.scoreUnit}>/ 100 readiness</Text>
      </View>

      <View style={styles.bars}>
        <Bar label="Control" value={card.controlContribution} color={palette.baseBlue} />
        <Bar label="Defense" value={card.defenseContribution} color={palette.pulseGreen} />
        <Bar label="Activity" value={card.activityContribution} color={palette.moveGold} />
        <Bar label="Signal" value={card.signalContribution} color={palette.deedViolet} />
      </View>

      <View style={styles.utilityList}>
        {card.utilityBullets.map((bullet) => (
          <View key={bullet} style={styles.utilityRow}>
            <Ionicons name="sparkles-outline" size={12} color={palette.deedViolet} />
            <Text style={styles.utilityText}>{bullet}</Text>
          </View>
        ))}
      </View>

      <Pressable hitSlop={8} style={styles.featuredCta} onPress={onPress}>
        <Text style={styles.featuredCtaText}>{card.ctaLabel}</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function DeedPreviewRow({ card, onPress }: { card: DeedPreviewCard; onPress: () => void }) {
  const locked = !card.ready;
  return (
    <View style={[styles.row, locked ? styles.rowLocked : null]}>
      <View style={styles.rowTop}>
        <DeedArt card={card} size={40} />
        <View style={styles.rowBody}>
          <Text style={[styles.rowName, locked ? styles.rowNameLocked : null]} numberOfLines={1}>
            {card.label}
          </Text>
          <Text style={styles.rowDistrict} numberOfLines={1}>{card.districtName}</Text>
        </View>
        <View style={[styles.tierChip, { backgroundColor: `${card.accent}1A` }]}>
          <Text style={[styles.tierChipText, { color: card.accent }]}>{DEED_TIER_LABEL[card.visualTier]}</Text>
        </View>
      </View>

      {locked ? (
        <Text style={styles.lockedNote}>{card.lockedExplanation}</Text>
      ) : (
        <View style={styles.scoreLine}>
          <Text style={styles.scoreValue}>{card.readinessScore}</Text>
          <Text style={styles.scoreUnit}>/ 100 readiness</Text>
        </View>
      )}
      <Text style={styles.rowRec}>{card.recommendation}</Text>
      <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
        <Text style={styles.ctaText}>{card.ctaLabel}</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.primary} />
      </Pressable>
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
  heroKicker: { ...type.kicker, color: palette.deedViolet },
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

  explainCard: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  explainText: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim, flex: 1 },

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
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyText: { ...type.heading, fontSize: 15, textAlign: "center", marginTop: spacing.xs },
  emptyBtn: { alignSelf: "stretch", marginTop: spacing.sm },

  featuredCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.float,
  },
  featuredTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  deedArtWrap: { alignItems: "center", justifyContent: "center" },
  deedArtId: { ...type.mono, fontSize: 8.5, color: colors.textFaint, marginTop: 2 },
  featuredBody: { flex: 1, gap: 1 },
  featuredKicker: { ...type.kicker, color: colors.textFaint, fontSize: 10.5 },
  featuredName: { ...type.heading, fontSize: 16 },
  featuredDistrict: { ...type.caption, fontSize: 12, color: colors.textFaint },
  tierChip: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: spacing.sm },
  tierChipText: { fontSize: 10.5, fontWeight: "800" },

  scoreLine: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  scoreValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  scoreUnit: { ...type.caption, fontSize: 11, color: colors.textFaint },

  bars: { gap: 5 },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { ...type.mono, fontSize: 9.5, color: colors.textFaint, width: 48 },
  barTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 6, borderRadius: radius.pill },
  barPct: { ...type.mono, fontSize: 10, color: colors.textDim, width: 20, textAlign: "right" },

  utilityList: { gap: 6 },
  utilityRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  utilityText: { ...type.caption, fontSize: 12, color: colors.textDim, flex: 1 },

  featuredCta: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", marginTop: 2 },
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
  rowBody: { flex: 1, gap: 1 },
  rowName: { ...type.heading, fontSize: 14.5 },
  rowNameLocked: { color: colors.textFaint },
  rowDistrict: { ...type.caption, fontSize: 11, color: colors.textFaint },
  lockedNote: { ...type.caption, fontSize: 12, color: colors.textFaint },
  rowRec: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },

  howCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  howTitle: { ...type.heading, fontSize: 15 },
  howRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  howText: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim, flex: 1 },
  howDisclaimer: {
    ...type.mono,
    fontSize: 10.5,
    color: colors.textFaint,
    lineHeight: 15,
    marginTop: spacing.xs,
  },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
