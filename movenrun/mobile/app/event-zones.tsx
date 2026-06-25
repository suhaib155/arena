import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { ScalePress } from "@/components/ScalePress";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import { zoneStatus } from "@/lib/territory";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildRivalGhosts } from "@/lib/rivalGhosts";
import { buildSeasonObjectives } from "@/lib/seasonObjectives";
import { buildCollections } from "@/lib/zoneCollections";
import { buildSponsorZones } from "@/lib/sponsorZones";
import {
  buildEventZones,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  type EventAction,
  type EventZone,
} from "@/lib/eventZones";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * Event Zones — a local, read-only fictional preview of future city activity.
 * No live events, tickets, RSVPs, countdowns, timers, push notifications, real
 * sponsors/brands, ads, payments, rewards, backend, chain, wallet, map SDK, or
 * raw GPS. Derived deterministically from zone state; read-only; gates nothing.
 */
export default function EventZonesScreen() {
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
    const sponsors = buildSponsorZones({
      hasZones: zones.length > 0,
      city,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      weeklyActive: recap.hasActivity,
    });
    return buildEventZones({
      hasZones: zones.length > 0,
      city,
      rivals,
      sponsors,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      streak,
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

  const go = (action: EventAction) => {
    tapFeedback();
    switch (action) {
      case "districts":
        router.push("/city-districts");
        break;
      case "rivals":
        router.push("/rivals");
        break;
      case "alerts":
        router.push("/territory/alerts");
        break;
      case "sponsor":
        router.push("/sponsor-zones");
        break;
      case "war":
        router.push("/city-war");
        break;
      case "map":
        router.push("/territory/map");
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
        <Text style={styles.headerTitle}>Event Zones</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Event Zones</Text>
            <Text style={styles.heroTitle}>A fictional preview of future city activity.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="color-wand-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Fictional events</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="ban-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No live events</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Readiness */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.readyCard}>
            <View style={styles.readyRow}>
              <Stat value={overview.previewEvents} label="preview events" />
              <View style={styles.readyDivider} />
              <Stat value={overview.activePreviewCount} label="active" tint="#0A8F60" />
              <View style={styles.readyDivider} />
              <Stat value={overview.averageReadiness} label="avg readiness" tint={palette.deedViolet} />
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
              <Ionicons name="sparkles-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to preview future city events.</Text>
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

        {/* Event list */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <Text style={styles.sectionLabel}>
            {overview.hasZones ? "Event previews" : "Future event board"}
          </Text>
          <View style={styles.list}>
            {overview.events.map((e) => (
              <EventRow key={e.id} event={e} onPress={() => go(e.action)} />
            ))}
          </View>
        </FadeSlideIn>

        {overview.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 3}>
            <ScalePress
              to={0.98}
              style={styles.clubCta}
              onPress={() => {
                tapFeedback();
                router.push("/club-territory");
              }}
            >
              <View style={styles.clubCtaIcon}>
                <Ionicons name="map-outline" size={18} color={palette.deedViolet} />
              </View>
              <View style={styles.clubCtaBody}>
                <Text style={styles.clubCtaName}>Club Rally</Text>
                <Text style={styles.clubCtaNote}>Open your local club command layer</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footerNote}>
          Event Zones are fictional local previews. They are not live events,
          rewards, ads, paid placements, or real sponsorships.
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

function EventRow({ event, onPress }: { event: EventZone; onPress: () => void }) {
  const locked = event.status === "locked";
  const accent = event.accent;
  return (
    <View style={[styles.event, locked ? styles.eventLocked : null]}>
      <View style={[styles.eventIcon, { backgroundColor: `${accent}1A` }]}>
        <Ionicons name={event.icon as IoniconName} size={20} color={accent} />
      </View>
      <View style={styles.eventBody}>
        <View style={styles.eventTitleRow}>
          <Text style={[styles.eventName, locked ? styles.eventNameLocked : null]} numberOfLines={1}>
            {event.name}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: `${accent}1A` }]}>
            <Text style={[styles.statusText, { color: accent }]}>
              {EVENT_STATUS_LABEL[event.status]}
            </Text>
          </View>
        </View>
        <Text style={styles.eventMeta}>
          {EVENT_TYPE_LABEL[event.type]}
          {event.districtName ? ` · ${event.districtName}` : " · future slot"}
        </Text>
        {!locked ? (
          <View style={styles.scoreRow}>
            <ScorePill label="Intensity" value={event.intensityScore} color={palette.heatCoral} />
            <ScorePill label="Readiness" value={event.readinessScore} color={palette.pulseGreen} />
          </View>
        ) : null}
        <Text style={styles.eventRec}>{event.recommendation}</Text>
        <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
          <Text style={[styles.ctaText, { color: locked ? colors.primary : accent }]}>{event.ctaLabel}</Text>
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
  event: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  eventLocked: { backgroundColor: colors.surfaceAlt, shadowOpacity: 0.04 },
  eventIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  eventBody: { flex: 1, gap: 4 },
  eventTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eventName: { ...type.heading, fontSize: 14.5, flex: 1 },
  eventNameLocked: { color: colors.textFaint },
  statusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusText: { fontSize: 10, fontWeight: "800" },
  eventMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  scoreRow: { gap: 4, marginTop: 2 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scorePillLabel: { ...type.mono, fontSize: 9, color: colors.textFaint, width: 54 },
  scoreTrack: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  scoreFill: { height: 5, borderRadius: radius.pill },
  scorePillValue: { ...type.mono, fontSize: 10, color: colors.textDim, width: 22, textAlign: "right" },
  eventRec: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700" },

  clubCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  clubCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  clubCtaBody: { flex: 1, gap: 1 },
  clubCtaName: { ...type.heading, fontSize: 14.5 },
  clubCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
