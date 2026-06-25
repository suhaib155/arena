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
import { buildCollections } from "@/lib/zoneCollections";
import {
  buildSeasonObjectives,
  type ObjectiveAction,
  type ObjectiveGroup,
  type SeasonObjective,
} from "@/lib/seasonObjectives";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/** Status accents resolved against the theme. */
const STATUS = {
  complete: { tint: "#0A8F60", soft: `${palette.pulseGreen}1A`, label: "Complete" },
  active: { tint: palette.baseBlue, soft: `${palette.baseBlue}14`, label: "Active" },
  locked: { tint: colors.textFaint, soft: colors.surfaceAlt, label: "Locked" },
} as const;

/**
 * Season Objectives — local, read-only weekly goals derived from existing local
 * state. No backend, network, chain, wallet, push notifications, or background
 * work. Objectives are previews: they reward nothing and gate nothing.
 */
export default function SeasonObjectivesScreen() {
  const router = useRouter();
  const history = useGameStore((s) => s.history);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const zones = useGameStore((s) => s.zones);
  const streak = useGameStore((s) => s.streak);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);

  const overview = useMemo(() => {
    const selectedClub = getClubById(selectedClubId);
    const recap = buildWeeklyRecap({
      history,
      routeTrustHistory,
      zones,
      streak,
      clubName: selectedClub?.name ?? null,
    });
    const atRiskOrWorse = zones.filter((z) => zoneStatus(z).health !== "yours").length;
    const fortifyCount = zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0);
    const cleanRoutes = routeTrustHistory.filter((r) => r.riskFlags.length === 0).length;
    const hasStrongTrust = routeTrustHistory.some((r) => r.trustLabel === "Strong");
    const collections = buildCollections({
      savedRoutes: routeTrustHistory.length,
      cleanRoutes,
      hasStrongTrust,
      zonesCaptured: zones.length,
      atRiskOrWorse,
      timesDefended,
      fortifyCount,
      hasClub: selectedClubId != null,
      viewedPassport: viewedRoutePassport,
      viewedProof: viewedRouteProof,
    });
    return buildSeasonObjectives({
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
  }, [
    history,
    routeTrustHistory,
    zones,
    streak,
    timesDefended,
    selectedClubId,
    viewedRoutePassport,
    viewedRouteProof,
  ]);

  const go = (action: ObjectiveAction) => {
    tapFeedback();
    switch (action) {
      case "move":
        router.push("/move");
        break;
      case "map":
        router.push("/territory/map");
        break;
      case "alerts":
        router.push("/territory/alerts");
        break;
      case "passport":
        router.navigate("/route/passport");
        break;
      case "review":
        router.navigate("/route/review-history");
        break;
      case "clubs":
        router.push("/clubs");
        break;
      case "recap":
        router.push("/weekly-recap");
        break;
      case "collections":
        router.navigate("/collections");
        break;
    }
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Season Objectives</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{overview.seasonLabel} · {overview.rangeLabel}</Text>
            <Text style={styles.heroTitle}>Local goals for your territory week.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="gift-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No rewards</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Progress card */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.progressCard}>
            <View style={styles.progressTopRow}>
              <View>
                <Text style={styles.progressCount}>
                  {overview.completed}
                  <Text style={styles.progressTotal}> / {overview.total}</Text>
                </Text>
                <Text style={styles.progressSub}>objectives complete</Text>
              </View>
              <View style={styles.pctWrap}>
                <Text style={styles.pctValue}>{overview.progressPct}%</Text>
              </View>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${overview.progressPct}%`,
                    backgroundColor:
                      overview.progressPct === 100 ? palette.pulseGreen : palette.moveGold,
                  },
                ]}
              />
            </View>
            {overview.nextObjective ? (
              <Text style={styles.nextLine}>Next · {overview.nextObjective.title}</Text>
            ) : (
              <Text style={styles.nextLine}>All objectives complete — nice season.</Text>
            )}
          </View>
        </FadeSlideIn>

        {/* New-user nudge */}
        {!overview.hasActivity ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <Ionicons name="trail-sign-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyText}>Start your first move to begin this season.</Text>
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

        {/* Objective groups */}
        {overview.groups.map((group, gi) => (
          <FadeSlideIn key={group.key} delay={STAGGER_MS * (2 + Math.min(gi, 6))}>
            <ObjectiveGroupBlock group={group} onCta={go} />
          </FadeSlideIn>
        ))}

        {overview.hasActivity ? (
          <FadeSlideIn delay={STAGGER_MS * 9}>
            <ScalePress
              to={0.98}
              style={styles.warCta}
              onPress={() => {
                tapFeedback();
                router.push("/city-war");
              }}
            >
              <View style={styles.warCtaIcon}>
                <Ionicons name="flag-outline" size={18} color={palette.deedViolet} />
              </View>
              <View style={styles.warCtaBody}>
                <Text style={styles.warCtaName}>City War Board</Text>
                <Text style={styles.warCtaNote}>See your fictional season battle</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </ScalePress>
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footerNote}>
          Objectives are local previews. They do not affect rewards, ownership, or
          on-chain status.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function ObjectiveGroupBlock({
  group,
  onCta,
}: {
  group: ObjectiveGroup;
  onCta: (action: ObjectiveAction) => void;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <View style={[styles.groupIcon, { backgroundColor: `${group.accent}14` }]}>
          <Ionicons name={group.icon as IoniconName} size={15} color={group.accent} />
        </View>
        <Text style={styles.groupLabel}>{group.label}</Text>
        <Text style={styles.groupCount}>
          {group.completed}/{group.total}
        </Text>
      </View>
      <View style={styles.groupList}>
        {group.objectives.map((o) => (
          <ObjectiveCard key={o.id} objective={o} onCta={() => onCta(o.action)} />
        ))}
      </View>
    </View>
  );
}

function ObjectiveCard({
  objective,
  onCta,
}: {
  objective: SeasonObjective;
  onCta: () => void;
}) {
  const st = STATUS[objective.status];
  const isComplete = objective.status === "complete";
  const isLocked = objective.status === "locked";
  return (
    <View style={[styles.card, isComplete ? styles.cardComplete : null]}>
      <View style={[styles.cardIcon, { backgroundColor: st.soft }]}>
        <Ionicons
          name={(isComplete ? "checkmark" : objective.icon) as IoniconName}
          size={17}
          color={isComplete ? "#0A8F60" : isLocked ? colors.textFaint : objective.accent}
        />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text
            style={[styles.cardTitle, isLocked ? styles.cardTitleLocked : null]}
            numberOfLines={1}
          >
            {objective.title}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: st.soft }]}>
            <Text style={[styles.statusChipText, { color: st.tint }]}>
              {objective.progressLabel}
            </Text>
          </View>
        </View>
        <Text style={styles.cardDesc}>{objective.description}</Text>
        {!isComplete ? (
          <Pressable hitSlop={6} onPress={onCta} style={styles.ctaBtn} disabled={isLocked}>
            <Text style={[styles.ctaText, { color: isLocked ? colors.textFaint : objective.accent }]}>
              {isLocked ? "Complete earlier objectives first" : objective.ctaLabel}
            </Text>
            {!isLocked ? (
              <Ionicons name="chevron-forward" size={13} color={objective.accent} />
            ) : null}
          </Pressable>
        ) : null}
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

  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  progressTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressCount: { ...type.display, fontSize: 30, fontVariant: ["tabular-nums"] },
  progressTotal: { ...type.title, fontSize: 18, color: colors.textFaint },
  progressSub: { ...type.caption, fontSize: 12 },
  pctWrap: {
    backgroundColor: `${palette.moveGold}1A`,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  pctValue: { ...type.heading, fontSize: 15, color: "#B07908" },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill },
  nextLine: { ...type.caption, fontSize: 12.5, color: colors.textDim },

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

  group: { gap: spacing.sm },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  groupIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  groupLabel: { ...type.heading, fontSize: 15, flex: 1 },
  groupCount: { ...type.mono, fontSize: 12.5, color: colors.textFaint },
  groupList: { gap: spacing.sm },

  card: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  cardComplete: { backgroundColor: `${palette.pulseGreen}0D` },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { ...type.heading, fontSize: 14.5, flex: 1 },
  cardTitleLocked: { color: colors.textFaint },
  statusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusChipText: { fontSize: 10.5, fontWeight: "800", fontVariant: ["tabular-nums"] },
  cardDesc: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700" },

  warCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  warCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  warCtaBody: { flex: 1, gap: 1 },
  warCtaName: { ...type.heading, fontSize: 14.5 },
  warCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
