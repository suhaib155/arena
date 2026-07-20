import { useEffect, useRef, useState } from "react";
import { Animated, type DimensionValue, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { tapFeedback, successFeedback } from "@/lib/haptics";
import { createTapGuard, SCAN_BAND_WIDTH, scanTranslateRange } from "@/lib/openingAnimation";

interface Panel {
  title: string;
  subtitle: string;
  accent: string;
  badges?: string[];
}

const PANELS: Panel[] = [
  {
    title: "Move. Capture. Defend.",
    subtitle: "Turn your runs into a local territory game.",
    accent: palette.baseBlue,
  },
  {
    title: "Build your territory.",
    subtitle: "Capture zones, defend them, and strengthen your local map.",
    accent: palette.pulseGreen,
  },
  {
    title: "Local beta. No wallet needed.",
    subtitle: "Everything here is preview-only while the world is being built.",
    accent: palette.deedViolet,
    badges: ["Local preview", "No wallet", "No raw GPS shared"],
  },
];

/** Decorative hex cluster (no geography) for the cinematic board. */
const HEXES: { left: DimensionValue; top: DimensionValue; size: number; teal: boolean }[] = [
  { left: "50%", top: "46%", size: 46, teal: true },
  { left: "30%", top: "34%", size: 32, teal: false },
  { left: "70%", top: "36%", size: 32, teal: true },
  { left: "34%", top: "66%", size: 30, teal: false },
  { left: "66%", top: "66%", size: 30, teal: true },
  { left: "50%", top: "78%", size: 26, teal: false },
];

/**
 * Cinematic first-run opening intro — local, lightweight (Views + Animated
 * only; no video/Lottie/SVG/remote assets). Shown once on first launch, then
 * routes into onboarding/Today. No backend, wallet, chain, GPS, or permissions.
 */
export default function OpeningScreen() {
  const router = useRouter();
  const markOpeningSeen = useGameStore((s) => s.markOpeningSeen);
  const hasOnboarded = useGameStore((s) => s.hasOnboarded);
  const [step, setStep] = useState(0);

  const pulse = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  // The scan band travels in PIXELS via translateX (the native animated module
  // does not support layout styles like `left`), so the board must be measured
  // before the scan loop starts.
  const [boardWidth, setBoardWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (boardWidth <= 0) return; // wait for a real measurement
    scan.setValue(0); // reset so every (re)play starts from the left edge
    const scanLoop = Animated.loop(
      Animated.timing(scan, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    scanLoop.start();
    return () => scanLoop.stop();
  }, [scan, boardWidth]);

  const panel = PANELS[step];
  const isLast = step === PANELS.length - 1;

  // One exit per play: Skip / "Enter MovenRun" double-taps and races collapse
  // into a single navigation instead of stacking replace() calls.
  const exitGuard = useRef(createTapGuard(1200)).current;
  const finish = () => {
    if (!exitGuard.tryAcquire()) return;
    successFeedback();
    markOpeningSeen();
    // Replay (pushed from Profile) pops back without leaking this screen into
    // history; first run (arrived via replace) keeps the original replace flow.
    if (router.canGoBack()) router.back();
    else router.replace(hasOnboarded ? "/(tabs)" : "/onboarding");
  };
  const next = () => {
    if (isLast) {
      finish();
      return;
    }
    tapFeedback();
    setStep((s) => s + 1);
  };

  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const scanRange = scanTranslateRange(boardWidth);
  const scanX = scanRange ? scan.interpolate(scanRange) : null;

  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.brandRow}>
          <Hexagon size={18} color="#C9EEDE" coreColor={palette.pulseGreen} />
          <Text style={styles.brand}>MovenRun</Text>
        </View>
        <Pressable hitSlop={10} onPress={finish}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {/* Cinematic territory board */}
      <View style={styles.board} onLayout={(e) => setBoardWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.road, { top: "40%" }]} />
        <View style={[styles.road, { top: "62%" }]} />
        <View style={[styles.roadV, { left: "38%" }]} />
        <View style={[styles.roadV, { left: "64%" }]} />

        {/* glowing route scan — moved with translateX only: the native
            animated module cannot drive layout styles such as `left`. */}
        {scanX ? (
          <Animated.View
            style={[styles.scanLine, { backgroundColor: `${panel.accent}66`, transform: [{ translateX: scanX }] }]}
          />
        ) : null}

        {/* Static positioning lives on the plain wrapper; the Animated.View
            carries only native-driver-safe styles (opacity/transform). */}
        {HEXES.map((h, i) => (
          <View key={i} style={[styles.hex, { left: h.left, top: h.top }]}>
            <Animated.View
              style={
                i === 0
                  ? { opacity: glowOpacity, transform: [{ translateX: -h.size / 2 }, { translateY: -h.size / 2 }, { scale: glowScale }] }
                  : { transform: [{ translateX: -h.size / 2 }, { translateY: -h.size / 2 }] }
              }
            >
              <Hexagon
                size={h.size}
                color={h.teal ? "#CFF6E6" : "#D4E2FE"}
                coreColor={h.teal ? palette.pulseGreen : palette.baseBlue}
              />
            </Animated.View>
          </View>
        ))}
      </View>

      {/* Panel copy */}
      <View style={styles.copy}>
        <FadeSlideIn key={`t-${step}`}>
          <Text style={styles.title}>{panel.title}</Text>
        </FadeSlideIn>
        <FadeSlideIn key={`s-${step}`} delay={60}>
          <Text style={styles.subtitle}>{panel.subtitle}</Text>
        </FadeSlideIn>
        {panel.badges ? (
          <FadeSlideIn key={`b-${step}`} delay={120}>
            <View style={styles.badgeRow}>
              {panel.badges.map((b) => (
                <View key={b} style={styles.badge}>
                  <Ionicons name="shield-checkmark-outline" size={12} color={palette.deedViolet} />
                  <Text style={styles.badgeText}>{b}</Text>
                </View>
              ))}
            </View>
          </FadeSlideIn>
        ) : null}
      </View>

      {/* Footer: dots + CTA */}
      <View style={styles.footer}>
        <View style={styles.dots}>
          {PANELS.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === step ? { backgroundColor: colors.primary, width: 18 } : null]}
            />
          ))}
        </View>
        <Button label={isLast ? "Enter MovenRun" : "Next"} icon={isLast ? "arrow-forward" : undefined} onPress={next} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brand: { ...type.heading, fontSize: 16 },
  skip: { ...type.caption, fontSize: 13, fontWeight: "700", color: colors.textDim },

  board: {
    height: 300,
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    ...shadows.float,
  },
  road: { position: "absolute", left: 0, right: 0, height: 6, backgroundColor: "#E2E8EC" },
  roadV: { position: "absolute", top: 0, bottom: 0, width: 6, backgroundColor: "#E6EBEF" },
  // Static left: 0 anchor — all motion is translateX (native-driver safe).
  scanLine: { position: "absolute", top: 0, bottom: 0, left: 0, width: SCAN_BAND_WIDTH },
  hex: { position: "absolute" },

  copy: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.sm, flex: 1 },
  title: { ...type.display, fontSize: 30, lineHeight: 36 },
  subtitle: { ...type.body, fontSize: 15, lineHeight: 21, color: colors.textDim },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: `${palette.deedViolet}12`,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  badgeText: { fontSize: 12, fontWeight: "700", color: palette.deedViolet },

  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.lg },
  dots: { flexDirection: "row", justifyContent: "center", gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
});
