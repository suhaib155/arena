import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import { zoneStatus } from "@/lib/territory";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildSeasonObjectives } from "@/lib/seasonObjectives";
import { buildCollections } from "@/lib/zoneCollections";
import {
  buildSponsorZones,
  sponsorAccent,
  SPONSOR_CATEGORY_LABEL,
  SPONSOR_STATUS_LABEL,
  type SponsorAction,
  type SponsorZone,
} from "@/lib/sponsorZones";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * Sponsor Zones — a local, read-only fictional preview of how future sponsor
 * activations could appear in the city layer. No real sponsors/brands, ads,
 * paid placements, payments, coupons, rewards, backend, chain, wallet, map SDK,
 * or raw GPS. Read-only; gates nothing.
 */
export default function SponsorZonesScreen() {
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
    return buildSponsorZones({
      hasZones: zones.length > 0,
      city,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      weeklyActive: recap.hasActivity,
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

  const go = (action: SponsorAction) => {
    tapFeedback();
    switch (action) {
      case "districts":
        router.push("/city-districts");
        break;
      case "war":
        router.push("/city-war");
        break;
      case "objectives":
        router.push("/season-objectives");
        break;
      case "recap":
        router.push("/weekly-recap");
        break;
      default:
        router.push("/move");
    }
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sponsor Zones</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Sponsor Zones</Text>
            <Text style={styles.heroTitle}>A fictional preview of future local sponsor activations.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="color-wand-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Fictional sponsors</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="ban-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No ads</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Readiness */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.readyCard}>
            <View style={styles.readyRow}>
              <Stat value={overview.previewSlots} label="preview slots" />
              <View style={styles.readyDivider} />
              <Stat value={overview.activePreviewCount} label="active" tint="#0A8F60" />
              <View style={styles.readyDivider} />
              <Stat value={overview.averageLocalFit} label="avg fit" tint={palette.deedViolet} />
            </View>
            <View style={styles.readyNextRow}>
              <Ionicons name="trail-sign-outline" size={15} color={colors.primary} />
              <Text style={styles.readyNextText}>Next · {overview.nextAction.label}</Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Empty / no-zones nudge */}
        {!overview.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="storefront-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to preview future sponsor activations.</Text>
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

        {/* Sponsor list */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <Text style={styles.sectionLabel}>
            {overview.hasZones ? "Sponsor previews" : "Future sponsor board"}
          </Text>
          <View style={styles.list}>
            {overview.sponsors.map((s) => (
              <SponsorRow key={s.id} sponsor={s} onPress={() => go(s.action)} />
            ))}
          </View>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          Sponsor Zones are fictional local previews. They are not ads, paid
          placements, rewards, coupons, or real sponsorships.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, tint }: { value: number; label: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function SponsorRow({ sponsor, onPress }: { sponsor: SponsorZone; onPress: () => void }) {
  const locked = sponsor.status === "locked";
  const accent = locked ? colors.textFaint : sponsorAccent(sponsor.category);
  return (
    <View style={[styles.sponsor, locked ? styles.sponsorLocked : null]}>
      <View style={[styles.sponsorIcon, { backgroundColor: `${accent}1A` }]}>
        <Ionicons name={sponsor.icon as IoniconName} size={20} color={accent} />
      </View>
      <View style={styles.sponsorBody}>
        <View style={styles.sponsorTitleRow}>
          <Text style={[styles.sponsorName, locked ? styles.sponsorNameLocked : null]} numberOfLines={1}>
            {sponsor.name}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: `${accent}1A` }]}>
            <Text style={[styles.statusText, { color: accent }]}>
              {SPONSOR_STATUS_LABEL[sponsor.status]}
            </Text>
          </View>
        </View>
        <Text style={styles.sponsorMeta}>
          {SPONSOR_CATEGORY_LABEL[sponsor.category]}
          {sponsor.districtName ? ` · ${sponsor.districtName}` : " · future slot"}
        </Text>
        {!locked ? (
          <View style={styles.scoreRow}>
            <ScorePill label="Visibility" value={sponsor.visibilityScore} color={palette.baseBlue} />
            <ScorePill label="Local fit" value={sponsor.localFitScore} color={palette.pulseGreen} />
          </View>
        ) : null}
        <Text style={styles.sponsorRec}>{sponsor.recommendation}</Text>
        <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
          <Text style={[styles.ctaText, { color: locked ? colors.primary : accent }]}>{sponsor.ctaLabel}</Text>
          <Ionicons name="chevron-forward" size={13} color={locked ? colors.primary : accent} />
        </Pressable>
      </View>
    </View>
  );
}

function ScorePill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.scorePill}>
      <Text style={styles.scorePillLabel}>{label}</Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.scorePillValue}>{value}</Text>
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

  readyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  readyRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 22, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 11, textAlign: "center" },
  readyDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },
  readyNextRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  readyNextText: { ...type.caption, fontSize: 12.5, color: colors.textDim, flex: 1 },

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
  list: { gap: spacing.sm },
  sponsor: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  sponsorLocked: { backgroundColor: colors.surfaceAlt, shadowOpacity: 0.04 },
  sponsorIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sponsorBody: { flex: 1, gap: 4 },
  sponsorTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sponsorName: { ...type.heading, fontSize: 14.5, flex: 1 },
  sponsorNameLocked: { color: colors.textFaint },
  statusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusText: { fontSize: 10, fontWeight: "800" },
  sponsorMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  scoreRow: { gap: 4, marginTop: 2 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scorePillLabel: { ...type.mono, fontSize: 9, color: colors.textFaint, width: 54 },
  scoreTrack: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  scoreFill: { height: 5, borderRadius: radius.pill },
  scorePillValue: { ...type.mono, fontSize: 10, color: colors.textDim, width: 22, textAlign: "right" },
  sponsorRec: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700" },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
