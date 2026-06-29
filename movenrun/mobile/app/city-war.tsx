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
import {
  buildCityWarBoard,
  type BattleStatus,
  type DistrictBattle,
  type WarAction,
  type WarBalance,
} from "@/lib/cityWarBoard";
import { tapFeedback } from "@/lib/haptics";

const BALANCE_TINT: Record<WarBalance, string> = {
  leading: "#0A8F60",
  close: "#B07908",
  "under-pressure": "#C2492E",
  rebuilding: colors.textDim,
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
 * City War Board — a local, read-only fictional season battle combining
 * districts, rivals, objectives, and weekly progress. No backend, network,
 * chain, wallet, map SDK, raw GPS, real users, PvP, or rankings. Read-only;
 * gates nothing.
 */
export default function CityWarScreen() {
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
    return buildCityWarBoard({ zones, city, rivals, objectives, recap, clubName, streak });
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

  const go = (action: WarAction, battle?: DistrictBattle) => {
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
      case "objectives":
        router.push("/season-objectives");
        break;
      case "recap":
        router.push("/weekly-recap");
        break;
      case "move":
        router.push("/move");
        break;
      default:
        router.push("/territory/map");
    }
    void battle;
  };

  const balanceTint = BALANCE_TINT[board.balance];

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>City War Board</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{board.seasonTitle} · {board.weekLabel}</Text>
            <Text style={styles.heroTitle}>A fictional local season battle for your territory.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="color-wand-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Fictional</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="person-remove-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No real players</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Scoreboard */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.scoreCard}>
            <View style={styles.scoreRow}>
              <View style={styles.side}>
                <Text style={styles.sideLabel} numberOfLines={1}>{board.playerSideLabel}</Text>
                <Text style={[styles.sideScore, { color: palette.baseBlue }]}>{board.playerScore}</Text>
              </View>
              <View style={styles.scoreMid}>
                <Text style={styles.vs}>vs</Text>
                <View style={[styles.balanceChip, { backgroundColor: `${balanceTint}1A` }]}>
                  <Text style={[styles.balanceText, { color: balanceTint }]}>{board.balanceLabel}</Text>
                </View>
              </View>
              <View style={styles.side}>
                <Text style={styles.sideLabel} numberOfLines={1}>{board.rivalSideLabel}</Text>
                <Text style={[styles.sideScore, { color: palette.heatCoral }]}>{board.rivalPressureScore}</Text>
              </View>
            </View>
            <View style={styles.balanceTrack}>
              <View
                style={[
                  styles.balanceFillPlayer,
                  { flex: Math.max(1, board.playerScore) },
                ]}
              />
              <View
                style={[
                  styles.balanceFillRival,
                  { flex: Math.max(1, board.rivalPressureScore) },
                ]}
              />
            </View>
          </View>
        </FadeSlideIn>

        {!board.hasZones ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="flag-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Capture zones to unlock your local city war preview.</Text>
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
        ) : (
          <>
            {/* Priority — turn the tide */}
            <FadeSlideIn delay={STAGGER_MS * 2}>
              <View style={styles.priorityCard}>
                <View style={styles.priorityIcon}>
                  <Ionicons name="flash-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.priorityBody}>
                  <Text style={styles.priorityKicker}>Turn the tide</Text>
                  <Text style={styles.priorityText}>{board.priorityAction.label}</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() => go(board.priorityAction.action)}
                  style={styles.priorityCta}
                >
                  <Text style={styles.priorityCtaText}>{board.priorityAction.ctaLabel}</Text>
                </Pressable>
              </View>
            </FadeSlideIn>

            {/* District battle board */}
            <FadeSlideIn delay={STAGGER_MS * 3}>
              <Text style={styles.sectionLabel}>District battles</Text>
              <View style={styles.list}>
                {board.districtBattles.map((b) => (
                  <BattleRow key={b.id} battle={b} onPress={() => go(b.action, b)} />
                ))}
              </View>
            </FadeSlideIn>

            {/* Momentum */}
            <FadeSlideIn delay={STAGGER_MS * 4}>
              <View style={styles.momentumCard}>
                <Stat value={`${board.weeklyMomentum.value}`} label={board.weeklyMomentum.label} tint={palette.moveGold} />
                <View style={styles.momentumDivider} />
                <Stat
                  value={`${board.completedObjectives}/${board.totalObjectives}`}
                  label="objectives"
                  tint={palette.baseBlue}
                />
                <View style={styles.momentumDivider} />
                <Stat value={`${board.streak}`} label="day streak" tint={palette.heatCoral} />
              </View>
            </FadeSlideIn>

            <FadeSlideIn delay={STAGGER_MS * 5}>
              <ScalePress
                to={0.98}
                style={styles.sponsorCta}
                onPress={() => {
                  tapFeedback();
                  router.push("/sponsor-zones");
                }}
              >
                <View style={styles.sponsorCtaIcon}>
                  <Ionicons name="storefront-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.sponsorCtaBody}>
                  <Text style={styles.sponsorCtaName}>Sponsor Zones</Text>
                  <Text style={styles.sponsorCtaNote}>Preview the future local revenue layer</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </ScalePress>
            </FadeSlideIn>

            <FadeSlideIn delay={STAGGER_MS * 6}>
              <ScalePress
                to={0.98}
                style={styles.sponsorCta}
                onPress={() => {
                  tapFeedback();
                  router.push("/event-zones");
                }}
              >
                <View style={styles.sponsorCtaIcon}>
                  <Ionicons name="sparkles-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.sponsorCtaBody}>
                  <Text style={styles.sponsorCtaName}>Event Zones</Text>
                  <Text style={styles.sponsorCtaNote}>Preview fictional future city activity</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </ScalePress>
            </FadeSlideIn>

            <FadeSlideIn delay={STAGGER_MS * 7}>
              <ScalePress
                to={0.98}
                style={styles.sponsorCta}
                onPress={() => {
                  tapFeedback();
                  router.push("/club-territory");
                }}
              >
                <View style={styles.sponsorCtaIcon}>
                  <Ionicons name="map-outline" size={18} color={palette.deedViolet} />
                </View>
                <View style={styles.sponsorCtaBody}>
                  <Text style={styles.sponsorCtaName}>Club Territory</Text>
                  <Text style={styles.sponsorCtaNote}>Your local club command layer</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </ScalePress>
            </FadeSlideIn>
          </>
        )}

        <Text style={styles.footerNote}>
          City War is a fictional local preview. It is not real PvP, rewards,
          rankings, or on-chain activity.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function BattleRow({ battle, onPress }: { battle: DistrictBattle; onPress: () => void }) {
  const tint = BATTLE_TINT[battle.status];
  return (
    <View style={styles.battle}>
      <View style={styles.battleTitleRow}>
        <Text style={styles.battleName} numberOfLines={1}>{battle.name}</Text>
        <View style={[styles.battleChip, { backgroundColor: `${tint}1A` }]}>
          <Text style={[styles.battleChipText, { color: tint }]}>{BATTLE_LABEL[battle.status]}</Text>
        </View>
      </View>
      <View style={styles.barRow}>
        <Text style={styles.barLabel}>You</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${battle.playerControl}%`, backgroundColor: palette.baseBlue }]} />
        </View>
        <Text style={styles.barPct}>{battle.playerControl}%</Text>
      </View>
      <View style={styles.barRow}>
        <Text style={styles.barLabel}>Rival</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${battle.rivalPressure}%`, backgroundColor: palette.heatCoral }]} />
        </View>
        <Text style={styles.barPct}>{battle.rivalPressure}%</Text>
      </View>
      <View style={styles.battleFooter}>
        <Text style={styles.battleRec} numberOfLines={1}>{battle.recommendation}</Text>
        <Pressable hitSlop={8} onPress={onPress} style={styles.battleCta}>
          <Text style={[styles.battleCtaText, { color: tint }]}>{battle.ctaLabel}</Text>
          <Ionicons name="chevron-forward" size={13} color={tint} />
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

  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  scoreRow: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1, alignItems: "center", gap: 2 },
  sideLabel: { ...type.caption, fontSize: 12, fontWeight: "700", color: colors.textDim },
  sideScore: { ...type.display, fontSize: 32, fontVariant: ["tabular-nums"] },
  scoreMid: { alignItems: "center", gap: 4, paddingHorizontal: spacing.sm },
  vs: { ...type.mono, fontSize: 12, color: colors.textFaint },
  balanceChip: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: spacing.sm },
  balanceText: { fontSize: 10.5, fontWeight: "800" },
  balanceTrack: { flexDirection: "row", height: 10, borderRadius: radius.pill, overflow: "hidden", gap: 2 },
  balanceFillPlayer: { backgroundColor: palette.baseBlue, borderRadius: radius.pill },
  balanceFillRival: { backgroundColor: palette.heatCoral, borderRadius: radius.pill },

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
  priorityText: { ...type.caption, fontSize: 12.5, color: colors.text },
  priorityCta: {
    backgroundColor: colors.primaryDim,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  priorityCtaText: { ...type.caption, fontSize: 12, fontWeight: "800", color: colors.primary },

  sectionLabel: { ...type.kicker, color: colors.textFaint, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  battle: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  battleTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  battleName: { ...type.heading, fontSize: 14.5, flex: 1 },
  battleChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  battleChipText: { fontSize: 10, fontWeight: "800" },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { ...type.mono, fontSize: 9.5, color: colors.textFaint, width: 32 },
  barTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 6, borderRadius: radius.pill },
  barPct: { ...type.mono, fontSize: 10, color: colors.textDim, width: 34, textAlign: "right" },
  battleFooter: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
  battleRec: { ...type.caption, fontSize: 11.5, color: colors.textDim, flex: 1 },
  battleCta: { flexDirection: "row", alignItems: "center", gap: 2 },
  battleCtaText: { ...type.caption, fontSize: 12, fontWeight: "700" },

  momentumCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  stat: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: spacing.xs },
  statValue: { ...type.title, fontSize: 19, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  momentumDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },

  sponsorCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  sponsorCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  sponsorCtaBody: { flex: 1, gap: 1 },
  sponsorCtaName: { ...type.heading, fontSize: 14.5 },
  sponsorCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
