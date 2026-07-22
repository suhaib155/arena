import { useMemo } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { MovementMetric } from "@/components/MovementMetric";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { ScalePress } from "@/components/ScalePress";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getClubById } from "@/data/clubs";
import { buildWeeklyRecap, type MomentumTone } from "@/lib/weeklyRecap";
import { buildRecapView } from "@/lib/recapView";
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
 * Weekly Recap — a local, editorial reflection of the movement week (rolling
 * 7-day window). Leads with one dominant real metric, supporting stats, the
 * week's story, and a single next action. No fabricated previous-week
 * comparison — the model has none, so none is shown. Logic is unchanged
 * (buildWeeklyRecap); share is text-only, scalar stats, no raw GPS.
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
  const view = useMemo(() => buildRecapView(recap), [recap]);

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
            <Text style={styles.heroKicker}>
              {recap.weekLabel} · {recap.rangeLabel}
            </Text>
            <Text style={styles.heroTitle}>Your week in motion.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}14` }]}>
                <Ionicons name="lock-closed-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No raw GPS</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {view.hasActivity && view.dominant ? (
          <>
            {/* One dominant metric */}
            <FadeSlideIn delay={STAGGER_MS}>
              <View style={styles.dominantCard}>
                <MovementMetric value={view.dominant.value} label={view.dominant.label} size="hero" tint={palette.baseBlue} />
                {view.supporting.length > 0 ? (
                  <View style={styles.supportingRow}>
                    {view.supporting.map((s, i) => (
                      <View key={s.label} style={styles.supportingWrap}>
                        {i > 0 ? <View style={styles.supportingDivider} /> : null}
                        <MovementMetric value={s.value} label={s.label} />
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </FadeSlideIn>

            {/* The week's story */}
            <FadeSlideIn delay={STAGGER_MS * 2}>
              <View style={styles.storyCard}>
                <View style={styles.storyIcon}>
                  <Ionicons name="sparkles-outline" size={18} color={palette.moveGold} />
                </View>
                <View style={styles.storyBody}>
                  <Text style={styles.storyKicker}>This week</Text>
                  <Text style={styles.storyTitle}>{view.topAchievement}</Text>
                </View>
              </View>
            </FadeSlideIn>

            {/* Territory change (only real values) */}
            <FadeSlideIn delay={STAGGER_MS * 3}>
              <View style={styles.territoryRow}>
                <TerritoryStat value={recap.zonesCaptured} label="captured" tint={palette.pulseGreen} />
                <View style={styles.tStatDivider} />
                <TerritoryStat value={recap.totalZones} label="held" tint={colors.text} />
                <View style={styles.tStatDivider} />
                <TerritoryStat
                  value={recap.atRiskZones}
                  label="need defence"
                  tint={recap.atRiskZones > 0 ? palette.heatCoral : colors.textFaint}
                />
              </View>
            </FadeSlideIn>

            {/* Momentum + best trust (only when real) */}
            <FadeSlideIn delay={STAGGER_MS * 4}>
              <View style={styles.momentumCard}>
                <View style={styles.momentumText}>
                  <Text style={styles.momentumKicker}>Momentum</Text>
                  <Text style={[styles.momentumLabel, { color: momentumTint }]}>{recap.momentumLabel}</Text>
                  {recap.bestTrustScore != null ? (
                    <Text style={styles.momentumNote}>
                      Best route trust · {recap.bestTrustLabel ?? "—"} {recap.bestTrustScore}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.momentumScoreWrap}>
                  <Text style={[styles.momentumScore, { color: momentumTint }]}>{recap.momentum}</Text>
                  <Text style={styles.momentumOutOf}>/ 100</Text>
                </View>
              </View>
            </FadeSlideIn>

            {/* Streak + club + single next action */}
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
                      <Text style={styles.clubPillText} numberOfLines={1}>
                        {recap.clubName}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.focusRow}>
                  <Ionicons name="trail-sign-outline" size={16} color={colors.primary} />
                  <Text style={styles.focusText}>Next · {view.nextFocus}</Text>
                </View>
              </View>
            </FadeSlideIn>

            <FadeSlideIn delay={STAGGER_MS * 6}>
              <Button label="Share recap" icon="share-outline" onPress={onShare} />
            </FadeSlideIn>
          </>
        ) : (
          /* Confident editorial empty state */
          <FadeSlideIn delay={STAGGER_MS}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="pulse-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Your week hasn't started moving</Text>
              <Text style={styles.emptyText}>
                Save a route and your recap builds itself — distance, territory,
                and momentum, all from real movement.
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

        {/* Season objectives link (kept for both states) */}
        <FadeSlideIn delay={STAGGER_MS * 7}>
          <ScalePress
            to={0.98}
            style={styles.objectivesCta}
            onPress={() => {
              tapFeedback();
              router.push("/season-objectives");
            }}
            accessibilityRole="button"
            accessibilityLabel="Season Objectives. Local goals for your territory week"
          >
            <View style={styles.objectivesCtaIcon}>
              <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.objectivesCtaBody}>
              <Text style={styles.objectivesCtaName}>Season Objectives</Text>
              <Text style={styles.objectivesCtaNote}>Local goals for your territory week</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          A local reflection of your recent movement. It does not affect XP,
          rewards, ownership, or on-chain status.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function TerritoryStat({ value, label, tint }: { value: number; label: string; tint: string }) {
  return (
    <View style={styles.tStat} accessibilityLabel={`${value} ${label}`}>
      <Text style={[styles.tStatValue, { color: tint }]}>{value}</Text>
      <Text style={styles.tStatLabel}>{label}</Text>
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

  dominantCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    ...shadows.float,
  },
  supportingRow: { flexDirection: "row", alignItems: "center" },
  supportingWrap: { flex: 1, flexDirection: "row", alignItems: "center" },
  supportingDivider: { width: 1, height: 30, backgroundColor: colors.surfaceAlt },

  storyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  storyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: `${palette.moveGold}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  storyBody: { flex: 1, gap: 2 },
  storyKicker: { ...type.kicker, fontSize: 10.5, color: colors.textFaint },
  storyTitle: { ...type.heading, fontSize: 15.5 },

  territoryRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    ...shadows.card,
  },
  tStat: { flex: 1, alignItems: "center", gap: 2 },
  tStatValue: { ...type.title, fontSize: 22, fontVariant: ["tabular-nums"] },
  tStatLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  tStatDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },

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
  momentumNote: { ...type.caption, fontSize: 12, color: colors.textDim },
  momentumScoreWrap: { alignItems: "flex-end" },
  momentumScore: { ...type.display, fontSize: 34, fontVariant: ["tabular-nums"] },
  momentumOutOf: { ...type.caption, fontSize: 11, color: colors.textFaint },

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

  objectivesCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  objectivesCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  objectivesCtaBody: { flex: 1, gap: 2 },
  objectivesCtaName: { ...type.heading, fontSize: 15 },
  objectivesCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
