import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { tapFeedback } from "@/lib/haptics";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { formatDistance, formatDuration } from "@/lib/geo";
import { trustTone, type RouteTrustRecord, type TrustTone } from "@/lib/routeTrust";

function toneColor(tone: TrustTone): string {
  switch (tone) {
    case "strong":
      return palette.pulseGreen;
    case "good":
      return palette.baseBlue;
    case "caution":
      return palette.moveGold;
    default:
      return palette.dustGray;
  }
}

function toneText(tone: TrustTone): string {
  switch (tone) {
    case "strong":
      return "#0A8F60";
    case "good":
      return palette.baseBlue;
    case "caution":
      return "#B07908";
    default:
      return colors.textDim;
  }
}

const OUTCOME_LABEL: Record<RouteTrustRecord["routeOutcome"], string> = {
  saved: "Saved",
  captured: "Captured",
  defended: "Defended",
  "summary-only": "Review",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

/**
 * Route Review — local, read-only history of recent Route Trust summaries.
 * Summary records only: no raw GPS, no coordinates, no path. Nothing here
 * affects rewards, XP, capture, defend, or ownership.
 */
export default function RouteReviewHistoryScreen() {
  const router = useRouter();
  const history = useGameStore((s) => s.routeTrustHistory);

  const count = history.length;
  const avg =
    count > 0
      ? Math.round(history.reduce((sum, r) => sum + r.trustScore, 0) / count)
      : 0;
  const cleanCount = history.filter((r) => r.riskFlags.length === 0).length;
  const needsSignalCount = history.filter(
    (r) => r.trustLabel === "Needs more signal",
  ).length;
  const recentLabel = history[0]?.trustLabel ?? "—";

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Route Review</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Route Review</Text>
            <Text style={styles.heroTitle}>
              Local trust summaries help you understand GPS quality.
            </Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="phone-portrait-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local only</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}1A` }]}>
                <Ionicons name="location-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No raw GPS</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Passport CTA */}
        <FadeSlideIn delay={STAGGER_MS / 2}>
          <ScalePress
            to={0.98}
            style={styles.passportCta}
            onPress={() => {
              tapFeedback();
              router.navigate("/route/passport");
            }}
          >
            <View style={styles.passportIcon}>
              <Ionicons name="shield-half-outline" size={18} color={palette.deedViolet} />
            </View>
            <View style={styles.passportBody}>
              <Text style={styles.passportName}>Route Signal Passport</Text>
              <Text style={styles.passportNote}>See your readiness preview & trend</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </ScalePress>
        </FadeSlideIn>

        {count === 0 ? (
          <FadeSlideIn delay={STAGGER_MS}>
            <View style={styles.emptyCard}>
              <Ionicons name="footsteps-outline" size={28} color={colors.textFaint} />
              <Text style={styles.emptyText}>
                Complete and save a movement session to build your local review
                history.
              </Text>
            </View>
          </FadeSlideIn>
        ) : (
          <>
            {/* Trend card */}
            <FadeSlideIn delay={STAGGER_MS}>
              <View style={styles.trendCard}>
                <Text style={styles.sectionTitle}>GPS quality trend</Text>
                <View style={styles.trendRow}>
                  <View style={styles.trendStat}>
                    <Text style={styles.trendValue}>{avg}</Text>
                    <Text style={styles.trendLabel}>avg score</Text>
                  </View>
                  <View style={styles.trendDivider} />
                  <View style={styles.trendStat}>
                    <Text style={[styles.trendValue, { color: "#0A8F60" }]}>{cleanCount}</Text>
                    <Text style={styles.trendLabel}>clean</Text>
                  </View>
                  <View style={styles.trendDivider} />
                  <View style={styles.trendStat}>
                    <Text style={[styles.trendValue, { color: "#B07908" }]}>
                      {needsSignalCount}
                    </Text>
                    <Text style={styles.trendLabel}>needs signal</Text>
                  </View>
                </View>
                <Text style={styles.trendRecent}>Most recent · {recentLabel}</Text>
              </View>
            </FadeSlideIn>

            {/* Recent list (newest first) */}
            <FadeSlideIn delay={STAGGER_MS * 2}>
              <Text style={styles.listHeading}>
                Recent routes <Text style={styles.listCount}>{count}</Text>
              </Text>
            </FadeSlideIn>
            <View style={styles.list}>
              {history.map((rec, i) => (
                <FadeSlideIn key={rec.id} delay={STAGGER_MS * (3 + Math.min(i, 6))}>
                  <ReviewRow
                    rec={rec}
                    onPress={() => {
                      tapFeedback();
                      router.push({
                        pathname: "/route/proof",
                        params: {
                          score: String(rec.trustScore),
                          label: rec.trustLabel,
                          distanceMeters: String(rec.distanceMeters),
                          durationSeconds: String(rec.durationSeconds),
                          outcome: rec.routeOutcome,
                          zones: String(rec.zoneCountTouched),
                          defended: String(rec.defendedCount),
                          at: rec.createdAt,
                        },
                      });
                    }}
                  />
                </FadeSlideIn>
              ))}
            </View>
          </>
        )}

        <Text style={styles.footerNote}>
          Review only · no raw GPS saved · does not affect rewards or ownership.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function ReviewRow({ rec, onPress }: { rec: RouteTrustRecord; onPress: () => void }) {
  const tone = trustTone(rec.trustLabel as Parameters<typeof trustTone>[0]);
  return (
    <ScalePress to={0.99} style={styles.row} onPress={onPress}>
      <View style={[styles.scoreBubble, { backgroundColor: `${toneColor(tone)}1A` }]}>
        <Text style={[styles.scoreBubbleText, { color: toneText(tone) }]}>
          {rec.trustScore}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowLabel, { color: toneText(tone) }]}>{rec.trustLabel}</Text>
          <View style={styles.outcomeChip}>
            <Text style={styles.outcomeText}>{OUTCOME_LABEL[rec.routeOutcome]}</Text>
          </View>
        </View>
        <Text style={styles.rowMeta}>
          {formatWhen(rec.createdAt)} · {formatDistance(rec.distanceMeters)} ·{" "}
          {formatDuration(rec.durationSeconds * 1000)}
        </Text>
        {rec.riskFlags.length > 0 ? (
          <View style={styles.chipRow}>
            {rec.riskFlags.map((f) => (
              <View key={f} style={styles.riskChip}>
                <Text style={styles.riskChipText}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
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

  passportCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  passportIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  passportBody: { flex: 1, gap: 2 },
  passportName: { ...type.heading, fontSize: 14.5 },
  passportNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
    ...shadows.card,
  },
  emptyText: { ...type.body, fontSize: 13.5, textAlign: "center", color: colors.textDim },

  trendCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { ...type.heading, fontSize: 15 },
  trendRow: { flexDirection: "row", alignItems: "center" },
  trendStat: { flex: 1, alignItems: "center", gap: 2 },
  trendValue: { ...type.title, fontSize: 24, fontVariant: ["tabular-nums"] },
  trendLabel: { ...type.caption, fontSize: 11 },
  trendDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.surfaceAlt },
  trendRecent: { ...type.mono, fontSize: 11.5, color: colors.textFaint, textAlign: "center" },

  listHeading: { ...type.heading, fontSize: 18 },
  listCount: { ...type.title, fontSize: 15, color: colors.textFaint },
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
  scoreBubble: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreBubbleText: { ...type.title, fontSize: 17, fontVariant: ["tabular-nums"] },
  rowBody: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowLabel: { ...type.heading, fontSize: 14.5, flexShrink: 1 },
  outcomeChip: {
    backgroundColor: `${palette.baseBlue}12`,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  outcomeText: { fontSize: 10.5, fontWeight: "800", color: palette.baseBlue },
  rowMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 },
  riskChip: {
    backgroundColor: `${palette.heatCoral}1A`,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  riskChipText: { fontSize: 10, fontWeight: "700", color: "#C2492E" },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
