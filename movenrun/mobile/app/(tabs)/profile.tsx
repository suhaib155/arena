import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { StatCard } from "@/components/StatCard";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { RoutePath } from "@/components/RoutePath";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { Button } from "@/components/Button";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { ScalePress } from "@/components/ScalePress";
import { useGameStore } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { zoneStatus } from "@/lib/territory";
import { getClubById, CLUBS } from "@/data/clubs";
import { rankClubs, sessionsThisWeek } from "@/lib/clubs";
import { computePassport } from "@/lib/routePassport";
import { createTapGuard } from "@/lib/openingAnimation";
import { buildCollections } from "@/lib/zoneCollections";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildSeasonObjectives } from "@/lib/seasonObjectives";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildRivalGhosts } from "@/lib/rivalGhosts";
import { buildCityWarBoard } from "@/lib/cityWarBoard";
import { buildSponsorZones } from "@/lib/sponsorZones";
import { buildEventZones } from "@/lib/eventZones";
import { buildClubTerritory } from "@/lib/clubTerritory";
import { buildCrewMissions } from "@/lib/crewMissions";
import { buildDistrictMastery } from "@/lib/districtMastery";
import { buildDeedShowroom } from "@/lib/deedPreview";
import { tapFeedback } from "@/lib/haptics";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProfileScreen() {
  const router = useRouter();
  // Rapid taps on "Replay opening intro" must push exactly one OpeningScreen —
  // Expo Router does not deduplicate pushes, so double-taps would stack.
  const replayGuard = useRef(createTapGuard(1200)).current;
  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const questsCompleted = useGameStore((s) => s.questsCompleted);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const selectedClub = getClubById(selectedClubId);
  const lastTrustScore = useGameStore((s) => s.lastTrustScore);
  const lastTrustLabel = useGameStore((s) => s.lastTrustLabel);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);
  const passport = computePassport(routeTrustHistory, {
    zonesOwned: zones.length,
    timesDefended,
  });
  const reset = useGameStore((s) => s.reset);
  const statuses = zones.map((z) => ({ zone: z, status: zoneStatus(z) }));
  const atRiskCount = statuses.filter((e) => e.status.health !== "yours").length;
  const collections = buildCollections({
    savedRoutes: routeTrustHistory.length,
    cleanRoutes: routeTrustHistory.filter((r) => r.riskFlags.length === 0).length,
    hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
    zonesCaptured: zones.length,
    atRiskOrWorse: atRiskCount,
    timesDefended,
    fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
    hasClub: selectedClubId != null,
    viewedPassport: viewedRoutePassport,
    viewedProof: viewedRouteProof,
  });
  const strongest =
    [...statuses].sort(
      (a, b) =>
        b.status.defense + b.status.control - (a.status.defense + a.status.control),
    )[0] ?? null;
  const recap = buildWeeklyRecap({
    history,
    routeTrustHistory,
    zones,
    streak,
    clubName: selectedClub?.name ?? null,
  });
  const seasonObjectives = buildSeasonObjectives({
    routesThisWeek: recap.routes,
    savedRoutes: routeTrustHistory.length,
    hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
    zonesOwned: zones.length,
    atRiskOrWorse: atRiskCount,
    timesDefended,
    fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
    hasClub: selectedClubId != null,
    streak,
    viewedPassport: viewedRoutePassport,
    viewedProof: viewedRouteProof,
    weeklyActive: recap.hasActivity,
    collectionsUnlocked: collections.unlocked,
  });
  const city = buildCityDistricts(zones);
  const rivals = buildRivalGhosts(zones);
  const cityWar = buildCityWarBoard({
    zones,
    city,
    rivals,
    objectives: seasonObjectives,
    recap,
    clubName: selectedClub?.name ?? null,
    streak,
  });
  const sponsors = buildSponsorZones({
    hasZones: zones.length > 0,
    city,
    momentum: recap.momentum,
    objectivesProgress: seasonObjectives.progressPct,
    weeklyActive: recap.hasActivity,
  });
  const events = buildEventZones({
    hasZones: zones.length > 0,
    city,
    rivals,
    sponsors,
    momentum: recap.momentum,
    objectivesProgress: seasonObjectives.progressPct,
    streak,
  });
  const clubTerritory = buildClubTerritory({
    clubName: selectedClub?.name ?? null,
    hasZones: zones.length > 0,
    city,
    rivals,
    war: cityWar,
    zoneStats: statuses.map((e) => ({
      id: e.zone.id,
      name: e.zone.name,
      control: e.status.control,
      defense: e.status.defense,
      healthy: e.status.health === "yours",
    })),
    momentum: recap.momentum,
    objectivesProgress: seasonObjectives.progressPct,
    streak,
    avgTrust: recap.averageTrustScore ?? 0,
  });
  const crewMissions = buildCrewMissions({
    clubName: selectedClub?.name ?? null,
    hasZones: zones.length > 0,
    zonesOwned: zones.length,
    atRiskOrWorse: atRiskCount,
    city,
    rivals,
    war: cityWar,
    club: clubTerritory,
    sponsors,
    events,
    objectives: seasonObjectives,
    savedRoutes: routeTrustHistory.length,
    hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
    weekLabel: recap.rangeLabel,
  });
  const districtMastery = buildDistrictMastery({
    hasZones: zones.length > 0,
    city,
    war: cityWar,
    clubPresence: clubTerritory.territoryScore,
    momentum: recap.momentum,
    streak,
    objectivesProgress: seasonObjectives.progressPct,
    missionsComplete: crewMissions.completePreview,
    missionsTotal: crewMissions.total,
    avgTrust: recap.averageTrustScore ?? 0,
  });
  const deedShowroom = buildDeedShowroom({
    hasZones: zones.length > 0,
    zones,
    districtMastery,
    passport,
  });
  const level = getLevelInfo(totalXp);
  const lockedMove = lockedMovePreview(totalXp);
  const myRanked = selectedClub
    ? rankClubs(CLUBS, selectedClub.id, {
        zonesOwned: zones.length,
        timesDefended,
        totalXp,
        streak,
        sessionsThisWeek: sessionsThisWeek(history),
      }).find((r) => r.isUserClub) ?? null
    : null;

  const onReset = () => {
    tapFeedback();
    reset();
  };

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Movement identity card */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={32} color={colors.primary} />
              </View>
            </View>
            <Text style={styles.name}>Mover</Text>
            <Text style={styles.subtitle}>
              Level {level.level} · {totalXp.toLocaleString()} XP total
            </Text>
            <View style={styles.heroBar}>
              <RoutePath
                progress={level.progress}
                label={`${level.xpForLevel - level.xpIntoLevel} XP to level ${level.level + 1}`}
              />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.statsRow}>
            <StatCard icon="flame" value={streak} label="Day streak" tint={palette.heatCoral} />
            <StatCard icon="trophy" value={level.level} label="Level" tint={colors.primary} />
            <StatCard
              icon="checkmark-done"
              value={questsCompleted}
              label="Completed"
              tint={palette.pulseGreen}
            />
          </View>
        </FadeSlideIn>

        {/* Locked MOVE — in-app progress only */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={styles.moveCard}>
            <View style={styles.moveIcon}>
              <Hexagon size={20} color={palette.moveGold} />
            </View>
            <View style={styles.moveText}>
              <Text style={styles.moveValue}>{lockedMove.toLocaleString()} Locked MOVE</Text>
              <Text style={styles.moveNote}>
                Preview · in-app progress, not a payout. Unlocks with the
                territory beta.
              </Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Territory portfolio — captured common zones (local simulation) */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.portfolio}>
            <View style={styles.portfolioHexes}>
              {zones.length === 0 ? (
                <>
                  <Hexagon size={26} color="#E8EDF0" />
                  <Hexagon size={26} color="#E8EDF0" />
                  <Hexagon size={26} color="#C9EEDE" coreColor={palette.pulseGreen} />
                </>
              ) : (
                <>
                  {zones.slice(0, 3).map((z) => (
                    <Hexagon key={z.id} size={26} color="#C9EEDE" coreColor={palette.pulseGreen} />
                  ))}
                  {zones.length > 3 ? (
                    <Text style={styles.portfolioMore}>+{zones.length - 3}</Text>
                  ) : null}
                </>
              )}
            </View>
            <View style={styles.portfolioText}>
              <Text style={styles.portfolioTitle}>Territory portfolio</Text>
              <Text style={styles.portfolioNote}>
                {zones.length === 0
                  ? "0 zones owned — capture a zone with a saved session."
                  : `${zones.length} common zone${zones.length === 1 ? "" : "s"} · defended ×${timesDefended}`}
              </Text>
              {strongest ? (
                <Text style={styles.portfolioNote}>
                  Strongest: {strongest.zone.name}
                  {atRiskCount > 0 ? ` · ${atRiskCount} at risk` : " · all stable"}
                </Text>
              ) : null}
            </View>
          </View>
        </FadeSlideIn>

        {/* Territory Map — local board (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/territory/map");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="grid-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>Territory Map</Text>
                <Text style={styles.statusNote}>
                  {zones.length} zone{zones.length === 1 ? "" : "s"} · local board · no raw GPS
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* City Districts — local city preview (read-only) */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/city-districts");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="business-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>City Districts</Text>
              <Text style={styles.statusNote}>
                {city.hasZones
                  ? `${city.controlledDistricts}/${city.activeDistricts} controlled · local city preview`
                  : "Local city preview · capture zones to reveal"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Rival Ghosts — fictional local pressure (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/rivals");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="color-wand-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>Rival Ghosts</Text>
                <Text style={styles.statusNote}>
                  {rivals.hasPressure
                    ? `${rivals.highPressure} high-pressure · fictional rivals · no real users`
                    : "Fictional rivals · local preview · no real users"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* City War Board — fictional local season battle (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/city-war");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="flag-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>City War Board</Text>
                <Text style={styles.statusNote}>
                  {cityWar.playerSideLabel} {cityWar.playerScore} · Ghost Crews{" "}
                  {cityWar.rivalPressureScore} · {cityWar.balanceLabel}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* Sponsor Zones — fictional future activations (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/sponsor-zones");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="storefront-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>Sponsor Zones</Text>
                <Text style={styles.statusNote}>
                  {sponsors.previewSlots} preview slot{sponsors.previewSlots === 1 ? "" : "s"} ·{" "}
                  fictional · no ads
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* District Mastery — long-term local progress (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/district-mastery");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>District Mastery</Text>
                <Text style={styles.statusNote}>
                  {districtMastery.mastered} signature · {districtMastery.fortified} fortified · no ownership
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* Deed Preview Showroom — local, educational preview of future Zone Deeds */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/deed-showroom");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="shapes-outline" size={18} color={palette.deedViolet} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Deed Preview Showroom</Text>
              <Text style={styles.statusNote}>
                {deedShowroom.readyCount} ready preview{deedShowroom.readyCount === 1 ? "" : "s"} · no wallet · no minting
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Crew Missions — local weekly goals (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/crew-missions");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="rocket-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>Crew Missions</Text>
                <Text style={styles.statusNote}>
                  {crewMissions.ready} ready · {crewMissions.inProgress} in progress · local preview
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* Club Territory — local club command layer (read-only) */}
        {zones.length > 0 || selectedClubId != null ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/club-territory");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="map-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>Club Territory</Text>
                <Text style={styles.statusNote}>
                  {clubTerritory.clubLabel} · {clubTerritory.stanceLabel} · local preview
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* Event Zones — fictional future city activity (read-only) */}
        {zones.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <ScalePress
              to={0.98}
              style={styles.statusCard}
              onPress={() => {
                tapFeedback();
                router.navigate("/event-zones");
              }}
            >
              <View style={styles.statusIcon}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusName}>Event Zones</Text>
                <Text style={styles.statusNote}>
                  {events.previewEvents} preview event{events.previewEvents === 1 ? "" : "s"} ·{" "}
                  fictional · no live events
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* Zone Collections — local badges (read-only) */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/collections");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Zone Collections</Text>
              <Text style={styles.statusNote}>
                {collections.unlocked}/{collections.total} local badges · preview only
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Season Objectives — local weekly goals (read-only) */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/season-objectives");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Season Objectives</Text>
              <Text style={styles.statusNote}>
                {seasonObjectives.completed}/{seasonObjectives.total} complete ·{" "}
                {seasonObjectives.nextObjective
                  ? `next · ${seasonObjectives.nextObjective.title}`
                  : "all done · local preview"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Weekly Recap — local reflection (read-only) */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/weekly-recap");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="bar-chart-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Weekly Recap</Text>
              <Text style={styles.statusNote}>
                {recap.hasActivity
                  ? `${recap.weekLabel} · ${recap.routes} route${
                      recap.routes === 1 ? "" : "s"
                    } · ${recap.momentumLabel}`
                  : "Last 7 days · move to fill it in · local preview"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Club — local preview */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <ScalePress
            to={0.98}
            style={styles.clubCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/clubs");
            }}
          >
            <Hexagon
              size={34}
              color={selectedClub ? "#C9EEDE" : "#E8EDF0"}
              coreColor={selectedClub ? palette.pulseGreen : palette.dustGray}
            />
            <View style={styles.clubText}>
              {selectedClub ? (
                <>
                  <Text style={styles.clubName}>{selectedClub.name}</Text>
                  <Text style={styles.clubNote}>
                    City rank #{myRanked?.rank ?? "—"} · contribution +
                    {myRanked?.userContribution ?? 0} · {zones.length} owned · ×{timesDefended} defended
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.clubName}>Join a club</Text>
                  <Text style={styles.clubNote}>Local preview · city wars arrive later</Text>
                </>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Base Sepolia status — read-only contract preview */}
        <FadeSlideIn delay={STAGGER_MS * 5}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/network/status");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="cube-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Base Sepolia Status</Text>
              <Text style={styles.statusNote}>
                Contracts deployed · read-only preview · no wallet needed
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Last route trust — local verification preview (summary only) */}
        {lastTrustScore != null ? (
          <FadeSlideIn delay={STAGGER_MS * 6}>
            <View style={styles.trustRow}>
              <View style={styles.trustIcon}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.trustText}>
                <Text style={styles.trustName}>Last route trust</Text>
                <Text style={styles.trustNote}>
                  {lastTrustLabel ?? "—"} · preview only, does not affect rewards
                </Text>
              </View>
              <Text style={styles.trustScore}>{lastTrustScore}</Text>
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Route review history — local, read-only (summaries only) */}
        <FadeSlideIn delay={STAGGER_MS * 7}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/route/review-history");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="list-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Route Review History</Text>
              <Text style={styles.statusNote}>
                {routeTrustHistory.length > 0
                  ? `Avg ${Math.round(
                      routeTrustHistory.reduce((s, r) => s + r.trustScore, 0) /
                        routeTrustHistory.length,
                    )} · ${routeTrustHistory.length} route${
                      routeTrustHistory.length === 1 ? "" : "s"
                    } · GPS quality trend`
                  : "No saved routes yet · review only, no raw GPS"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {/* Route Signal Passport — local readiness preview (derived, no new state) */}
        <FadeSlideIn delay={STAGGER_MS * 8}>
          <ScalePress
            to={0.98}
            style={styles.statusCard}
            onPress={() => {
              tapFeedback();
              router.navigate("/route/passport");
            }}
          >
            <View style={styles.statusIcon}>
              <Ionicons name="shield-half-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.statusName}>Route Signal Passport</Text>
              <Text style={styles.statusNote}>
                {passport.readinessLabel}
                {passport.reviewedRouteCount > 0
                  ? ` · avg ${passport.averageTrustScore} · ${passport.reviewedRouteCount} route${
                      passport.reviewedRouteCount === 1 ? "" : "s"
                    }`
                  : " · preview only"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        <SectionHeader
          title="Recent activity"
          trailing={history.length ? `${history.length}` : undefined}
        />
        {history.length === 0 ? (
          <EmptyState
            icon="walk-outline"
            title="No moves yet"
            message="Complete your first quest to earn XP and start a daily streak."
            actionLabel="Browse quests"
            onAction={() => router.navigate("/")}
          />
        ) : (
          <View style={styles.list}>
            {history.slice(0, 10).map((rec, i) => (
              <View key={`${rec.questId}-${i}`} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="checkmark" size={15} color={palette.pulseGreen} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{rec.questTitle}</Text>
                  <Text style={styles.rowTime}>{timeAgo(rec.completedAt)}</Text>
                </View>
                <Text style={styles.rowXp}>+{rec.xp} XP</Text>
              </View>
            ))}
          </View>
        )}

        <Button
          label="Account & Wallet"
          icon="wallet-outline"
          variant="secondary"
          onPress={() => {
            tapFeedback();
            router.push("/account");
          }}
        />

        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          onPress={() => {
            if (!replayGuard.tryAcquire()) return;
            tapFeedback();
            router.push("/opening");
          }}
          style={styles.replayLink}
        >
          <Text style={styles.replayText}>Replay opening intro</Text>
        </Pressable>

        {history.length > 0 ? (
          <Button
            label="Reset progress"
            variant="ghost"
            icon="refresh-outline"
            onPress={onReset}
            style={styles.resetBtn}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  hero: {
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.float,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: palette.pulseGreen,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { ...type.title, fontSize: 24 },
  subtitle: { ...type.caption, fontSize: 14 },
  heroBar: { alignSelf: "stretch", marginTop: spacing.md },
  statsRow: { flexDirection: "row", gap: spacing.md },
  moveCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  moveIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: `${palette.moveGold}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  moveText: { flex: 1, gap: 2 },
  moveValue: { ...type.heading, fontSize: 16 },
  moveNote: { ...type.caption, fontSize: 12, lineHeight: 16 },
  portfolio: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  portfolioHexes: { flexDirection: "row", alignItems: "center", gap: 4 },
  portfolioMore: { ...type.caption, fontSize: 12, fontWeight: "700", color: "#0A8F60" },
  clubCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  clubText: { flex: 1, gap: 2 },
  clubName: { ...type.heading, fontSize: 15 },
  clubNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  statusIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: { flex: 1, gap: 2 },
  statusName: { ...type.heading, fontSize: 15 },
  statusNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  trustIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  trustText: { flex: 1, gap: 2 },
  trustName: { ...type.heading, fontSize: 15 },
  trustNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  trustScore: { ...type.title, fontSize: 20, color: colors.primary },
  portfolioText: { flex: 1, gap: 2 },
  portfolioTitle: { ...type.heading, fontSize: 15 },
  portfolioNote: { ...type.caption, fontSize: 12 },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: `${palette.pulseGreen}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { ...type.heading, fontSize: 14.5 },
  rowTime: { ...type.caption, fontSize: 12, color: colors.textFaint },
  rowXp: { ...type.mono, fontSize: 13, color: "#B07908", fontWeight: "700" },
  resetBtn: { marginTop: spacing.xs, alignSelf: "center" },
  replayLink: { marginTop: spacing.lg, alignSelf: "center", paddingVertical: spacing.xs },
  replayText: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },
});
