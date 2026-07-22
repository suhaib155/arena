import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { ProgressHero } from "@/components/ProgressHero";
import { StatusPill } from "@/components/StatusPill";
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
import { buildDeedShowroom, DEED_TIER_LABEL, type DeedAction, type DeedPreviewCard } from "@/lib/deedPreview";
import { buildDeedsView, deedStatusLabel } from "@/lib/deedsView";
import { tapFeedback } from "@/lib/haptics";

/**
 * Deed Preview Showroom — a local, read-only, educational look at what a FUTURE
 * Zone Deed layer might look like. Local preview only — not real ownership, not
 * minting, not claiming, not tradable, no market/rarity value, no rewards, no
 * wallet, no chain. Read-only; gates nothing. (buildDeedShowroom is unchanged.)
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
  const [lockedExpanded, setLockedExpanded] = useState(false);

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
  }, [zones, history, routeTrustHistory, streak, timesDefended, selectedClubId, viewedRoutePassport, viewedRouteProof]);

  const view = useMemo(() => buildDeedsView(showroom), [showroom]);

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

  const otherReady = view.featured
    ? view.readyCards.filter((c) => c.id !== view.featured!.id)
    : view.readyCards;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Deeds</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Deed Preview Showroom</Text>
            <Text style={styles.heroTitle}>A safe look at future Zone Deeds.</Text>
            <View style={styles.pillRow}>
              <StatusPill icon="eye-outline" label="Local preview" tone="primary" />
              <StatusPill icon="wallet-outline" label="No wallet" tone="neutral" />
              <StatusPill icon="hammer-outline" label="No minting" tone="neutral" />
              <StatusPill icon="cube-outline" label="Not on-chain" tone="neutral" />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.explainCard}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textDim} />
            <Text style={styles.explainText}>
              Zone Deeds are a future layer of MovenRun and are not live in this app
              build. This showroom is an educational preview only — it does not mint,
              claim, sell, trade, or verify ownership of anything.
            </Text>
          </View>
        </FadeSlideIn>

        {!view.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="shapes-outline" size={26} color={palette.deedViolet} />
              </View>
              <Text style={styles.emptyTitle}>No deed previews yet</Text>
              <Text style={styles.emptyText}>
                Capture a zone and your first local deed preview appears here —
                earned on this device, never minted or owned.
              </Text>
              <Button label="Start Move" icon="play" onPress={() => go("move")} style={styles.emptyBtn} />
            </View>
          </FadeSlideIn>
        ) : (
          <>
            <FadeSlideIn delay={STAGGER_MS * 2}>
              <ProgressHero
                value={view.ready}
                outOf={`/ ${view.total}`}
                label="deed previews ready"
                percent={view.readyPct}
                statement={view.statement}
                accent={palette.deedViolet}
              />
            </FadeSlideIn>

            {view.featured ? (
              <FadeSlideIn delay={STAGGER_MS * 3}>
                <FeaturedDeedCard card={view.featured} onPress={() => go(view.featured!.action)} />
              </FadeSlideIn>
            ) : null}

            {otherReady.length > 0 ? (
              <FadeSlideIn delay={STAGGER_MS * 4}>
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>More previews earned</Text>
                  <View style={styles.rowList}>
                    {otherReady.map((c) => (
                      <DeedRow key={c.id} card={c} onPress={() => go(c.action)} />
                    ))}
                  </View>
                </View>
              </FadeSlideIn>
            ) : null}

            {view.lockedCards.length > 0 ? (
              <FadeSlideIn delay={STAGGER_MS * 5}>
                <View style={styles.lockedWrap}>
                  <Pressable
                    onPress={() => {
                      tapFeedback();
                      setLockedExpanded((v) => !v);
                    }}
                    style={styles.lockedHeader}
                    accessibilityRole="button"
                    accessibilityLabel={`${view.lockedCards.length} locked previews`}
                    accessibilityHint={lockedExpanded ? "Collapse locked" : "Expand locked"}
                  >
                    <View style={styles.lockedIcon}>
                      <Ionicons name="lock-closed" size={14} color={colors.textDim} />
                    </View>
                    <Text style={styles.lockedTitle}>{view.lockedCards.length} locked previews</Text>
                    <Ionicons name={lockedExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textFaint} />
                  </Pressable>
                  {lockedExpanded ? (
                    <View style={styles.rowList}>
                      {view.lockedCards.map((c) => (
                        <View key={c.id} style={styles.lockedRow}>
                          <Ionicons name="lock-closed-outline" size={15} color={colors.textFaint} />
                          <View style={styles.lockedRowBody}>
                            <Text style={styles.lockedRowTitle} numberOfLines={1}>
                              {c.typeLabel}
                            </Text>
                            <Text style={styles.lockedRowReq} numberOfLines={2}>
                              {c.lockedExplanation}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </FadeSlideIn>
            ) : null}
          </>
        )}

        <FadeSlideIn delay={STAGGER_MS * 6}>
          <View style={styles.howCard}>
            <Text style={styles.howTitle}>How future deeds may work</Text>
            <HowRow icon="finger-print-outline" text="A future zone identity tied to the territory you build here." />
            <HowRow icon="business-outline" text="A future layer on top of the fictional city districts you already explore." />
            <HowRow icon="git-network-outline" text="Possible future governance or utility roles — details are not decided yet." />
            <Text style={styles.howDisclaimer}>
              None of this is live. It does not promise ownership, rewards, payouts,
              market value, tradability, or eligibility of any kind. Previews are
              earned on this device and are not on-chain.
            </Text>
          </View>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          Deed Preview Showroom is local and educational. Ownership is not
          finalized — it does not mint, claim, sell, trade, or verify ownership.
        </Text>
      </ScrollView>
    </Screen>
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

/** Abstract pseudo deed art: a tinted hex + a short preview-id string. No real
 *  NFT/token, no price, no rarity value, no marketplace frame. */
