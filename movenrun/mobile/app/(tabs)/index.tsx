import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { QuestCard } from "@/components/QuestCard";
import { SectionHeader } from "@/components/SectionHeader";
import { RoutePath } from "@/components/RoutePath";
import { TerritoryPreview } from "@/components/TerritoryPreview";
import { ZoneCard } from "@/components/ZoneCard";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { Button } from "@/components/Button";
import { StatCard } from "@/components/StatCard";
import { NavRow } from "@/components/NavRow";
import { MissionCard } from "@/components/MissionCard";
import { NotificationBell } from "@/components/NotificationBell";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { zoneStatus } from "@/lib/territory";
import { getClubById, CLUBS } from "@/data/clubs";
import { rankClubs, sessionsThisWeek } from "@/lib/clubs";
import { buildQuestline } from "@/lib/onboardingQuestline";
import { buildTerritoryAlerts } from "@/lib/territoryAlerts";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildSeasonObjectives } from "@/lib/seasonObjectives";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildCollections } from "@/lib/zoneCollections";
import { useSessionStart } from "@/hooks/useSessionStart";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { getLocalDateKey } from "@/lib/date";
import { tapFeedback } from "@/lib/haptics";
import {
  buildUpNext,
  missionHasOwnCta,
  resolveHeroState,
  selectHomeMission,
  type MissionAction,
  type UpNextId,
} from "@/lib/homeMission";

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Route each semantic mission/up-next action to a concrete screen. */
const MISSION_ROUTE: Record<MissionAction, string> = {
  "resume-move": "/move",
  move: "/move",
  territory: "/territory/map",
  objective: "/questline",
  weekly: "/season-objectives",
};

const UP_NEXT_ROUTE: Record<UpNextId, string> = {
  objectives: "/season-objectives",
  "weekly-recap": "/weekly-recap",
  club: "/clubs",
  questline: "/questline",
  city: "/city-districts",
  collections: "/collections",
};

