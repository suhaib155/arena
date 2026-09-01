/**
 * The canonical MovenRun introduction — one route, one implementation.
 *
 * This replaces the old cinematic panel screen AND the separate three-slide
 * onboarding pager. The pager advanced by calling `ScrollView.scrollTo()` and
 * then *learning* its index from `onMomentumScrollEnd`, which meant the logical
 * step trailed the visible page whenever a fling was cancelled or animation was
 * reduced — the "Next does nothing" bug that pushed users onto Skip.
 *
 * Here the step is plain React state, changed synchronously by the pure
 * functions in `lib/introFlow.ts`. There is no scroll view, no momentum
 * handler, no layout-width division. The fade between steps is decorative only:
 * it runs after the state has already changed and cannot advance anything.
 *
 * Nothing on this screen touches permissions, the backend, or a wallet.
 */
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn } from "@/components/FadeSlideIn";
import { avatar, colors, iconTile, palette, pressFade, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";
import { useGameStore } from "@/store/useGameStore";
import { tapFeedback, successFeedback } from "@/lib/haptics";
import { createTapGuard } from "@/lib/tapGuard";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  canGoBack as canStepBack,
  FIRST_INTRO_STEP,
  INTRO_STEPS,
  INTRO_STEP_COUNT,
  introPositionLabel,
  introProgress,
  introStepAnnouncement,
  isLastIntroStep,
  nextIntroStep,
  previousIntroStep,
  resolveIntroExit,
  toIntroSource,
  type IntroExit,
  type IntroStep,
} from "@/lib/introFlow";

const STEP_TINTS = [palette.pulseGreen, palette.baseBlue, palette.deedViolet];

export default function IntroScreen() {
  const router = useRouter();
  /* Explicit intent, not navigation history: startup opens the intro in
     first-run mode, Profile opens it as a replay. `canGoBack()` would have
     conflated the two whenever the stack happened to be non-empty. */
  const params = useLocalSearchParams<{ source?: string }>();
  const source = toIntroSource(params.source);
  const completeIntro = useGameStore((s) => s.completeIntro);
  const [step, setStep] = useState<IntroStep>(FIRST_INTRO_STEP);
  const reducedMotion = useReducedMotion();

  /* One exit per play: a double tap on the final CTA (or Skip) collapses into
     a single completion and a single navigation. This lives in state, not in
     the press animation. */
  const exitGuard = useRef(createTapGuard(1200)).current;

  // Announce every step change so a screen-reader user is told where they are.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(introStepAnnouncement(step));
  }, [step]);

  const content = INTRO_STEPS[step];
  const isLast = isLastIntroStep(step);
  const tint = STEP_TINTS[step] ?? palette.pulseGreen;

  /* One exit per play, whichever control triggered it. The guard is what makes
     a double tap produce exactly one completion and one navigation. */
  const exit = (action: "skip" | "finish") => {
    if (!exitGuard.tryAcquire()) return;
    const resolved: IntroExit = resolveIntroExit(source, action);
    if (resolved === "return") {
      // Replay: persisted first-run state is not touched at all.
      tapFeedback();
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)");
      return;
    }
    successFeedback();
    // Idempotent for an already-ready user; authoritative for a first run.
    completeIntro();
    router.replace(resolved === "complete-move" ? "/move" : "/(tabs)");
  };

  // Skip means "let me into the app" — it must not start a movement session.
  const skip = () => exit("skip");

  // Next updates logical state synchronously — no scroll, no momentum, no
  // animation callback is involved in the transition.
  const goNext = () => {
    if (isLast) {
      // The final CTA is labelled "Start my first move", so it does that.
      exit("finish");
      return;
    }
    tapFeedback();
    setStep((s) => nextIntroStep(s));
  };

  const goBack = () => {
    tapFeedback();
    setStep((s) => previousIntroStep(s));
  };

  const progress = introProgress(step);

  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.brandRow}>
          <Hexagon size={18} color="#C9EEDE" coreColor={palette.pulseGreen} />
          <Text style={styles.brand}>MovenRun</Text>
        </View>
        <Pressable
          hitSlop={12}
          onPress={skip}
          accessibilityRole="button"
          accessibilityLabel="Skip the introduction"
          style={pressFade(styles.skipBtn)}
        >
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {/* Progress: an explicit "n of 3" plus a bar derived from the same state */}
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: tint }]}
          />
        </View>
        <Text style={styles.position} accessibilityLabel={`Step ${introPositionLabel(step)}`}>
          {introPositionLabel(step)}
        </Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Keyed on the step so the decorative fade replays; the fade runs
            AFTER state has changed and never drives it. Reduced motion swaps
            it for a plain view. */}
        <StepBody key={reducedMotion ? `static-${step}` : `motion-${step}`} animated={!reducedMotion}>
          <View style={[styles.iconCircle, { backgroundColor: `${tint}1A` }]}>
            <Ionicons name={content.icon as IoniconName} size={52} color={tint} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {content.title}
          </Text>
          <Text style={styles.text}>{content.body}</Text>
        </StepBody>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: INTRO_STEP_COUNT }, (_, i) => (
            <View key={i} style={[styles.dot, i === step ? { backgroundColor: tint, width: 18 } : null]} />
          ))}
        </View>
        <Button
          label={content.ctaLabel}
          icon={isLast ? "play" : "arrow-forward"}
          onPress={goNext}
        />
        {canStepBack(step) ? (
          <Button label="Back" variant="ghost" icon="arrow-back" onPress={goBack} />
        ) : null}
      </View>
    </Screen>
  );
}

/** Decorative wrapper: fade-in when motion is allowed, plain view otherwise. */
function StepBody({ animated, children }: { animated: boolean; children: React.ReactNode }) {
  if (!animated) return <View style={styles.step}>{children}</View>;
  return (
    <FadeSlideIn>
      <View style={styles.step}>{children}</View>
    </FadeSlideIn>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brand: { ...type.heading, fontSize: 16 },
  // ~44x44 minimum touch target for the text-only Skip control.
  skipBtn: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  skip: { ...type.caption, fontSize: 15, fontWeight: "700", color: colors.textDim },

  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: radius.pill },
  position: { ...type.mono, fontSize: 12, color: colors.textDim },

  body: { flex: 1 },
  bodyContent: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing.lg },
  step: { alignItems: "center", gap: spacing.lg },
  iconCircle: { ...avatar(116), ...shadows.card },
  title: { ...type.display, fontSize: 26, lineHeight: 32, textAlign: "center" },
  text: {
    ...type.body,
    fontSize: 15.5,
    lineHeight: 23,
    textAlign: "center",
    color: colors.textDim,
  },

  footer: { paddingBottom: spacing.md, gap: spacing.sm },
  dots: { flexDirection: "row", justifyContent: "center", gap: 7, paddingBottom: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
});