function DeedArt({ card, size = 64 }: { card: DeedPreviewCard; size?: number }) {
  const previewId = card.id.slice(0, 10).toUpperCase();
  return (
    <View style={styles.deedArtWrap}>
      <Hexagon size={size} color={`${card.accent}1F`} coreColor={card.ready ? card.accent : undefined} />
      <Text style={styles.deedArtId}>{previewId}</Text>
    </View>
  );
}

function FeaturedDeedCard({ card, onPress }: { card: DeedPreviewCard; onPress: () => void }) {
  return (
    <View style={styles.featuredCard}>
      <View style={styles.featuredTop}>
        <DeedArt card={card} size={64} />
        <View style={styles.featuredBody}>
          <Text style={styles.featuredKicker}>{card.typeLabel}</Text>
          <Text style={styles.featuredName} numberOfLines={1}>
            {card.label}
          </Text>
          <Text style={styles.featuredDistrict} numberOfLines={1}>
            {card.districtName}
          </Text>
        </View>
        <View style={[styles.tierChip, { backgroundColor: `${card.accent}1A` }]}>
          <Text style={[styles.tierChipText, { color: card.accent }]}>{DEED_TIER_LABEL[card.visualTier]}</Text>
        </View>
      </View>

      <View style={styles.featuredStatus}>
        <StatusPill icon="phone-portrait-outline" label={deedStatusLabel(card)} tone="success" />
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

      <Text style={styles.featuredNote}>Ownership not finalized · not on-chain · earned on this device.</Text>

      <Pressable
        hitSlop={8}
        style={styles.featuredCta}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={card.ctaLabel}
      >
        <Text style={styles.featuredCtaText}>{card.ctaLabel}</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function DeedRow({ card, onPress }: { card: DeedPreviewCard; onPress: () => void }) {
  return (
    <Pressable
      style={styles.deedRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.typeLabel}, ${card.label}, ${deedStatusLabel(card)}`}
    >
      <DeedArt card={card} size={36} />
      <View style={styles.deedRowBody}>
        <Text style={styles.deedRowName} numberOfLines={1}>
          {card.typeLabel}
        </Text>
        <Text style={styles.deedRowSub} numberOfLines={1}>
          {card.label} · {DEED_TIER_LABEL[card.visualTier]}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
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
  heroTitle: { ...type.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6 },
  pillRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },

  explainCard: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  explainText: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim, flex: 1 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...type.heading, fontSize: 16.5, textAlign: "center" },
  emptyText: { ...type.body, fontSize: 13.5, lineHeight: 19, textAlign: "center" },
  emptyBtn: { alignSelf: "stretch", marginTop: spacing.sm },

  featuredCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: `${palette.deedViolet}22`,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
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
  featuredStatus: { flexDirection: "row" },

  scoreLine: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  scoreValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  scoreUnit: { ...type.caption, fontSize: 11, color: colors.textFaint },

  bars: { gap: 5 },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { ...type.mono, fontSize: 9.5, color: colors.textFaint, width: 48 },
  barTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 6, borderRadius: radius.pill },
  barPct: { ...type.mono, fontSize: 10, color: colors.textDim, width: 20, textAlign: "right" },

  featuredNote: { ...type.mono, fontSize: 10.5, color: colors.textFaint, lineHeight: 15 },
  featuredCta: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start" },
  featuredCtaText: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },

  section: { gap: spacing.sm },
  sectionLabel: { ...type.kicker, color: colors.textFaint },
  rowList: { gap: spacing.sm },
  deedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 56,
    ...shadows.card,
  },
  deedRowBody: { flex: 1, gap: 1 },
  deedRowName: { ...type.heading, fontSize: 14 },
  deedRowSub: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  lockedWrap: { gap: spacing.sm },
  lockedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  lockedIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedTitle: { ...type.heading, fontSize: 14.5, flex: 1, color: colors.textDim },
  lockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  lockedRowBody: { flex: 1, gap: 1 },
  lockedRowTitle: { ...type.heading, fontSize: 13.5, color: colors.textDim },
  lockedRowReq: { ...type.caption, fontSize: 11.5, color: colors.textFaint, lineHeight: 15 },

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
  howDisclaimer: { ...type.mono, fontSize: 10.5, color: colors.textFaint, lineHeight: 15, marginTop: spacing.xs },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
