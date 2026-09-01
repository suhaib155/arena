import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, iconTile, ink, palette, radius, shadows, softTint, spacing, tints, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import {
  buildQuestline,
  type QuestlineAction,
  type QuestlineStep,
  type StepStatus,
} from "@/lib/onboardingQuestline";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/** Resolve a step action to a concrete navigation, using current local state. */
function useStepNav() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const history = useGameStore((s) => s.routeTrustHistory);
  return (action: QuestlineAction) => {
    tapFeedback();
    switch (action) {
      case "move":
        router.push("/move");
        return;
      case "zone":
        if (zones[0]) router.push({ pathname: "/zone/[id]", params: { id: zones[0].id } });
        else router.push("/move");
        return;
      case "clubs":
        router.push("/clubs");
        return;
      case "review":
        router.push("/route/review-history");
        return;
      case "passport":
        router.push("/route/passport");
        return;
      case "proof": {
        const rec = history[0];
        if (rec) {
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
        } else {
          router.push("/route/review-history");
        }
        return;
      }
    }
  };
}

const STATUS_META: Record<
  StepStatus,
  { label: string; color: string; soft: string }
> = {
  complete: { label: "Complete", color: ink.green, soft: softTint(palette.pulseGreen) },
  ready: { label: "Ready", color: palette.baseBlue, soft: softTint(palette.baseBlue) },
  locked: { label: "Locked", color: colors.textFaint, soft: colors.surfaceAlt },
};

export default function QuestlineScreen() {
  const router = useRouter();
  const nav = useStepNav();

  const hasHistory = useGameStore((s) => s.history.length > 0);
  const savedRoutes = useGameStore((s) => s.routeTrustHistory.length);
  const zonesOwned = useGameStore((s) => s.zones.length);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const hasClub = useGameStore((s) => s.selectedClubId != null);
  const hasTrust = useGameStore((s) => s.lastTrustScore != null);
  const viewedPassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedProof = useGameStore((s) => s.viewedRouteProof);

  const q = buildQuestline({
    hasHistory,
    savedRoutes,
    zonesOwned,
    timesDefended,
    hasClub,
    hasTrust,
    viewedPassport,
    viewedProof,
  });
  const pct = Math.round((q.completedCount / q.total) * 100);

  return (
    <Screen>
      <ScreenHeader title="Questline" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>MovenRun Questline</Text>
            <Text style={styles.heroTitle}>Learn the local beta loop step by step.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: softTint(palette.baseBlue) }]}>
                <Ionicons name="phone-portrait-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local only</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: softTint(palette.deedViolet) }]}>
                <Ionicons name="sparkles-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Preview beta</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Progress card */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.card}>
            <View style={styles.progressHead}>
              <Text style={styles.progressTitle}>
                {q.allComplete ? "Local beta loop complete" : "Your progress"}
              </Text>
              <Text style={styles.progressCount}>
                {q.completedCount}/{q.total}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${pct}%`, backgroundColor: q.allComplete ? palette.pulseGreen : palette.moveGold },
                ]}
              />
            </View>
            {q.currentStep ? (
              <Text style={styles.progressNext}>Next · {q.currentStep.title}</Text>
            ) : (
              <Text style={styles.progressNext}>Run again to strengthen your territory.</Text>
            )}
          </View>
        </FadeSlideIn>

        {/* Step list */}
        <View style={styles.list}>
          {q.steps.map((step, i) => (
            <FadeSlideIn key={step.id} delay={STAGGER_MS * (2 + Math.min(i, 6))}>
              <StepCard step={step} onPress={() => nav(step.action)} />
            </FadeSlideIn>
          ))}
        </View>

        {/* Safety card */}
        <FadeSlideIn delay={STAGGER_MS * 9}>
          <View style={styles.safety}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.textDim} />
            <Text style={styles.safetyText}>
              Questline progress is local. It does not affect rewards, ownership, or
              on-chain status.
            </Text>
          </View>
        </FadeSlideIn>
      </ScrollView>
    </Screen>
  );
}

function StepCard({ step, onPress }: { step: QuestlineStep; onPress: () => void }) {
  const meta = STATUS_META[step.status];
  const accent = step.futureAccent ? palette.deedViolet : palette.baseBlue;
  const iconColor =
    step.status === "complete" ? palette.pulseGreen : step.status === "locked" ? colors.textFaint : accent;
  return (
    <View style={[styles.step, step.status === "ready" ? styles.stepReady : null]}>
      <View style={[styles.stepIcon, { backgroundColor: softTint(iconColor) }]}>
        <Ionicons name={step.icon as IoniconName} size={18} color={iconColor} />
      </View>
      <View style={styles.stepBody}>
        <View style={styles.stepTitleRow}>
          <Text style={styles.stepTitle} numberOfLines={1}>{step.title}</Text>
          <View style={[styles.statusChip, { backgroundColor: meta.soft }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={styles.stepDesc}>{step.description}</Text>
        {step.status !== "complete" ? (
          <ScalePress
            to={0.97}
            style={[
              styles.cta,
              { backgroundColor: step.status === "ready" ? accent : colors.surfaceAlt },
            ]}
            onPress={onPress}
          >
            <Text
              style={[
                styles.ctaText,
                { color: step.status === "ready" ? colors.surface : colors.textDim },
              ]}
            >
              {step.ctaLabel}
            </Text>
          </ScalePress>
        ) : (
          <Text style={styles.stepProgress}>{step.progressText}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressTitle: { ...type.heading, fontSize: 15 },
  progressCount: { ...type.title, fontSize: 16, color: colors.textDim },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill },
  progressNext: { ...type.caption, fontSize: 12.5, color: colors.textDim },

  list: { gap: spacing.sm },
  step: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  stepReady: { backgroundColor: tints.blueWash },
  stepIcon: { ...iconTile(38) },
  stepBody: { flex: 1, gap: 5 },
  stepTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepTitle: { ...type.heading, fontSize: 14.5, flex: 1 },
  statusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusText: { fontSize: 10, fontWeight: "800" },
  stepDesc: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  cta: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
    marginTop: 2,
  },
  ctaText: { fontSize: 12.5, fontWeight: "800" },
  stepProgress: { ...type.mono, fontSize: 11, color: ink.green, fontWeight: "700" },

  safety: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  safetyText: { flex: 1, ...type.caption, fontSize: 11.5, lineHeight: 16, color: colors.textDim },
});
