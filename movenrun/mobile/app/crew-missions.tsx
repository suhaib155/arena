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
import {
  buildCrewMissions,
  MISSION_CATEGORY_LABEL,
  MISSION_STATUS_LABEL,
  type CrewMission,
  type MissionAction,
  type MissionStatus,
} from "@/lib/crewMissions";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

const STATUS_TINT: Record<MissionStatus, string> = {
  locked: colors.textFaint,
  ready: palette.baseBlue,
  "in-progress": "#B07908",
  "complete-preview": "#0A8F60",
};

const STATUS_FILL: Record<MissionStatus, string> = {
  locked: palette.silverTrail,
  ready: palette.baseBlue,
  "in-progress": palette.moveGold,
  "complete-preview": palette.pulseGreen,
};

interface LinkDef {
  label: string;
  action: MissionAction;
  icon: IoniconName;
}
const LINKS: LinkDef[] = [
  { label: "Club Territory", action: "club", icon: "map-outline" },
  { label: "City War", action: "war", icon: "flag-outline" },
  { label: "Event Zones", action: "events", icon: "sparkles-outline" },
  { label: "Sponsor Zones", action: "sponsor", icon: "storefront-outline" },
  { label: "Season Objectives", action: "objectives", icon: "ribbon-outline" },
];

/**
 * Crew Missions — a local, read-only board of weekly team-style goals derived
 * from existing local previews. No real members/users/multiplayer/chat/invites,
 * no leaderboards/rankings/rewards, no backend, chain, wallet, map SDK, raw GPS,
 * timers, or push. Read-only; gates nothing.
 */
