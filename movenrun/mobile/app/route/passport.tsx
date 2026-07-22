import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { StatusPill } from "@/components/StatusPill";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { computePassport, readinessTone, type ReadinessTone } from "@/lib/routePassport";
import { buildPassportStamps, type PassportStamp } from "@/lib/passportEntries";
import { tapFeedback } from "@/lib/haptics";

function toneColor(tone: ReadinessTone): { bar: string; text: string } {
  switch (tone) {
    case "strong":
      return { bar: palette.pulseGreen, text: "#0A8F60" };
    case "clean":
      return { bar: palette.baseBlue, text: palette.baseBlue };
    case "building":
      return { bar: palette.moveGold, text: "#B07908" };
    default:
      return { bar: palette.dustGray, text: colors.textDim };
  }
}

/**
 * Route Passport — a local, on-device movement record and GPS-quality readiness
 * preview, derived from persisted route summaries. It is NOT government/legal
 * identity, blockchain finality, public/remote verification, or permanent
 * ownership — it is explicitly a local preview. No raw GPS, coordinates, or
 * paths are shown or stored; it affects no rewards, capture, or ownership.
 */
export default function RoutePassportScreen() {
  const router = useRouter();
  const history = useGameStore((s) => s.routeTrustHistory);
  const zonesOwned = useGameStore((s) => s.zones.length);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const markViewedPassport = useGameStore((s) => s.markViewedPassport);
  useEffect(() => {
    markViewedPassport();
  }, [markViewedPassport]);

  const p = useMemo(
    () => computePassport(history, { zonesOwned, timesDefended }),
    [history, zonesOwned, timesDefended],
  );
  const stamps = useMemo(() => buildPassportStamps(history), [history]);
  const tone = toneColor(readinessTone(p.readinessLabel));
  const hasRoutes = p.reviewedRouteCount > 0;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Passport</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Identity header */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Route Signal Passport</Text>
            <Text style={styles.heroTitle}>Your local movement record.</Text>
            <View style={styles.pillRow}>
              <StatusPill icon="eye-outline" label="Local preview" tone="primary" />
              <StatusPill icon="phone-portrait-outline" label="On-device" tone="neutral" />
              <StatusPill icon="lock-closed-outline" label="No raw GPS" tone="success" />
            </View>
          </View>
        </FadeSlideIn>

        {/* Readiness summary */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.card}>
            <View style={styles.readyRow}>
              <View style={styles.readyScoreWrap}>
                <Text style={[styles.readyScore, { color: tone.text }]}>{p.readinessScore}</Text>
                <Text style={styles.readyScoreMax}>/100</Text>
              </View>
              <View style={styles.readyLabelWrap}>
                <Text style={[styles.readyLabel, { color: tone.text }]}>{p.readinessLabel}</Text>
                <Text style={styles.readyExplain}>{p.explanation}</Text>
              </View>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${p.readinessScore}%`, backgroundColor: tone.bar }]} />
            </View>
            <Text style={styles.readyHint}>Local route reputation · not official verification</Text>
          </View>
        </FadeSlideIn>

        {/* Recorded route summary */}
        {hasRoutes ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Recorded routes</Text>
              <View style={styles.statsRow}>
                <Stat value={String(p.reviewedRouteCount)} label="routes" />
                <View style={styles.statDivider} />
                <Stat value={String(p.averageTrustScore)} label="avg trust" tint="#0A8F60" />
                <View style={styles.statDivider} />
                <Stat value={String(p.cleanRouteStreak)} label="clean streak" />
                <View style={styles.statDivider} />
                <Stat
                  value={String(p.recentRiskCount)}
                  label="recent risks"
                  tint={p.recentRiskCount > 0 ? "#C2492E" : undefined}
                />
              </View>
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Recent route stamps */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Recent route stamps</Text>
            {stamps.length > 0 ? (
              <View style={styles.rowList}>
                {stamps.map((s) => (
                  <StampRow key={s.id} stamp={s} />
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="footsteps-outline" size={26} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>No routes recorded yet</Text>
                <Text style={styles.emptyText}>
                  Save a real movement session and your passport starts stamping —
                  date, distance, trust, and territory, all on-device.
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
            )}
          </View>
        </FadeSlideIn>

        {/* Readiness checklist */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Readiness checklist</Text>
            {p.checklist.map((item) => (
              <View key={item.label} style={styles.checkRow}>
                <Ionicons
                  name={item.done ? "checkmark-circle" : "ellipse-outline"}
                  size={18}
                  color={item.done ? palette.pulseGreen : colors.textFaint}
                />
                <Text style={[styles.checkText, item.done ? styles.checkTextDone : null]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        </FadeSlideIn>

        {/* Privacy */}
        <FadeSlideIn delay={STAGGER_MS * 5}>
          <View style={[styles.card, styles.privacyCard]}>
            <View style={styles.privacyHead}>
              <Ionicons name="lock-closed-outline" size={16} color={palette.baseBlue} />
              <Text style={styles.privacyTitle}>Your data</Text>
            </View>
            <Text style={styles.privacyLine}>Only summary scores are saved.</Text>
            <Text style={styles.privacyLine}>Raw GPS and paths are never stored.</Text>
            <Text style={styles.privacyLine}>Nothing is sent anywhere.</Text>
          </View>
        </FadeSlideIn>

        {hasRoutes ? (
          <FadeSlideIn delay={STAGGER_MS * 6}>
            <Button
              label="View Route Review History"
              icon="list-outline"
              variant="secondary"
              onPress={() => {
                tapFeedback();
                router.navigate("/route/review-history");
              }}
            />
          </FadeSlideIn>
        ) : null}

        <Text style={styles.footerNote}>
          Preview only · local signal · not official verification, not on-chain.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function StampRow({ stamp }: { stamp: PassportStamp }) {
  const meta = [stamp.distanceLabel, stamp.durationLabel, stamp.territoryLabel]
    .filter((x): x is string => Boolean(x))
    .join(" · ");
  return (
    <View
      style={styles.stampRow}
      accessibilityLabel={`${stamp.dateLabel}, ${stamp.activity}, trust ${stamp.trustLabel}. ${meta}`}
    >
      <View style={styles.stampDate}>
        <Ionicons name="footsteps-outline" size={16} color={palette.baseBlue} />
      </View>
      <View style={styles.stampBody}>
        <View style={styles.stampTitleRow}>
          <Text style={styles.stampActivity}>{stamp.activity}</Text>
          <Text style={styles.stampDateText}>{stamp.dateLabel}</Text>
        </View>
        <Text style={styles.stampMeta} numberOfLines={1}>
          {meta.length > 0 ? meta : "Route recorded"}
        </Text>
      </View>
      <View style={styles.stampTrust}>
        <Text style={styles.stampTrustText}>{stamp.trustLabel}</Text>
      </View>
    </View>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  heroTitle: { ...type.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6 },
  pillRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { ...type.heading, fontSize: 15 },

  readyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  readyScoreWrap: { flexDirection: "row", alignItems: "baseline" },
  readyScore: { ...type.title, fontSize: 36, fontVariant: ["tabular-nums"] },
  readyScoreMax: { ...type.caption, fontSize: 13, color: colors.textFaint },
  readyLabelWrap: { flex: 1, gap: 2 },
  readyLabel: { ...type.heading, fontSize: 16 },
  readyExplain: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill },
  readyHint: { ...type.mono, fontSize: 11, color: colors.textFaint },

  statsRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 20, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  statDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.surfaceAlt },

  section: { gap: spacing.sm },
  sectionLabel: { ...type.kicker, color: colors.textFaint },
  rowList: { gap: spacing.sm },

  stampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 56,
    ...shadows.card,
  },
  stampDate: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: `${palette.baseBlue}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  stampBody: { flex: 1, gap: 2 },
  stampTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stampActivity: { ...type.heading, fontSize: 14 },
  stampDateText: { ...type.mono, fontSize: 11.5, color: colors.textFaint },
  stampMeta: { ...type.caption, fontSize: 11.5, color: colors.textDim },
  stampTrust: {
    backgroundColor: `${palette.pulseGreen}14`,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  stampTrustText: { fontSize: 10.5, fontWeight: "800", color: "#0A8F60" },

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
  emptyTitle: { ...type.heading, fontSize: 16, textAlign: "center" },
  emptyText: { ...type.body, fontSize: 13, lineHeight: 18, textAlign: "center" },
  emptyBtn: { alignSelf: "stretch", marginTop: spacing.sm },

  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkText: { flex: 1, ...type.body, fontSize: 13.5, color: colors.textDim },
  checkTextDone: { color: colors.text, fontWeight: "600" },

  privacyCard: { backgroundColor: `${palette.baseBlue}0D` },
  privacyHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  privacyTitle: { ...type.heading, fontSize: 14 },
  privacyLine: { ...type.caption, fontSize: 12.5, color: colors.textDim },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