export default function TodayScreen() {
  const router = useRouter();
  const { dailyQuest, recommendedQuests, completedTodayIds, dailyCompletedToday } =
    useSessionStart();

  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const lastTrustScore = useGameStore((s) => s.lastTrustScore);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);

  const selectedClub = getClubById(selectedClubId);
  const questline = buildQuestline({
    hasHistory: history.length > 0,
    savedRoutes: routeTrustHistory.length,
    zonesOwned: zones.length,
    timesDefended,
    hasClub: selectedClubId != null,
    hasTrust: lastTrustScore != null,
    viewedPassport: viewedRoutePassport,
    viewedProof: viewedRouteProof,
  });
  const alertsSummary = buildTerritoryAlerts({
    zones,
    streak,
    hasRecentActivity: history.some(
      (rec) => getLocalDateKey(new Date(rec.completedAt)) === getLocalDateKey(),
    ),
  });
  const weeklyRecap = buildWeeklyRecap({
    history,
    routeTrustHistory,
    zones,
    streak,
    clubName: selectedClub?.name ?? null,
  });
  const cityDistricts = buildCityDistricts(zones);
  const zonesWithStatus = zones.map((z) => ({ zone: z, status: zoneStatus(z) }));
  const atRisk = zonesWithStatus.filter((e) => e.status.health !== "yours");
  const priority = [...zonesWithStatus].sort((a, b) => b.status.risk - a.status.risk)[0] ?? null;
  const seasonAtRisk = atRisk.length;
  const seasonObjectives = buildSeasonObjectives({
    routesThisWeek: weeklyRecap.routes,
    savedRoutes: routeTrustHistory.length,
    hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
    zonesOwned: zones.length,
    atRiskOrWorse: seasonAtRisk,
    timesDefended,
    fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
    hasClub: selectedClubId != null,
    streak,
    viewedPassport: viewedRoutePassport,
    viewedProof: viewedRouteProof,
    weeklyActive: weeklyRecap.hasActivity,
    collectionsUnlocked: buildCollections({
      savedRoutes: routeTrustHistory.length,
      cleanRoutes: routeTrustHistory.filter((r) => r.riskFlags.length === 0).length,
      hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
      zonesCaptured: zones.length,
      atRiskOrWorse: seasonAtRisk,
      timesDefended,
      fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
      hasClub: selectedClubId != null,
      viewedPassport: viewedRoutePassport,
      viewedProof: viewedRouteProof,
    }).unlocked,
  });

  const level = getLevelInfo(totalXp);
  const todayKey = getLocalDateKey();
  const xpToday = history
    .filter((rec) => getLocalDateKey(new Date(rec.completedAt)) === todayKey)
    .reduce((sum, rec) => sum + rec.xp, 0);
  const lockedMove = lockedMovePreview(totalXp);
  const clubRank = selectedClub
    ? rankClubs(CLUBS, selectedClub.id, {
        zonesOwned: zones.length,
        timesDefended,
        totalXp,
        streak,
        sessionsThisWeek: sessionsThisWeek(history),
      }).find((r) => r.isUserClub)?.rank ?? null
    : null;

  const hasMovedEver = history.length > 0 || routeTrustHistory.length > 0;

  /* Persistent movement recovery is not implemented yet (finished routes live
     only in memory during the summary flow), so there is never a genuinely
     recoverable session to resume here. The value is honestly false today; the
     selector supports the state and its ordering is covered by tests. */
  const hasRecoverableMovement = false;

  const missionInput = {
    hasRecoverableMovement,
    atRiskZoneCount: atRisk.length,
    topRiskZoneName: atRisk.length > 0 ? priority?.zone.name ?? null : null,
    // A "current objective" is meaningful once the player is in the loop; brand
    // new users fall through to the first-movement mission instead.
    currentObjectiveTitle:
      hasMovedEver && !questline.allComplete ? questline.currentStep?.title ?? null : null,
    hasMovedEver,
    zonesOwned: zones.length,
    weeklyObjectiveTitle: seasonObjectives.nextObjective?.title ?? null,
  };
  const hero = resolveHeroState(missionInput);
  const mission = selectHomeMission(missionInput);
  const missionShowsButton = missionHasOwnCta(mission, hero);

  const upNext = buildUpNext({
    missionKind: mission.kind,
    hasSeasonObjective: seasonObjectives.nextObjective != null,
    seasonObjectiveSubtitle: seasonObjectives.nextObjective
      ? `Next · ${seasonObjectives.nextObjective.title}`
      : "All objectives complete this season",
    hasWeeklyActivity: weeklyRecap.hasActivity,
    weeklyRecapSubtitle: `${weeklyRecap.routes} route${weeklyRecap.routes === 1 ? "" : "s"} · ${weeklyRecap.zonesCaptured} captured · ${weeklyRecap.momentumLabel}`,
    hasClub: selectedClub != null,
    clubSubtitle: selectedClub
      ? `City rank #${clubRank ?? "—"} · your movement powers the club`
      : "Local preview · pick a club to represent",
    questlineComplete: questline.allComplete,
    questlineSubtitle: questline.allComplete
      ? "Local beta loop complete"
      : `Next · ${questline.currentStep?.title ?? ""}`,
    hasZones: zones.length > 0,
    citySubtitle: `${cityDistricts.controlledDistricts}/${cityDistricts.activeDistricts} controlled · ${cityDistricts.nextAction.label}`,
  });

  const alertsUnread = alertsSummary.urgent + alertsSummary.caution > 0;

  const startMove = () => {
    tapFeedback();
    router.push("/move");
  };
  const goMission = () => {
    tapFeedback();
    router.push(MISSION_ROUTE[mission.action]);
  };
  const openQuest = (id: string) => {
    tapFeedback();
    router.push({ pathname: "/quest/[id]", params: { id } });
  };

  const editorialHeadline =
    atRisk.length > 0 ? "Defend\nyour ground." : hasMovedEver ? "Own\nyour city." : "Ready\nto move.";

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Header: brand + greeting + single bell affordance (no banners) */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.brandKicker}>MOVENRUN</Text>
            <Text style={styles.greeting}>{greeting()}</Text>
          </View>
          <NotificationBell
            unread={alertsUnread}
            onPress={() => {
              tapFeedback();
              router.push("/territory/alerts");
            }}
          />
        </View>

        <Text style={styles.headline}>{editorialHeadline}</Text>

        {/* Territory hero — the visual centre; one primary movement CTA */}
        <FadeSlideIn>
          <View style={styles.hero}>
            {zones.length > 0 ? (
              <>
                <Text style={styles.heroKicker}>Your territory</Text>
                <View style={styles.heroStatsRow}>
                  <HeroStat
                    value={zones.length}
                    label={zones.length === 1 ? "zone" : "zones"}
                    tint={palette.pulseGreen}
                  />
                  <View style={styles.heroDivider} />
                  <HeroStat
                    value={atRisk.length}
                    label="need defence"
                    tint={atRisk.length > 0 ? palette.heatCoral : colors.textDim}
                  />
                  <View style={styles.heroDivider} />
                  <HeroStat
                    value={`L${level.level}`}
                    label={`${level.xpIntoLevel}/${level.xpForLevel} XP`}
                    tint={palette.baseBlue}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.heroKicker}>Free map beta · Warmup</Text>
                <View style={styles.heroLevelRow}>
                  <Text style={styles.heroLevel}>Level {level.level}</Text>
                  <Text style={styles.heroXp}>
                    {level.xpIntoLevel} / {level.xpForLevel} XP
                  </Text>
                </View>
              </>
            )}
            <RoutePath progress={level.progress} />
            <Button label={hero.ctaLabel} icon="play" onPress={startMove} style={styles.heroCta} />
            {zones.length > 0 ? (
              <Button
                label="View Map"
                icon="map-outline"
                variant="secondary"
                onPress={() => {
                  tapFeedback();
                  router.push("/territory/map");
                }}
              />
            ) : (
              <Text style={styles.heroNote}>
                Foreground GPS session — your route, distance, and pace, all on-device. Capture your
                first zone as you move.
              </Text>
            )}
          </View>
        </FadeSlideIn>

        {/* Two performance widgets — varied hierarchy, not a wall of cards */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.statsRow}>
            <StatCard icon="flame" value={streak} label="day streak" tint={palette.heatCoral} />
            <StatCard icon="flash" value={`+${xpToday}`} label="XP today" tint={palette.moveGold} />
          </View>
        </FadeSlideIn>

        {/* The single prioritized mission */}
        <FadeSlideIn delay={STAGGER_MS}>
          <MissionCard
            mission={mission}
            showButton={missionShowsButton}
            onPress={missionShowsButton ? goMission : startMove}
          />
        </FadeSlideIn>

        {/* Up Next — capped at three prioritized secondary destinations */}
        {upNext.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS}>
            <View style={styles.upNextWrap}>
              <SectionHeader title="Up next" />
              <View style={styles.upNextList}>
                {upNext.map((item) => (
                  <NavRow
                    key={item.id}
                    icon={item.icon as never}
                    title={item.title}
                    subtitle={item.subtitle}
                    onPress={() => {
                      tapFeedback();
                      router.push(UP_NEXT_ROUTE[item.id]);
                    }}
                  />
                ))}
              </View>
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Territory portfolio */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <SectionHeader
            title="Your territory"
            trailing={
              zones.length > 0 ? `${zones.length} zone${zones.length === 1 ? "" : "s"}` : "soon"
            }
          />
          <View style={styles.sectionGap} />
          {priority ? (
            <View style={styles.territoryWrap}>
              <ZoneCard
                zone={priority.zone}
                onPress={() => {
                  tapFeedback();
                  router.push({ pathname: "/zone/[id]", params: { id: priority.zone.id } });
                }}
              />
              <View style={styles.defendTeaser}>
                <Ionicons name="navigate-outline" size={14} color={colors.textFaint} />
                <Text style={styles.defendTeaserText}>
                  {atRisk.length > 0
                    ? "Start Move through a zone to defend it."
                    : "Moving through your zones keeps defence charged."}
                </Text>
              </View>
            </View>
          ) : (
            <TerritoryPreview />
          )}
        </FadeSlideIn>

        {/* Daily quest — the streak-safe warmup loop */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <SectionHeader title="Today's Quest" />
          <View style={styles.sectionGap} />
          <QuestCard
            quest={dailyQuest}
            featured
            completed={dailyCompletedToday}
            onPress={() => openQuest(dailyQuest.id)}
          />
        </FadeSlideIn>

        <SectionHeader title="Warmup quests" trailing={`${recommendedQuests.length}`} />
        <View style={styles.list}>
          {recommendedQuests.map((q, i) => (
            <FadeSlideIn key={q.id} delay={STAGGER_MS * (4 + i)}>
              <QuestCard
                quest={q}
                completed={completedTodayIds.includes(q.id)}
                onPress={() => openQuest(q.id)}
              />
            </FadeSlideIn>
          ))}
        </View>

        <Text style={styles.footerLoop}>
          {lockedMove} Locked MOVE · Move → Capture → Defend → Own
        </Text>
      </ScrollView>
    </Screen>
  );
}

