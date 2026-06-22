import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { computePassport, readinessTone, type ReadinessTone } from "@/lib/routePassport";

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

/** Static GPS-quality advice (not derived; always shown). */
const GPS_TIPS = [
  "Wait for GPS lock before you start.",
  "Avoid tunnels and indoor routes.",
  "Keep your phone with a clear sky view.",
  "Pause instead of drifting indoors.",
];

/**
 * Route Signal Passport — local, read-only readiness preview derived from
 * persisted route summaries. No raw GPS, no network, no chain. Does not affect
 * rewards, capture, defend, or ownership.
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
  const p = computePassport(history, { zonesOwned, timesDefended });
  const tone = toneColor(readinessTone(p.readinessLabel));

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
        {/* Hero */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Route Signal Passport</Text>
            <Text style={styles.heroTitle}>A local preview of your GPS quality trend.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Preview only</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}1A` }]}>
                <Ionicons name="location-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No raw GPS</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Readiness card */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.card}>
            <View style={styles.readyRow}>
              <View style={styles.readyScoreWrap}>
                <Text style={[styles.readyScore, { color: tone.text }]}>
                  {p.readinessScore}
                </Text>
                <Text style={styles.readyScoreMax}>/100</Text>
              </View>
              <View style={styles.readyLabelWrap}>
                <Text style={[styles.readyLabel, { color: tone.text }]}>
                  {p.readinessLabel}
                </Text>
                <Text style={styles.readyExplain}>{p.explanation}</Text>
              </View>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[styles.barFill, { width: `${p.readinessScore}%`, backgroundColor: tone.bar }]}
              />
            </View>
            <Text style={styles.readyHint}>Future verification prep · local route reputation</Text>
          </View>
        </FadeSlideIn>

        {/* Stats card */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Signal quality</Text>
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
            {p.topStrengths.length > 0 ? (
              <View style={styles.chipRow}>
                {p.topStrengths.map((s) => (
                  <View key={s} style={styles.strengthChip}>
                    <Ionicons name="checkmark-circle" size={12} color="#0A8F60" />
                    <Text style={styles.strengthText}>{s}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </FadeSlideIn>

        {/* Checklist card */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
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

        {/* Tips card */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Tips for a cleaner signal</Text>
            {GPS_TIPS.map((tip) => (
              <View key={tip} style={styles.tipRow}>
                <Ionicons name="bulb-outline" size={15} color={palette.baseBlue} />
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        </FadeSlideIn>

        {/* Privacy card */}
        <FadeSlideIn delay={STAGGER_MS * 5}>
          <View style={[styles.card, styles.privacyCard]}>
            <View style={styles.privacyHead}>
              <Ionicons name="lock-closed-outline" size={16} color={palette.deedViolet} />
              <Text style={styles.privacyTitle}>Your data</Text>
            </View>
            <Text style={styles.privacyLine}>Only summary scores are saved.</Text>
            <Text style={styles.privacyLine}>Raw GPS and paths are not stored.</Text>
            <Text style={styles.privacyLine}>Nothing is sent anywhere.</Text>
          </View>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          Preview only · local signal · does not affect rewards or ownership.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.stat}>
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  strengthChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: `${palette.pulseGreen}1A`,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  strengthText: { fontSize: 11, fontWeight: "700", color: "#0A8F60" },

  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkText: { flex: 1, ...type.body, fontSize: 13.5, color: colors.textDim },
  checkTextDone: { color: colors.text, fontWeight: "600" },

  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  tipText: { flex: 1, ...type.body, fontSize: 13, lineHeight: 18, color: colors.text },

  privacyCard: { backgroundColor: `${palette.deedViolet}0D` },
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