export default function CrewMissionsScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const history = useGameStore((s) => s.history);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const streak = useGameStore((s) => s.streak);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);

  const board = useMemo(() => {
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
    return buildCrewMissions({
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

  const go = (action: MissionAction) => {
    tapFeedback();
    switch (action) {
      case "alerts":
        router.push("/territory/alerts");
        break;
      case "map":
        router.push("/territory/map");
        break;
      case "districts":
        router.push("/city-districts");
        break;
      case "rivals":
        router.push("/rivals");
        break;
      case "club":
        router.push("/club-territory");
        break;
      case "war":
        router.push("/city-war");
        break;
      case "events":
        router.push("/event-zones");
        break;
      case "sponsor":
        router.push("/sponsor-zones");
        break;
      case "objectives":
        router.push("/season-objectives");
        break;
      case "signal":
        router.push("/route/review-history");
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
        <Text style={styles.headerTitle}>Crew Missions</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{board.title} · {board.weekLabel}</Text>
            <Text style={styles.heroTitle}>Local weekly goals for your territory.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="people-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No real members</Text>
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
            <Text style={styles.summaryCrew} numberOfLines={1}>{board.crewLabel}</Text>
            <View style={styles.summaryRow}>
              <Stat value={board.ready} label="ready" tint={palette.baseBlue} />
              <View style={styles.sumDivider} />
              <Stat value={board.inProgress} label="in progress" tint="#B07908" />
              <View style={styles.sumDivider} />
              <Stat value={board.completePreview} label="complete" tint="#0A8F60" />
            </View>
          </View>
        </FadeSlideIn>

        {!board.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="rocket-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to unlock your local crew missions.</Text>
              <Button label="Start Move" icon="play" onPress={() => go("move")} style={styles.emptyBtn} />
            </View>
          </FadeSlideIn>
        ) : (
          <>
            {/* Do this next */}
            {board.topPriority ? (
              <FadeSlideIn delay={STAGGER_MS * 2}>
                <View style={styles.priorityCard}>
                  <View style={styles.priorityIcon}>
                    <Ionicons name="flash-outline" size={18} color={palette.deedViolet} />
                  </View>
                  <View style={styles.priorityBody}>
                    <Text style={styles.priorityKicker}>Do this next</Text>
                    <Text style={styles.priorityName} numberOfLines={1}>{board.topPriority.title}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => go(board.topPriority!.action)} style={styles.priorityCta}>
                    <Text style={styles.priorityCtaText}>{board.topPriority.ctaLabel}</Text>
                  </Pressable>
                </View>
              </FadeSlideIn>
            ) : null}

            {/* Mission list */}
            <FadeSlideIn delay={STAGGER_MS * 3}>
              <Text style={styles.sectionLabel}>Missions</Text>
              <View style={styles.list}>
                {board.missions.map((m) => (
                  <MissionRow key={m.id} mission={m} onPress={() => go(m.action)} />
                ))}
              </View>
            </FadeSlideIn>

            {/* Linked systems */}
            <FadeSlideIn delay={STAGGER_MS * 4}>
              <View style={styles.linksCard}>
                <Text style={styles.linksTitle}>Linked systems</Text>
                {LINKS.map((l) => (
                  <Pressable key={l.action} hitSlop={6} style={styles.linkRow} onPress={() => go(l.action)}>
                    <Ionicons name={l.icon} size={15} color={palette.deedViolet} />
                    <Text style={styles.linkText}>{l.label}</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                  </Pressable>
                ))}
              </View>
            </FadeSlideIn>

            <FadeSlideIn delay={STAGGER_MS * 5}>
              <ScalePress
                to={0.98}
                style={styles.masterCta}
                onPress={() => {
                  tapFeedback();
                  router.push("/district-mastery");
                }}
              >
                <View style={styles.masterCtaIcon}>
                  <Ionicons name="ribbon-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.masterCtaBody}>
                  <Text style={styles.masterCtaName}>Master Districts</Text>
                  <Text style={styles.masterCtaNote}>Long-term local district progress</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </ScalePress>
            </FadeSlideIn>
          </>
        )}

        <Text style={styles.footerNote}>
          Crew Missions are local previews. They do not show real members,
          rankings, rewards, or live multiplayer.
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

function MissionRow({ mission, onPress }: { mission: CrewMission; onPress: () => void }) {
  const locked = mission.status === "locked";
  const accent = locked ? colors.textFaint : mission.accent;
  const statusTint = STATUS_TINT[mission.status];
  return (
    <View style={[styles.mission, locked ? styles.missionLocked : null]}>
      <View style={[styles.missionIcon, { backgroundColor: `${accent}1A` }]}>
        <Ionicons name={mission.icon as IoniconName} size={18} color={accent} />
      </View>
      <View style={styles.missionBody}>
        <View style={styles.missionTitleRow}>
          <Text style={[styles.missionTitle, locked ? styles.missionTitleLocked : null]} numberOfLines={1}>
            {mission.title}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: `${statusTint}1A` }]}>
            <Text style={[styles.statusText, { color: statusTint }]}>
              {MISSION_STATUS_LABEL[mission.status]}
            </Text>
          </View>
        </View>
        <Text style={styles.missionMeta}>{MISSION_CATEGORY_LABEL[mission.category]}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${mission.progress}%`, backgroundColor: STATUS_FILL[mission.status] }]} />
        </View>
        <Text style={styles.missionRec}>{mission.recommendation}</Text>
        <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
          <Text style={[styles.ctaText, { color: locked ? colors.primary : accent }]}>{mission.ctaLabel}</Text>
          <Ionicons name="chevron-forward" size={13} color={locked ? colors.primary : accent} />
        </Pressable>
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

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  summaryCrew: { ...type.heading, fontSize: 15, textAlign: "center" },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 22, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 11, textAlign: "center" },
  sumDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },

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
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  priorityBody: { flex: 1, gap: 1 },
  priorityKicker: { ...type.kicker, color: palette.deedViolet, fontSize: 10.5 },
  priorityName: { ...type.heading, fontSize: 15 },
  priorityCta: {
    backgroundColor: colors.primaryDim,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  priorityCtaText: { ...type.caption, fontSize: 12, fontWeight: "800", color: colors.primary },

  sectionLabel: { ...type.kicker, color: colors.textFaint, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  mission: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  missionLocked: { backgroundColor: colors.surfaceAlt, shadowOpacity: 0.04 },
  missionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  missionBody: { flex: 1, gap: 4 },
  missionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  missionTitle: { ...type.heading, fontSize: 14.5, flex: 1 },
  missionTitleLocked: { color: colors.textFaint },
  statusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusText: { fontSize: 10, fontWeight: "800" },
  missionMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden", marginTop: 2 },
  fill: { height: 6, borderRadius: radius.pill },
  missionRec: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700" },

  linksCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
    ...shadows.card,
  },
  linksTitle: { ...type.kicker, color: colors.textFaint, marginBottom: spacing.xs },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  linkText: { ...type.caption, fontSize: 13, color: colors.text, flex: 1, fontWeight: "600" },

  masterCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  masterCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  masterCtaBody: { flex: 1, gap: 1 },
  masterCtaName: { ...type.heading, fontSize: 14.5 },
  masterCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
