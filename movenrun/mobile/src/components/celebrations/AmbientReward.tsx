/**
 * Ambient reward feedback during a run.
 *
 * Three separate, composable components:
 *   <HexEnteredFlash />  — soft signal flash + "+X $MOVE" floats up on hex entry
 *   <CapturePrompt />    — slide-in chip when a capturable zone is entered
 *   <MilestoneGlow />    — edge glow pulse at 1km / 5km / etc.
 *
 * All are rendered as absolute overlays on top of the map. The parent (MapScreen)
 * mounts them conditionally and passes the relevant trigger props.
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated as RNAnimated,
} from "react-native";
import {
  Canvas,
  Circle,
  BlurMask,
  useValue,
  runTiming,
  useComputedValue,
  Easing,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const { width: W, height: H } = Dimensions.get("window");

const C = {
  signal: "#00ff88",
  gold: "#ffd700",
  ember: "#ff6400",
  bg: "#0d0d0d",
} as const;

// ── HexEnteredFlash ─────────────────────────────────────────────────────────
// Shows a "+X $MOVE" float-up label and a brief signal ring at screen center.
// Mount/unmount to trigger — uses useEffect on mount for the animation sequence.

export interface HexEnteredFlashProps {
  /** Amount earned for this hex in 1e-18 units */
  amount: bigint;
  /** Unique key — change this to retrigger (parent should remount) */
  triggerId: string;
  onComplete?: () => void;
}

export function HexEnteredFlash({ amount, onComplete }: HexEnteredFlashProps) {
  const amountStr = `+${(Number(amount) / 1e18).toFixed(3)} $MOVE`;

  // Float-up + fade
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    Haptics.selectionAsync();
    translateY.value = withTiming(-80, { duration: 1400 });
    opacity.value = withSequence(
      withTiming(1, { duration: 100 }),
      withDelay(800, withTiming(0, { duration: 500 }))
    );
    if (onComplete) {
      const t = setTimeout(onComplete, 1400);
      return () => clearTimeout(t);
    }
  }, [translateY, opacity, onComplete]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  // Ring flash (Skia)
  const ringProgress = useValue(0);
  useEffect(() => {
    runTiming(ringProgress, 1, { duration: 600, easing: Easing.out(Easing.quad) });
  }, [ringProgress]);

  const ringR = useComputedValue(
    () => 24 + ringProgress.current * 36,
    [ringProgress]
  );
  const ringOp = useComputedValue(
    () => Math.max(0, 0.5 - ringProgress.current * 0.55),
    [ringProgress]
  );

  return (
    <View style={styles.flashRoot} pointerEvents="none">
      {/* Skia ring */}
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle
          cx={W / 2}
          cy={H / 2}
          r={ringR}
          color={C.signal}
          opacity={ringOp}
          style="stroke"
          strokeWidth={2}
        >
          <BlurMask blur={4} style="outer" />
        </Circle>
      </Canvas>

      {/* Float-up label */}
      <Animated.View style={[styles.floatLabel, floatStyle]}>
        <Text style={styles.floatText}>{amountStr}</Text>
      </Animated.View>
    </View>
  );
}

// ── CapturePrompt ────────────────────────────────────────────────────────────
// A slide-in chip at the top of screen when entering a capturable zone.

export interface CapturePromptProps {
  hexId: string;
  onDismiss?: () => void;
}

export function CapturePrompt({ hexId, onDismiss }: CapturePromptProps) {
  const translateY = useSharedValue(-80);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Slide in
    translateY.value = withSpring(0, { damping: 14, stiffness: 160 });
    opacity.value = withTiming(1, { duration: 250 });

    // Auto-dismiss after 4s
    const t = setTimeout(() => {
      translateY.value = withTiming(-80, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
      if (onDismiss) setTimeout(onDismiss, 300);
    }, 4000);

    return () => clearTimeout(t);
  }, [translateY, opacity, onDismiss]);

  const chipStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.promptChip, chipStyle]} pointerEvents="none">
      <View style={styles.promptDot} />
      <Text style={styles.promptText}>Zone capturable · {hexId.slice(-6)}</Text>
    </Animated.View>
  );
}

// ── MilestoneGlow ─────────────────────────────────────────────────────────────
// Brief glow pulse around the screen edge on distance milestones.

export interface MilestoneGlowProps {
  label: string;
  onComplete?: () => void;
}

export function MilestoneGlow({ label, onComplete }: MilestoneGlowProps) {
  const glowProgress = useValue(0);

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    runTiming(glowProgress, 1, { duration: 1000, easing: Easing.out(Easing.quad) });
    if (onComplete) {
      const t = setTimeout(onComplete, 1100);
      return () => clearTimeout(t);
    }
  }, [glowProgress, onComplete]);

  const edgeOpacity = useComputedValue(
    () => {
      const t = glowProgress.current;
      return t < 0.4 ? t / 0.4 * 0.3 : (1 - t) / 0.6 * 0.3;
    },
    [glowProgress]
  );

  // Label fade
  const labelOpacity = useSharedValue(0);
  const labelScale = useSharedValue(0.85);
  useEffect(() => {
    labelOpacity.value = withSequence(
      withTiming(1, { duration: 300 }),
      withDelay(600, withTiming(0, { duration: 300 }))
    );
    labelScale.value = withSpring(1, { damping: 12, stiffness: 160 });
  }, [labelOpacity, labelScale]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ scale: labelScale.value }],
  }));

  return (
    <View style={styles.milestoneRoot} pointerEvents="none">
      {/* Edge glow via Skia border rings */}
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Top */}
        <Circle cx={W / 2} cy={0} r={W * 0.8} color={C.signal} opacity={edgeOpacity}>
          <BlurMask blur={20} style="outer" />
        </Circle>
        {/* Bottom */}
        <Circle cx={W / 2} cy={H} r={W * 0.8} color={C.signal} opacity={edgeOpacity}>
          <BlurMask blur={20} style="outer" />
        </Circle>
        {/* Left */}
        <Circle cx={0} cy={H / 2} r={H * 0.6} color={C.signal} opacity={edgeOpacity}>
          <BlurMask blur={20} style="outer" />
        </Circle>
        {/* Right */}
        <Circle cx={W} cy={H / 2} r={H * 0.6} color={C.signal} opacity={edgeOpacity}>
          <BlurMask blur={20} style="outer" />
        </Circle>
      </Canvas>

      {/* Milestone label */}
      <Animated.View style={[styles.milestoneLabel, labelStyle]}>
        <Text style={styles.milestoneLabelText}>{label}</Text>
      </Animated.View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // HexEnteredFlash
  flashRoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  floatLabel: {
    position: "absolute",
    bottom: "45%",
    alignSelf: "center",
  },
  floatText: {
    color: C.signal,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0,255,136,0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },

  // CapturePrompt
  promptChip: {
    position: "absolute",
    top: 56,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.3)",
    zIndex: 60,
  },
  promptDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.signal,
  },
  promptText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  // MilestoneGlow
  milestoneRoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 40,
  },
  milestoneLabel: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.4)",
  },
  milestoneLabelText: {
    color: C.signal,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
