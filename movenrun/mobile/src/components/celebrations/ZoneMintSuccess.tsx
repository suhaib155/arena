import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  TouchableOpacity,
} from "react-native";
import {
  Canvas,
  Circle,
  Path,
  Skia,
  Group,
  BlurMask,
  useValue,
  runTiming,
  useComputedValue,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  FadeIn,
  FadeInDown,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const { width: W, height: H } = Dimensions.get("window");

const C = {
  signal: "#00ff88",
  gold: "#ffd700",
  bg: "#0d0d0d",
  surface: "#1a1a1a",
} as const;

// Hex geometry — flat-top at canvas center
const HEX_R = 100;
const CX = W / 2;
const CY = H * 0.38;

function makeHexPath(cx: number, cy: number, r: number) {
  const path = Skia.Path.Make();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.close();
  return path;
}

// Pulse rings — 5 concentric, staggered outward
const PULSE_RINGS = Array.from({ length: 5 }, (_, i) => ({
  delay: i * 0.12,
  baseR: HEX_R + 20 + i * 28,
}));

function PulseRing({
  pulseProgress,
  delay,
  baseR,
  cx,
  cy,
}: {
  pulseProgress: ReturnType<typeof useValue>;
  delay: number;
  baseR: number;
  cx: number;
  cy: number;
}) {
  const r = useComputedValue(() => {
    const t = Math.max(0, pulseProgress.current - delay);
    return baseR + t * 40;
  }, [pulseProgress]);
  const opacity = useComputedValue(() => {
    const t = Math.max(0, pulseProgress.current - delay);
    return Math.max(0, 0.4 - t * 0.5);
  }, [pulseProgress]);
  return (
    <Circle cx={cx} cy={cy} r={r} color={C.signal} opacity={opacity} style="stroke" strokeWidth={2}>
      <BlurMask blur={4} style="outer" />
    </Circle>
  );
}

export interface ZoneMintSuccessProps {
  hexId: string;
  zoneName?: string;
  onDismiss: () => void;
}

export function ZoneMintSuccess({ hexId, zoneName, onDismiss }: ZoneMintSuccessProps) {
  const hexPath = makeHexPath(CX, CY, HEX_R);

  // ── Radial fill progress (0 → 1) ───────────────────────────────────────────
  const fillProgress = useValue(0);
  useEffect(() => {
    runTiming(fillProgress, 1, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [fillProgress]);

  // Clip radius expands from 0 → HEX_R * 1.05 (slightly past edges)
  const clipR = useComputedValue(
    () => fillProgress.current * HEX_R * 1.05,
    [fillProgress]
  );
  const fillOpacity = useComputedValue(
    () => Math.min(fillProgress.current * 2, 0.5),
    [fillProgress]
  );

  // ── Pulse rings progress (0 → 1) ────────────────────────────────────────────
  const pulseProgress = useValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      runTiming(pulseProgress, 1, { duration: 1400, easing: Easing.out(Easing.quad) });
    }, 700);
    return () => clearTimeout(t);
  }, [pulseProgress]);

  // ── NFT stamp — scale with spring overshoot ──────────────────────────────────
  const stampScale = useSharedValue(0);
  const stampOpacity = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      stampOpacity.value = withTiming(1, { duration: 100 });
      stampScale.value = withSpring(1, {
        damping: 8,
        stiffness: 180,
        mass: 0.8,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }, 850);
    return () => clearTimeout(t);
  }, [stampScale, stampOpacity]);

  // ── Banner slide-in ─────────────────────────────────────────────────────────
  const stampStyle = useAnimatedStyle(() => ({
    transform: [{ scale: stampScale.value }],
    opacity: stampOpacity.value,
  }));

  // ── Breathing glow after settle ──────────────────────────────────────────────
  const glowPulse = useValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const loop = () => {
        runTiming(glowPulse, 1, { duration: 1600, easing: Easing.inOut(Easing.sine) });
        setTimeout(() => {
          runTiming(glowPulse, 0, { duration: 1600, easing: Easing.inOut(Easing.sine) });
          setTimeout(loop, 1600);
        }, 1600);
      };
      loop();
    }, 1800);
    return () => clearTimeout(t);
  }, [glowPulse]);

  const glowRadius = useComputedValue(
    () => HEX_R + 8 + glowPulse.current * 12,
    [glowPulse]
  );
  const glowOpacity = useComputedValue(
    () => 0.2 + glowPulse.current * 0.25,
    [glowPulse]
  );

  // Initial haptic on mount
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Ambient background glow */}
        <Circle cx={CX} cy={CY} r={HEX_R * 2.5} color={C.signal} opacity={0.04}>
          <BlurMask blur={60} style="outer" />
        </Circle>

        {/* Hex fill — radial reveal, clipped to circle expanding from center */}
        <Group
          clip={Skia.RRectXY(
            Skia.XYWHRect(CX - HEX_R * 1.1, CY - HEX_R * 1.1, HEX_R * 2.2, HEX_R * 2.2),
            HEX_R * 1.1,
            HEX_R * 1.1
          )}
        >
          <Circle cx={CX} cy={CY} r={clipR} color={C.signal} opacity={fillOpacity} />
        </Group>

        {/* Hex outline */}
        <Path path={hexPath} style="stroke" strokeWidth={2} color={C.signal} />

        {/* Breathing glow ring (post-settle) */}
        <Circle cx={CX} cy={CY} r={glowRadius} color={C.signal} opacity={glowOpacity}>
          <BlurMask blur={16} style="outer" />
        </Circle>

        {/* Pulse rings — energy propagating to neighbors */}
        {PULSE_RINGS.map((ring, i) => (
          <PulseRing
            key={i}
            pulseProgress={pulseProgress}
            delay={ring.delay}
            baseR={ring.baseR}
            cx={CX}
            cy={CY}
          />
        ))}
      </Canvas>

      {/* NFT stamp overlay — scale overshoot */}
      <Animated.View style={[styles.stampContainer, stampStyle]}>
        <View style={styles.nftBadge}>
          <Text style={styles.nftLabel}>ZONE NFT</Text>
          <Text style={styles.nftId}>{hexId.slice(-8)}</Text>
        </View>
      </Animated.View>

      {/* Bottom content */}
      <View style={styles.bottom}>
        <Animated.Text
          entering={FadeInDown.delay(1000).duration(400)}
          style={styles.claimedText}
        >
          CLAIMED
        </Animated.Text>

        {zoneName && (
          <Animated.Text
            entering={FadeInDown.delay(1200).duration(400)}
            style={styles.zoneName}
          >
            {zoneName}
          </Animated.Text>
        )}

        <Animated.Text
          entering={FadeInDown.delay(1400).duration(400)}
          style={styles.subtitle}
        >
          You now earn 2% of all $MOVE from runners in this zone
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(1800).duration(350)}>
          <TouchableOpacity style={styles.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={styles.doneBtnText}>VIEW MY ZONE</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bg,
    zIndex: 999,
    justifyContent: "flex-end",
  },
  stampContainer: {
    position: "absolute",
    top: CY - 60,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  nftBadge: {
    backgroundColor: "rgba(0,255,136,0.12)",
    borderWidth: 1.5,
    borderColor: C.signal,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
  },
  nftLabel: {
    color: C.signal,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3,
  },
  nftId: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 13,
    marginTop: 4,
  },
  bottom: {
    paddingHorizontal: 28,
    paddingBottom: 52,
    gap: 12,
    alignItems: "center",
  },
  claimedText: {
    color: C.signal,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 6,
  },
  zoneName: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
  },
  subtitle: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  doneBtn: {
    backgroundColor: C.signal,
    borderRadius: 28,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginTop: 8,
  },
  doneBtnText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 1,
  },
});