function HeroStat({
  value,
  label,
  tint,
}: {
  value: string | number;
  label: string;
  tint: string;
}) {
  return (
    <View style={styles.heroStat}>
      <Text style={[styles.heroStatValue, { color: tint }]}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  brandKicker: { ...type.kicker, color: colors.primary },
  greeting: { ...type.body, fontSize: 15, color: colors.textDim },
  headline: { ...type.display, fontSize: 34, lineHeight: 36, letterSpacing: -1 },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.float,
  },
  heroKicker: { ...type.kicker, color: colors.primary },
  heroStatsRow: { flexDirection: "row", alignItems: "center" },
  heroStat: { flex: 1, alignItems: "center", gap: 2 },
  heroStatValue: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    fontVariant: ["tabular-nums"],
  },
  heroStatLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  heroDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 4,
    backgroundColor: colors.surfaceAlt,
  },
  heroLevelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  heroLevel: { ...type.title, fontSize: 20 },
  heroXp: { ...type.mono, fontSize: 12.5 },
  heroCta: { marginTop: spacing.xs },
  heroNote: { ...type.caption, fontSize: 12, textAlign: "center", color: colors.textFaint },
  statsRow: { flexDirection: "row", gap: spacing.md },
  upNextWrap: { gap: spacing.md },
  upNextList: { gap: spacing.sm },
  sectionGap: { height: spacing.md },
  territoryWrap: { gap: spacing.sm },
  defendTeaser: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.xs,
  },
  defendTeaserText: { ...type.caption, fontSize: 12, color: colors.textFaint },
  list: { gap: spacing.md },
  footerLoop: {
    ...type.mono,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
