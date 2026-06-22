import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { zoneStatus } from "@/lib/territory";
import {
  buildCollections,
  type Badge,
  type BadgeCollection,
} from "@/lib/zoneCollections";
import type { IoniconName } from "@/types";

export default function CollectionsScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);

  const overview = useMemo(() => {
    const atRiskOrWorse = zones.filter((z) => zoneStatus(z).health !== "yours").length;
    const fortifyCount = zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0);
    const cleanRoutes = routeTrustHistory.filter((r) => r.riskFlags.length === 0).length;
    const hasStrongTrust = routeTrustHistory.some((r) => r.trustLabel === "Strong");
    return buildCollections({
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
  }, [zones, timesDefended, selectedClubId, routeTrustHistory, viewedRoutePassport, viewedRouteProof]);

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
            <Text style={styles.heroTitle}>Local badges for your captured territory journey.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.chip, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="ribbon-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.chipText, { color: palette.deedViolet }]}>Local preview</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.textDim} />
                <Text style={[styles.chipText, { color: colors.textDim }]}>No rewards</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Progress card */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.card}>
            <View style={styles.progressHead}>
              <Text style={styles.progressTitle}>Badges unlocked</Text>
              <Text style={styles.progressCount}>
                {overview.unlocked}/{overview.total}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${overview.completionPct}%` }]} />
            </View>
            <Text style={styles.progressNext}>
              {overview.nextBadge
                ? `Next · ${overview.nextBadge.title} (${overview.nextBadge.current}/${overview.nextBadge.target})`
                : "All local badges unlocked — strengthen your territory."}
            </Text>
          </View>
        </FadeSlideIn>

        {/* Collection groups */}
        {overview.collections.map((col, i) => (
          <FadeSlideIn key={col.name} delay={STAGGER_MS * (2 + Math.min(i, 5))}>
            <CollectionGroup collection={col} />
          </FadeSlideIn>
        ))}

        <Text style={styles.footerNote}>
          Badges are local previews. They do not affect rewards, ownership, or
          on-chain status.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function CollectionGroup({ collection }: { collection: BadgeCollection }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <View style={[styles.groupIcon, { backgroundColor: `${collection.accent}14` }]}>
          <Ionicons name={collection.icon as IoniconName} size={16} color={collection.accent} />
        </View>
        <Text style={styles.groupName}>{collection.name}</Text>
        <Text style={styles.groupCount}>
          {collection.unlocked}/{collection.total}
        </Text>
      </View>
      <View style={styles.badgeList}>
        {collection.badges.map((b) => (
          <BadgeCard key={b.id} badge={b} accent={collection.accent} />
        ))}
      </View>
    </View>
  );
}

function BadgeCard({ badge, accent }: { badge: Badge; accent: string }) {
  const unlocked = badge.status === "unlocked";
  const inProgress = badge.status === "in-progress";
  const iconColor = unlocked ? accent : inProgress ? colors.textDim : colors.textFaint;
  const pct = Math.round((badge.current / badge.target) * 100);
  return (
    <View style={[styles.badge, unlocked ? { backgroundColor: `${accent}0D` } : null]}>
      <View style={[styles.badgeIcon, { backgroundColor: unlocked ? `${accent}1A` : colors.surfaceAlt }]}>
        <Ionicons name={badge.icon as IoniconName} size={18} color={iconColor} />
      </View>
      <View style={styles.badgeBody}>
        <View style={styles.badgeTitleRow}>
          <Text style={[styles.badgeTitle, !unlocked && !inProgress ? styles.badgeTitleLocked : null]} numberOfLines={1}>
            {badge.title}
          </Text>
          {unlocked ? (
            <Ionicons name="checkmark-circle" size={16} color={accent} />
          ) : (
            <Text style={styles.badgeProgressText}>
              {badge.current}/{badge.target}
            </Text>
          )}
        </View>
        <Text style={styles.badgeDesc}>{badge.description}</Text>
        {!unlocked ? (
          <View style={styles.badgeBarTrack}>
            <View style={[styles.badgeBarFill, { width: `${pct}%`, backgroundColor: inProgress ? accent : colors.dustGray }]} />
          </View>
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
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  chipText: { fontSize: 12, fontWeight: "700" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressTitle: { ...type.heading, fontSize: 15 },
  progressCount: { ...type.title, fontSize: 16, color: colors.textDim },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill, backgroundColor: palette.moveGold },
  progressNext: { ...type.caption, fontSize: 12.5, color: colors.textDim },

  group: { gap: spacing.sm },
  groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  groupIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  groupName: { ...type.heading, fontSize: 15, flex: 1 },
  groupCount: { ...type.mono, fontSize: 12, color: colors.textFaint },

  badgeList: { gap: spacing.sm },
  badge: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  badgeIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeBody: { flex: 1, gap: 4 },
  badgeTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badgeTitle: { ...type.heading, fontSize: 14, flex: 1 },
  badgeTitleLocked: { color: colors.textDim },
  badgeProgressText: { ...type.mono, fontSize: 11, color: colors.textFaint },
  badgeDesc: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  badgeBarTrack: { height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden", marginTop: 2 },
  badgeBarFill: { height: 5, borderRadius: radius.pill },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
