import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ProgressHero } from "@/components/ProgressHero";
import { CompletedSummary } from "@/components/CompletedSummary";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { ScalePress } from "@/components/ScalePress";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import { zoneStatus } from "@/lib/territory";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildCollections } from "@/lib/zoneCollections";
import { buildSeasonObjectives, type ObjectiveAction } from "@/lib/seasonObjectives";
import { buildObjectivesView, type CategorySummary } from "@/lib/objectivesView";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * Season Objectives — local, read-only weekly goals. Redesigned as a focused
 * progression: one dominant progress statement, one current objective, compact
 * category summaries, and a collapsed completed set. Objectives are previews:
 * they reward nothing and gate nothing. Logic is unchanged (buildSeasonObjectives).
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
  const [completedExpanded, setCompletedExpanded] = useState(false);

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

  const view = useMemo(() => buildObjectivesView(overview), [overview]);

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

  const heroAccent = view.progressPct === 100 ? palette.pulseGreen : palette.baseBlue;

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
        {/* Editorial season context */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>
              {overview.seasonLabel} · {overview.rangeLabel}
            </Text>
            <Text style={styles.heroTitle}>Own your season.</Text>
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

        {/* Dominant progress statement */}
        <FadeSlideIn delay={STAGGER_MS}>
          <ProgressHero
            value={view.completedCount}
            outOf={`/ ${view.total}`}
            label="objectives complete"
            percent={view.progressPct}
            statement={view.statement}
            accent={heroAccent}
          />
        </FadeSlideIn>

        {/* No-progress editorial nudge (single Start-Move CTA here) */}
        {view.showStartNudge ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="trail-sign-outline" size={26} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Your season starts with a move</Text>
              <Text style={styles.emptyText}>
                Start your first move to open this week's objectives — they fill in
                as you capture, defend, and hold territory.
              </Text>
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

        {/* One current objective */}
        {view.current ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.currentCard}>
              <View style={styles.currentHead}>
                <View style={[styles.currentIcon, { backgroundColor: `${view.current.accent}16` }]}>
                  <Ionicons name={view.current.icon as IoniconName} size={20} color={view.current.accent} />
                </View>
                <View style={styles.currentHeadText}>
                  <Text style={styles.currentKicker}>Current objective</Text>
                  <Text style={styles.currentTitle} numberOfLines={2}>
                    {view.current.title}
                  </Text>
                </View>
                <View style={[styles.currentChip, { backgroundColor: `${view.current.accent}14` }]}>
                  <Text style={[styles.currentChipText, { color: view.current.accent }]}>
                    {view.current.progressLabel}
                  </Text>
                </View>
              </View>
              <Text style={styles.currentDesc}>{view.current.description}</Text>
              {view.currentShowsCta ? (
                <Button
                  label={view.current.ctaLabel}
                  variant="secondary"
                  onPress={() => go(view.current!.action)}
                  style={styles.currentCta}
                />
              ) : null}
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Compact category summaries */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.categoriesWrap}>
            <Text style={styles.sectionLabel}>Categories</Text>
            <View style={styles.categoryList}>
              {view.categories.map((c) => (
                <CategoryRow key={c.key} category={c} onPress={c.nextAction ? () => go(c.nextAction!) : undefined} />
              ))}
            </View>
          </View>
        </FadeSlideIn>

        {/* Collapsed completed */}
        {view.completedCount > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <CompletedSummary
              count={view.completedCount}
              expanded={completedExpanded}
              onToggle={() => {
                tapFeedback();
                setCompletedExpanded((v) => !v);
              }}
            >
              {view.completed.map((o) => (
                <View key={o.id} style={styles.completedItem}>
                  <Ionicons name="checkmark-circle" size={16} color="#0A8F60" />
                  <Text style={styles.completedText} numberOfLines={1}>
                    {o.title}
                  </Text>
                </View>
              ))}
            </CompletedSummary>
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

function CategoryRow({ category, onPress }: { category: CategorySummary; onPress?: () => void }) {
  const tint = category.allComplete ? palette.pulseGreen : palette.baseBlue;
  const body = (
    <View style={styles.categoryRow}>
      <View style={[styles.categoryIcon, { backgroundColor: `${tint}14` }]}>
        <Ionicons name={category.icon as IoniconName} size={17} color={tint} />
      </View>
      <View style={styles.categoryBody}>
        <Text style={styles.categoryName}>{category.label}</Text>
        <Text style={styles.categorySupport} numberOfLines={1}>
          {category.supporting}
        </Text>
      </View>
      <Text style={styles.categoryProgress}>{category.progressLabel}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={15} color={colors.textFaint} /> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View accessibilityLabel={`${category.label}, ${category.progressLabel}. ${category.supporting}`}>
        {body}
      </View>
    );
  }
  return (
    <ScalePress
      to={0.98}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.label}, ${category.progressLabel}. ${category.supporting}`}
    >
      {body}
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
  heroTitle: { ...type.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
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
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...type.heading, fontSize: 16.5, textAlign: "center" },
  emptyText: { ...type.body, fontSize: 13.5, lineHeight: 19, textAlign: "center" },
  emptyBtn: { alignSelf: "stretch", marginTop: spacing.sm },

  currentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: `${palette.baseBlue}22`,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  currentHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  currentIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  currentHeadText: { flex: 1, gap: 2 },
  currentKicker: { ...type.kicker, fontSize: 10.5, color: colors.textFaint },
  currentTitle: { ...type.heading, fontSize: 16 },
  currentChip: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: spacing.sm },
  currentChipText: { fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  currentDesc: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
  currentCta: { marginTop: spacing.xs },

  categoriesWrap: { gap: spacing.sm },
  sectionLabel: { ...type.kicker, color: colors.textFaint },
  categoryList: { gap: spacing.sm },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 56,
    ...shadows.card,
  },
  categoryIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryBody: { flex: 1, gap: 1 },
  categoryName: { ...type.heading, fontSize: 14 },
  categorySupport: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  categoryProgress: { ...type.mono, fontSize: 12.5, color: colors.textDim },

  completedItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  completedText: { ...type.caption, fontSize: 12.5, color: colors.text, flex: 1 },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
