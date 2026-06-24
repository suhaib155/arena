import { useMemo } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import {
  buildWeeklyRecap,
  recapFormat,
  type MomentumTone,
} from "@/lib/weeklyRecap";
import type { IoniconName } from "@/types";
import { tapFeedback, successFeedback } from "@/lib/haptics";

const MOMENTUM_TINT: Record<MomentumTone, string> = {
  surging: palette.pulseGreen,
  climbing: palette.baseBlue,
  building: palette.moveGold,
  warming: palette.moveGold,
  resting: colors.textFaint,
};

/**
 * Weekly Recap — a local, read-only reflection of recent movement and territory
 * progress (rolling 7-day window). Derived on demand from existing local state;
 * no backend, network, chain, wallet, push notifications, or background work.
 * Share is text-only via the OS share sheet (scalar stats only — no raw GPS,
 * coordinates, route path, or location). It affects nothing.
 */
export default function WeeklyRecapScreen() {
  const router = useRouter();
  const history = useGameStore((s) => s.history);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const zones = useGameStore((s) => s.zones);
  const streak = useGameStore((s) => s.streak);
  const selectedClub = getClubById(useGameStore((s) => s.selectedClubId));

  const recap = useMemo(
    () =>
      buildWeeklyRecap({
        history,
        routeTrustHistory,
        zones,
        streak,
        clubName: selectedClub?.name ?? null,
      }),
    [history, routeTrustHistory, zones, streak, selectedClub],
  );

  const onShare = async () => {
    tapFeedback();
    try {
      await Share.share({ message: recap.shareText });
      successFeedback();
    } catch {
      /* user dismissed the share sheet — no-op */
    }
  };

  const momentumTint = MOMENTUM_TINT[recap.momentumTone];

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Weekly Recap</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{recap.weekLabel} · {recap.rangeLabel}</Text>
            <Text style={styles.heroTitle}>Your movement this week.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="phone-portrait-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>In-app only</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="eye-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}14` }]}>
                <Ionicons name="lock-closed-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No raw GPS</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {recap.hasActivity ? (
          <>
            {/* Momentum */}
            <FadeSlideIn delay={STAGGER_MS}>
              <View style={styles.momentumCard}>
                <View style={styles.momentumText}>
                  <Text style={styles.momentumKicker}>Momentum</Text>
                  <Text style={[styles.momentumLabel, { color: momentumTint }]}>
                    {recap.momentumLabel}
                  </Text>
                  <Text style={styles.momentumNote}>{recap.topAchievement}</Text>
                </View>
                <View style={styles.momentumScoreWrap}>
                  <Text style={[styles.momentumScore, { color: momentumTint }]}>
                    {recap.momentum}
                  </Text>
                  <Text style={styles.momentumOutOf}>/ 100</Text>
                </View>
              </View>
            </FadeSlideIn>

            {/* Movement totals */}
            <FadeSlideIn delay={STAGGER_MS * 2}>
              <Text style={styles.sectionLabel}>Movement</Text>
              <View style={styles.statGrid}>
                <StatTile
                  icon="navigate-outline"
                  value={`${recap.routes}`}
                  label={`route${recap.routes === 1 ? "" : "s"}`}
                  tint={palette.baseBlue}
                />
                <StatTile
                  icon="walk-outline"
                  value={recapFormat.fmtKm(recap.distanceMeters)}
                  label="distance"
                  tint={palette.pulseGreen}
                />
                <StatTile
                  icon="time-outline"
                  value={recapFormat.fmtDuration(recap.durationSeconds)}
                  label="active time"
                  tint={palette.deedViolet}
                />
                <StatTile
                  icon="flame-outline"
                  value={`+${recap.xpGained}`}
                  label="XP gained"
                  tint="#B07908"
                />
              </View>
            </FadeSlideIn>

            {/* Territory totals */}
            <FadeSlideIn delay={STAGGER_MS * 3}>
              <Text style={styles.sectionLabel}>Territory</Text>
              <View style={styles.statGrid}>
                <StatTile
                  icon="add-circle-outline"
                  value={`${recap.zonesCaptured}`}
                  label="captured"
                  tint={palette.pulseGreen}
                />
                <StatTile
                  icon="shield-checkmark-outline"
                  value={`${recap.defends}`}
                  label="defends"
                  tint={palette.baseBlue}
                />
                <StatTile
                  icon="grid-outline"
                  value={`${recap.totalZones}`}
                  label="zones held"
                  tint={colors.text}
                />
                <StatTile
                  icon="warning-outline"
                  value={`${recap.atRiskZones}`}
                  label="need defending"
                  tint={recap.atRiskZones > 0 ? palette.heatCoral : colors.textFaint}
                />
              </View>
            </FadeSlideIn>

            {/* Route trust */}
            {recap.bestTrustScore != null ? (
              <FadeSlideIn delay={STAGGER_MS * 4}>
                <View style={styles.trustCard}>
                  <View style={styles.trustIcon}>
                    <Ionicons name="ribbon-outline" size={18} color={palette.moveGold} />
                  </View>
                  <View style={styles.trustBody}>
                    <Text style={styles.trustName}>Best route trust</Text>
                    <Text style={styles.trustNote}>
                      {recap.bestTrustLabel ?? "—"}
                      {recap.averageTrustScore != null
                        ? ` · avg ${recap.averageTrustScore} this week`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.trustScore}>{recap.bestTrustScore}</Text>
                </View>
              </FadeSlideIn>
            ) : null}

            {/* Streak + club + next focus */}
            <FadeSlideIn delay={STAGGER_MS * 5}>
              <View style={styles.focusCard}>
                <View style={styles.focusTopRow}>
                  <View style={styles.streakPill}>
                    <Ionicons name="flame" size={14} color={palette.heatCoral} />
                    <Text style={styles.streakPillText}>{recap.streak}-day streak</Text>
                  </View>
                  {recap.clubName ? (
                    <View style={styles.clubPill}>
                      <Hexagon size={16} color="#C9EEDE" coreColor={palette.pulseGreen} />
                      <Text style={styles.clubPillText} numberOfLines={1}>{recap.clubName}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.focusRow}>
                  <Ionicons name="trail-sign-outline" size={16} color={colors.primary} />
                  <Text style={styles.focusText}>Next · {recap.nextFocus}</Text>
                </View>
              </View>
            </FadeSlideIn>
          </>
        ) : (
          <FadeSlideIn delay={STAGGER_MS}>
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={30} color={colors.primary} />
              <Text style={styles.emptyTitle}>No movement logged yet this week</Text>
              <Text style={styles.emptyText}>
                Start a move and save a route — your weekly recap fills in as you
                go.
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
        )}

        {recap.hasActivity ? (
          <FadeSlideIn delay={STAGGER_MS * 6}>
            <View style={styles.shareWrap}>
              <Button label="Share recap" icon="share-outline" onPress={onShare} />
            </View>
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footerNote}>
          A local reflection of your recent movement. It does not affect XP,
          rewards, ownership, or on-chain status.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function StatTile({
  icon,
  value,
  label,
  tint,
}: {
  icon: IoniconName;
  value: string;
  label: string;
  tint: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statTileIcon, { backgroundColor: `${tint}14` }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
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

  momentumCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  momentumText: { flex: 1, gap: 2 },
  momentumKicker: { ...type.kicker, color: colors.textFaint },
  momentumLabel: { ...type.title, fontSize: 22 },
  momentumNote: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  momentumScoreWrap: { alignItems: "flex-end" },
  momentumScore: { ...type.display, fontSize: 34, fontVariant: ["tabular-nums"] },
  momentumOutOf: { ...type.caption, fontSize: 11, color: colors.textFaint },

  sectionLabel: { ...type.kicker, color: colors.textFaint, marginBottom: -spacing.sm },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statTile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    ...shadows.card,
  },
  statTileIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  statTileValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  statTileLabel: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  trustCard: {
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
    backgroundColor: `${palette.moveGold}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  trustBody: { flex: 1, gap: 2 },
  trustName: { ...type.heading, fontSize: 15 },
  trustNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  trustScore: { ...type.title, fontSize: 22, color: palette.moveGold },

  focusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  focusTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  streakPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: `${palette.heatCoral}14`,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  streakPillText: { ...type.caption, fontSize: 12, fontWeight: "700", color: "#C2492E" },
  clubPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    flexShrink: 1,
  },
  clubPillText: { ...type.caption, fontSize: 12, fontWeight: "700", color: colors.text, flexShrink: 1 },
  focusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  focusText: { ...type.caption, fontSize: 13, color: colors.text, flex: 1 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: { ...type.heading, fontSize: 16, textAlign: "center", marginTop: spacing.xs },
  emptyText: { ...type.caption, fontSize: 13, lineHeight: 18, color: colors.textDim, textAlign: "center" },
  emptyBtn: { alignSelf: "stretch", marginTop: spacing.sm },

  shareWrap: { gap: spacing.sm },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
