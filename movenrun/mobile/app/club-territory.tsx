import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ScalePress } from "@/components/ScalePress";
import { Hexagon } from "@/components/Hexagon";
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
import {
  buildClubTerritory,
  type ClubAction,
  type ClubDistrictPresence,
  type ClubStance,
  type ClubZoneContribution,
} from "@/lib/clubTerritory";
import type { BattleStatus } from "@/lib/cityWarBoard";
import { tapFeedback } from "@/lib/haptics";

const STANCE_TINT: Record<ClubStance, string> = {
  expanding: palette.baseBlue,
  defending: palette.heatCoral,
  rebuilding: colors.textDim,
  holding: "#0A8F60",
};

const BATTLE_TINT: Record<BattleStatus, string> = {
  holding: palette.pulseGreen,
  contested: palette.moveGold,
  pressured: palette.heatCoral,
};

const BATTLE_LABEL: Record<BattleStatus, string> = {
  holding: "Holding",
  contested: "Contested",
  pressured: "Pressured",
};

/**
 * Club Territory — a local, read-only club command layer over the user's zones,
 * districts, rivals, and city war. No real members/users/multiplayer/chat/
 * invites, no leaderboards/rankings, no backend, chain, wallet, map SDK, raw
 * GPS, or rewards. Read-only; gates nothing.
 */
