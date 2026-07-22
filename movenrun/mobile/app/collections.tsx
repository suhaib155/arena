import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ProgressHero } from "@/components/ProgressHero";
import { CompletedSummary } from "@/components/CompletedSummary";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { zoneStatus } from "@/lib/territory";
import { buildCollections, type Badge } from "@/lib/zoneCollections";
import { buildCollectionsView, lockedRequirement } from "@/lib/collectionsView";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * Collections — a focused local-badge archive. One dominant completion summary,
 * the nearest unlock, in-progress badges, and collapsed unlocked/locked
 * archives. Badges are local previews (no rewards, rarity, value, or ownership).
 * Logic is unchanged (buildCollections).
 */
export default function CollectionsScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);
  const [unlockedExpanded, setUnlockedExpanded] = useState(false);
  const [lockedExpanded, setLockedExpanded] = useState(false);

  const view = useMemo(() => {
    const atRiskOrWorse = zones.filter((z) => zoneStatus(z).health !== "yours").length;
    const overview = buildCollections({
      savedRoutes: routeTrustHistory.length,
      cleanRoutes: routeTrustHistory.filter((r) => r.riskFlags.length === 0).length,
      hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
      zonesCaptured: zones.length,
      atRiskOrWorse,
      timesDefended,
      fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
      hasClub: selectedClubId != null,
      viewedPassport: viewedRoutePassport,
      viewedProof: viewedRouteProof,
    });
    return buildCollectionsView(overview);
  }, [zones, timesDefended, selectedClubId, routeTrustHistory, viewedRoutePassport, viewedRouteProof]);

  const heroAccent = view.completionPct === 100 ? palette.pulseGreen : palette.baseBlue;
  const inProgressRest = view.nextBadge
    ? view.inProgress.filter((b) => b.id !== view.nextBadge!.id)
    : view.inProgress;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Collections</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Zone Collections</Text>
            <Text style={styles.heroTitle}>Your movement archive.</Text>
            <View style={styles.chipRow}>
              <View style={[styles.chip, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.chipText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="gift-outline" size={13} color={colors.textDim} />
                <Text style={[styles.chipText, { color: colors.textDim }]}>No rewards</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <ProgressHero
            value={view.unlocked}
            outOf={`/ ${view.total}`}
            label="badges unlocked"
            percent={view.completionPct}
            statement={view.statement}
            accent={heroAccent}
          />
        </FadeSlideIn>

        {!view.hasProgress ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="ribbon-outline" size={26} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Earn your first badge by moving</Text>
              <Text style={styles.emptyText}>
                Save a route, capture a zone, or join a club — badges fill in from
                your real local progress.
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

        {/* Nearest unlock */}
        {view.nextBadge ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.nearestCard}>
              <View style={[styles.nearestIcon, { backgroundColor: `${palette.baseBlue}16` }]}>
                <Ionicons name={view.nextBadge.icon as IoniconName} size={20} color={palette.baseBlue} />
              </View>
              <View style={styles.nearestBody}>
                <Text style={styles.nearestKicker}>Nearest unlock</Text>
                <Text style={styles.nearestTitle}>{view.nextBadge.title}</Text>
                <Text style={styles.nearestDesc}>{view.nextBadge.description}</Text>
                <View style={styles.nearestBarTrack}>
                  <View
                    style={[
                      styles.nearestBarFill,
                      { width: `${Math.round((view.nextBadge.current / view.nextBadge.target) * 100)}%` },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.nearestProgress}>
                {view.nextBadge.current}/{view.nextBadge.target}
              </Text>
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Other in-progress badges */}
        {inProgressRest.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 3}>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>In progress</Text>
              <View style={styles.rowList}>
                {inProgressRest.map((b) => (
                  <BadgeRow key={b.id} badge={b} />
                ))}
              </View>
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Collection group summaries */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Collections</Text>
            <View style={styles.rowList}>
              {view.collections.map((c) => {
                const done = c.unlocked === c.total;
                const tint = done ? palette.pulseGreen : palette.baseBlue;
                return (
                  <View
                    key={c.name}
                    style={styles.groupRow}
                    accessibilityLabel={`${c.name}, ${c.unlocked} of ${c.total} unlocked`}
                  >
                    <View style={[styles.groupIcon, { backgroundColor: `${tint}14` }]}>
                      <Ionicons name={c.icon as IoniconName} size={16} color={tint} />
                    </View>
                    <Text style={styles.groupName}>{c.name}</Text>
                    <Text style={styles.groupCount}>
                      {c.unlocked}/{c.total}
                    </Text>
                    {done ? <Ionicons name="checkmark-circle" size={16} color={palette.pulseGreen} /> : null}
                  </View>
                );
              })}
            </View>
          </View>
        </FadeSlideIn>

        {/* Unlocked archive (collapsed) */}
        {view.unlockedBadges.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 5}>
            <CompletedSummary
              count={view.unlockedBadges.length}
              noun="unlocked"
              expanded={unlockedExpanded}
              onToggle={() => {
                tapFeedback();
                setUnlockedExpanded((v) => !v);
              }}
            >
              {view.unlockedBadges.map((b) => (
                <View key={b.id} style={styles.archiveItem}>
                  <Ionicons name="checkmark-circle" size={16} color="#0A8F60" />
                  <Text style={styles.archiveText} numberOfLines={1}>
                    {b.title}
                  </Text>
                </View>
              ))}
            </CompletedSummary>
          </FadeSlideIn>
        ) : null}

        {/* Locked archive (collapsed) — real requirements */}
        {view.lockedBadges.length > 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 6}>
            <View style={styles.lockedWrap}>
              <Pressable
                onPress={() => {
                  tapFeedback();
                  setLockedExpanded((v) => !v);
                }}
                style={styles.lockedHeader}
                accessibilityRole="button"
                accessibilityLabel={`${view.lockedBadges.length} locked`}
                accessibilityHint={lockedExpanded ? "Collapse locked" : "Expand locked"}
              >
                <View style={styles.lockedIcon}>
                  <Ionicons name="lock-closed" size={14} color={colors.textDim} />
                </View>
                <Text style={styles.lockedTitle}>{view.lockedBadges.length} locked</Text>
                <Ionicons
                  name={lockedExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.textFaint}
                />
              </Pressable>
              {lockedExpanded ? (
                <View style={styles.rowList}>
                  {view.lockedBadges.map((b) => (
                    <View key={b.id} style={styles.lockedRow}>
                      <Ionicons name="lock-closed-outline" size={15} color={colors.textFaint} />
                      <View style={styles.lockedRowBody}>
                        <Text style={styles.lockedRowTitle} numberOfLines={1}>
                          {b.title}
                        </Text>
                        <Text style={styles.lockedRowReq} numberOfLines={1}>
                          {lockedRequirement(b)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footerNote}>
          Badges are local previews. They do not affect rewards, ownership, or
          on-chain status.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function BadgeRow({ badge }: { badge: Badge }) {
  const pct = Math.round((badge.current / badge.target) * 100);
  return (
    <View
      style={styles.badgeRow}
      accessibilityLabel={`${badge.title}, ${badge.current} of ${badge.target}. ${badge.description}`}
    >
      <View style={styles.badgeIcon}>
        <Ionicons name={badge.icon as IoniconName} size={17} color={palette.baseBlue} />
      </View>
      <View style={styles.badgeBody}>
        <View style={styles.badgeTitleRow}>
          <Text style={styles.badgeTitle} numberOfLines={1}>
            {badge.title}
          </Text>
          <Text style={styles.badgeProgress}>
            {badge.current}/{badge.target}
          </Text>
        </View>
        <View style={styles.badgeBarTrack}>
          <View style={[styles.badgeBarFill, { width: `${pct}%` }]} />
        </View>
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
  heroTitle: { ...type.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
  chipRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  chipText: { fontSize: 12, fontWeight: "700" },

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

  nearestCard: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: `${palette.baseBlue}22`,
    padding: spacing.lg,
    ...shadows.card,
  },
  nearestIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  nearestBody: { flex: 1, gap: 3 },
  nearestKicker: { ...type.kicker, fontSize: 10.5, color: palette.baseBlue },
  nearestTitle: { ...type.heading, fontSize: 15.5 },
  nearestDesc: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  nearestBarTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    marginTop: 4,
  },
  nearestBarFill: { height: 6, borderRadius: radius.pill, backgroundColor: palette.baseBlue },
  nearestProgress: { ...type.mono, fontSize: 12.5, color: colors.textDim },

  section: { gap: spacing.sm },
  sectionLabel: { ...type.kicker, color: colors.textFaint },
  rowList: { gap: spacing.sm },

  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  badgeIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: `${palette.baseBlue}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeBody: { flex: 1, gap: 5 },
  badgeTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  badgeTitle: { ...type.heading, fontSize: 14, flexShrink: 1 },
  badgeProgress: { ...type.mono, fontSize: 11.5, color: colors.textFaint },
  badgeBarTrack: { height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  badgeBarFill: { height: 5, borderRadius: radius.pill, backgroundColor: palette.baseBlue },

  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 52,
    ...shadows.card,
  },
  groupIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  groupName: { ...type.heading, fontSize: 14, flex: 1 },
  groupCount: { ...type.mono, fontSize: 12.5, color: colors.textDim },

  archiveItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  archiveText: { ...type.caption, fontSize: 12.5, color: colors.text, flex: 1 },

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
  lockedRowReq: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