export default function ClubTerritoryScreen() {
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
    const zoneStats = zones.map((z) => {
      const s = zoneStatus(z, now);
      return { id: z.id, name: z.name, control: s.control, defense: s.defense, healthy: s.health === "yours" };
    });
    return buildClubTerritory({
      clubName,
      hasZones: zones.length > 0,
      city,
      rivals,
      war,
      zoneStats,
      momentum: recap.momentum,
      objectivesProgress: objectives.progressPct,
      streak,
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

  const go = (action: ClubAction, zoneId?: string) => {
    tapFeedback();
    switch (action) {
      case "districts":
        router.push("/city-districts");
        break;
      case "rivals":
        router.push("/rivals");
        break;
      case "war":
        router.push("/city-war");
        break;
      case "alerts":
        router.push("/territory/alerts");
        break;
      case "events":
        router.push("/event-zones");
        break;
      case "objectives":
        router.push("/season-objectives");
        break;
      case "clubs":
        router.push("/clubs");
        break;
      case "map":
        router.push("/territory/map");
        break;
      case "zone":
        if (zoneId) router.push({ pathname: "/zone/[id]", params: { id: zoneId } });
        else router.push("/territory/map");
        break;
      default:
        router.push("/move");
    }
  };

  const stanceTint = STANCE_TINT[board.stance];

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Club Territory</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Club Territory</Text>
            <Text style={styles.heroTitle}>Your local club command layer.</Text>
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
                <Ionicons name="podium-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No leaderboard</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* No-club personalization prompt */}
        {!board.hasClub ? (
          <FadeSlideIn delay={STAGGER_MS / 2}>
            <ScalePress
              to={0.98}
              style={styles.clubPrompt}
              onPress={() => go("clubs")}
            >
              <Hexagon size={30} color="#E8EDF0" coreColor={palette.dustGray} />
              <View style={styles.clubPromptBody}>
                <Text style={styles.clubPromptName}>Choose a local preview club</Text>
                <Text style={styles.clubPromptNote}>Personalize this dashboard · local preview</Text>
              </View>
              <Text style={styles.clubPromptCta}>View Clubs</Text>
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        {/* Club command card */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.commandCard}>
            <View style={styles.commandHeader}>
              <Hexagon
                size={32}
                color={board.hasClub ? "#C9EEDE" : "#E8EDF0"}
                coreColor={board.hasClub ? palette.pulseGreen : palette.dustGray}
              />
              <View style={styles.commandTitleBox}>
                <Text style={styles.commandName} numberOfLines={1}>{board.clubLabel}</Text>
                <View style={[styles.stanceChip, { backgroundColor: `${stanceTint}1A` }]}>
                  <Text style={[styles.stanceText, { color: stanceTint }]}>{board.stanceLabel}</Text>
                </View>
              </View>
            </View>
            <View style={styles.scoreRow}>
              <Score value={board.territoryScore} label="territory" tint={palette.baseBlue} />
              <View style={styles.scoreDivider} />
              <Score value={board.defenseScore} label="defense" tint="#0A8F60" />
              <View style={styles.scoreDivider} />
              <Score value={board.activityScore} label="activity" tint={palette.moveGold} />
            </View>
            <Pressable
              hitSlop={8}
              style={styles.recRow}
              onPress={() => go(board.recommendedAction.action)}
            >
              <Ionicons name="flash-outline" size={15} color={palette.deedViolet} />
              <Text style={styles.recText}>{board.recommendedAction.label}</Text>
              <Text style={styles.recCta}>{board.recommendedAction.ctaLabel}</Text>
            </Pressable>
          </View>
        </FadeSlideIn>

        {!board.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="flag-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to build your club territory preview.</Text>
              <Button
                label="Start Move"
                icon="play"
                onPress={() => go("move")}
                style={styles.emptyBtn}
              />
            </View>
          </FadeSlideIn>
        ) : (
          <>
            {/* District presence */}
            {board.districts.length > 0 ? (
              <FadeSlideIn delay={STAGGER_MS * 2}>
                <Text style={styles.sectionLabel}>District presence</Text>
                <View style={styles.list}>
                  {board.districts.map((d) => (
                    <DistrictRow key={d.id} district={d} onPress={() => go(d.action)} />
                  ))}
                </View>
              </FadeSlideIn>
            ) : null}

            {/* Top zone contributions */}
            {board.topZones.length > 0 ? (
              <FadeSlideIn delay={STAGGER_MS * 3}>
                <Text style={styles.sectionLabel}>Top zone contributions</Text>
                <View style={styles.list}>
                  {board.topZones.map((z) => (
                    <ZoneRow key={z.id} zone={z} onPress={() => go("zone", z.id)} />
                  ))}
                </View>
              </FadeSlideIn>
            ) : null}

            {/* Club pressure */}
            <FadeSlideIn delay={STAGGER_MS * 4}>
              <View style={styles.pressureCard}>
                <Pressable hitSlop={6} style={styles.pressureRow} onPress={() => go(board.rivalSummary.action)}>
                  <Ionicons name="color-wand-outline" size={16} color={palette.heatCoral} />
                  <Text style={styles.pressureText} numberOfLines={2}>{board.rivalSummary.label}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                </Pressable>
                <View style={styles.pressureDivider} />
                <Pressable hitSlop={6} style={styles.pressureRow} onPress={() => go(board.cityWarSummary.action)}>
                  <Ionicons name="flag-outline" size={16} color={palette.deedViolet} />
                  <Text style={styles.pressureText} numberOfLines={2}>{board.cityWarSummary.label}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                </Pressable>
              </View>
            </FadeSlideIn>

            {/* Future activation */}
            <FadeSlideIn delay={STAGGER_MS * 5}>
              <ScalePress to={0.98} style={styles.activationCard} onPress={() => go("events")}>
                <View style={styles.activationIcon}>
                  <Ionicons name="sparkles-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.activationBody}>
                  <Text style={styles.activationName}>Club rally · future activity</Text>
                  <Text style={styles.activationNote}>Fictional event previews · local only</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </ScalePress>
            </FadeSlideIn>

            <FadeSlideIn delay={STAGGER_MS * 6}>
              <ScalePress
                to={0.98}
                style={styles.activationCard}
                onPress={() => {
                  tapFeedback();
                  router.push("/crew-missions");
                }}
              >
                <View style={styles.activationIcon}>
                  <Ionicons name="rocket-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.activationBody}>
                  <Text style={styles.activationName}>Crew Missions</Text>
                  <Text style={styles.activationNote}>Local weekly goals for your crew</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </ScalePress>
            </FadeSlideIn>
          </>
        )}

        <Text style={styles.footerNote}>
          Club Territory is a local preview. It does not show real members,
          rankings, rewards, or live multiplayer.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Score({ value, label, tint }: { value: number; label: string; tint: string }) {
  return (
    <View style={styles.score}>
      <Text style={[styles.scoreValue, { color: tint }]}>{value}</Text>
      <Text style={styles.scoreLabel}>{label}</Text>
    </View>
  );
}

function DistrictRow({ district, onPress }: { district: ClubDistrictPresence; onPress: () => void }) {
  const tint = BATTLE_TINT[district.status];
  return (
    <ScalePress to={0.99} style={styles.district} onPress={onPress}>
      <View style={styles.districtTop}>
        <Text style={styles.districtName} numberOfLines={1}>{district.name}</Text>
        <View style={[styles.districtChip, { backgroundColor: `${tint}1A` }]}>
          <Text style={[styles.districtChipText, { color: tint }]}>{BATTLE_LABEL[district.status]}</Text>
        </View>
      </View>
      <View style={styles.barRow}>
        <Text style={styles.barLabel}>Presence</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${district.presencePct}%`, backgroundColor: palette.baseBlue }]} />
        </View>
        <Text style={styles.barPct}>{district.presencePct}%</Text>
      </View>
      <View style={styles.barRow}>
        <Text style={styles.barLabel}>Pressure</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${district.pressurePct}%`, backgroundColor: palette.heatCoral }]} />
        </View>
        <Text style={styles.barPct}>{district.pressurePct}%</Text>
      </View>
    </ScalePress>
  );
}

function ZoneRow({ zone, onPress }: { zone: ClubZoneContribution; onPress: () => void }) {
  return (
    <ScalePress to={0.99} style={styles.zone} onPress={onPress}>
      <Hexagon size={26} color="#C9EEDE" coreColor={palette.pulseGreen} />
      <View style={styles.zoneBody}>
        <Text style={styles.zoneName} numberOfLines={1}>{zone.name}</Text>
        <Text style={styles.zoneMeta}>
          {zone.label} · control {zone.control}% · defense {zone.defense}%
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </ScalePress>
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

  clubPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  clubPromptBody: { flex: 1, gap: 1 },
  clubPromptName: { ...type.heading, fontSize: 14.5 },
  clubPromptNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  clubPromptCta: { ...type.caption, fontSize: 13, fontWeight: "800", color: colors.primary },

  commandCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  commandHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  commandTitleBox: { flex: 1, gap: 4 },
  commandName: { ...type.title, fontSize: 18 },
  stanceChip: { alignSelf: "flex-start", borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  stanceText: { fontSize: 10.5, fontWeight: "800" },
  scoreRow: { flexDirection: "row", alignItems: "center" },
  score: { flex: 1, alignItems: "center", gap: 2 },
  scoreValue: { ...type.display, fontSize: 26, fontVariant: ["tabular-nums"] },
  scoreLabel: { ...type.caption, fontSize: 11 },
  scoreDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },
  recRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  recText: { ...type.caption, fontSize: 12, color: colors.text, flex: 1 },
  recCta: { ...type.caption, fontSize: 12, fontWeight: "800", color: colors.primary },

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

  district: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  districtTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  districtName: { ...type.heading, fontSize: 14.5, flex: 1 },
  districtChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  districtChipText: { fontSize: 10, fontWeight: "800" },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { ...type.mono, fontSize: 9.5, color: colors.textFaint, width: 54 },
  barTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 6, borderRadius: radius.pill },
  barPct: { ...type.mono, fontSize: 10, color: colors.textDim, width: 34, textAlign: "right" },

  zone: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  zoneBody: { flex: 1, gap: 2 },
  zoneName: { ...type.heading, fontSize: 14.5 },
  zoneMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },

  pressureCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  pressureRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  pressureText: { ...type.caption, fontSize: 12.5, color: colors.text, flex: 1 },
  pressureDivider: { height: 1, backgroundColor: colors.surfaceAlt },

  activationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  activationIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  activationBody: { flex: 1, gap: 1 },
  activationName: { ...type.heading, fontSize: 14.5 },
  activationNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
