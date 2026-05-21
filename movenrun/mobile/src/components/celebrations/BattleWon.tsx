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
  Skia,
  Group,
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
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const { width: W, height: H } = Dimensions.get("window");

const C = {
  signal: "#00ff88",
  ember: "#ff6400",
  gold: "#ffd700",
  bg: "#0d0d0d",
  surface: "#1a1a1a",
} as const;

const SHOCKWAVE_PARAMS = Array.from({ length: 3 }, (_, i) => ({
  delay: i * 0.18,
  maxR: W * 0.7 + i * 40,
}));

function ShockwaveRing({
  shockProgress,
  delay,
  maxR,
}: {
  shockProgress: ReturnType<typeof useValue>;
  delay: number;
  maxR: number;
}) {
  const r = useComputedValue(() => {
    const t = Math.max(0, shockProgress.current - delay);
    return t * maxR;
  }, [shockProgress]);
  const op = useComputedValue(() => {
    const t = Math.max(0, shockProgress.current - delay);
    return Math.max(0, 0.5 - t * 0.55);
  }, [shockProgress]);
  return (
    <Circle cx={W / 2} cy={H * 0.42} r={r} color={C.signal} opacity={op} style="stroke" strokeWidth={2}>
      <BlurMask blur={8} style="outer" />
    </Circle>
  );
}

function SweepClip({
  sweepProgress,
}: {
  sweepProgress: ReturnType<typeof useValue>;
}) {
  const sweepX = useComputedValue(() => sweepProgress.current * W, [sweepProgress]);
  return (
    <Group clip={Skia.RRectXY(Skia.XYWHRect(0, 0, sweepX, H), 0, 0)}>
      <Circle cx={W / 2} cy={H / 2} r={H} color={C.signal} opacity={0.05} />
    </Group>
  );
}

function EmberFade({
  sweepProgress,
}: {
  sweepProgress: ReturnType<typeof useValue>;
}) {
  const op = useComputedValue(
    () => 0.08 * (1 - sweepProgress.current),
    [sweepProgress]
  );
  return <Circle cx={W / 2} cy={H / 2} r={H} color={C.ember} opacity={op} />;
}

export interface BattleWonProps {
  hexId: string;
  myScore: bigint;
  opponentScore: bigint;
  opponentAddress: string;
  achievementBadge?: string;
  onDismiss: () => void;
}

export function BattleWon({
  hexId,
  myScore,
  opponentScore,
  opponentAddress,
  achievementBadge,
  onDismiss,
}: BattleWonProps) {
  const mScore = (Number(myScore) / 1e18).toFixed(0);
  const oScore = (Number(opponentScore) / 1e18).toFixed(0);

  // ── Haptic sequence ──────────────────────────────────────────────────────────
  useEffect(() => {
    const fire = async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 150));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 150));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 300));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    fire();
  }, []);

  // ── Color sweep: ember → signal ──────────────────────────────────────────────
  const sweepProgress = useValue(0);
  useEffect(() => {
    runTiming(sweepProgress, 1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [sweepProgress]);

  // ── Shockwave rings ──────────────────────────────────────────────────────────
  const shockProgress = useValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      runTiming(shockProgress, 1, { duration: 1000, easing: Easing.out(Easing.quad) });
    }, 800);
    return () => clearTimeout(t);
  }, [shockProgress]);

  // ── Score count-up (JS-thread timer, same as RunComplete hero counter) ───────
  const myScoreTarget = Number(myScore) / 1e18;
  const oppScoreTarget = Number(opponentScore) / 1e18;
  const [myScoreDisplay, setMyScoreDisplay] = React.useState(0);
  const [oppScoreDisplay, setOppScoreDisplay] = React.useState(0);

  useEffect(() => {
    const start = Date.now();
    const delay = 600;
    const duration = 1200;
    let raf: ReturnType<typeof setTimeout>;
    const tick = () => {
      const elapsed = Math.max(0, Date.now() - start - delay);
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setMyScoreDisplay(eased * myScoreTarget);
      setOppScoreDisplay(eased * oppScoreTarget);
      if (t < 1) raf = setTimeout(tick, 16);
    };
    raf = setTimeout(tick, delay);
    return () => clearTimeout(raf);
  }, [myScoreTarget, oppScoreTarget]);

  // ── Achievement badge 3D flip ────────────────────────────────────────────────
  const badgeRotY = useSharedValue(90);
  const badgeScale = useSharedValue(0.6);
  const badgeOpacity = useSharedValue(0);

  useEffect(() => {
    if (!achievementBadge) return;
    const t = setTimeout(() => {
      badgeOpacity.value = withTiming(1, { duration: 200 });
      badgeRotY.value = withSpring(0, { damping: 10, stiffness: 120 });
      badgeScale.value = withSpring(1, { damping: 10, stiffness: 140 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, 1600);
    return () => clearTimeout(t);
  }, [achievementBadge, badgeRotY, badgeScale, badgeOpacity]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeOpacity.value,
    transform: [
      { perspective: 600 },
      { rotateY: `${badgeRotY.value}deg` },
      { scale: badgeScale.value },
    ],
  }));

  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      {/* Skia fx layer */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <EmberFade sweepProgress={sweepProgress} />
        <SweepClip sweepProgress={sweepProgress} />
        {SHOCKWAVE_PARAMS.map((sw, i) => (
          <ShockwaveRing
            key={i}
            shockProgress={shockProgress}
            delay={sw.delay}
            maxR={sw.maxR}
          />
        ))}
      </Canvas>

      {/* "ZONE CAPTURED" hero text */}
      <Animated.View
        entering={FadeIn.delay(400).duration(500)}
        style={styles.heroContainer}
      >
        <Text style={styles.zoneCaptured}>ZONE</Text>
        <Text style={styles.zoneCapturedSub}>CAPTURED</Text>
        <Text style={styles.hexId}>{hexId.slice(-8)}</Text>
      </Animated.View>

      {/* Score comparison */}
      <Animated.View
        entering={FadeInDown.delay(600).duration(400)}
        style={styles.scoreRow}
      >
        <View style={styles.scoreBlock}>
          <Text style={styles.scoreRole}>YOU</Text>
          <Text style={[styles.scoreNum, styles.myScore]}>{Math.round(myScoreDisplay)}</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.scoreBlock, styles.scoreBlockRight]}>
          <Text style={styles.scoreRole}>OPPONENT</Text>
          <Text style={[styles.scoreNum, styles.oppScore]}>{Math.round(oppScoreDisplay)}</Text>
          <Text style={styles.opponentAddr}>{opponentAddress.slice(0, 8)}…</Text>
        </View>
      </Animated.View>

      {/* Achievement badge */}
      {achievementBadge && (
        <Animated.View style={[styles.badgeContainer, badgeStyle]}>
          <View style={styles.badge}>
            <Text style={styles.badgeTitle}>ACHIEVEMENT</Text>
            <Text style={styles.badgeName}>{achievementBadge}</Text>
          </View>
        </Animated.View>
      )}

      {/* CTA */}
      <Animated.View
        entering={FadeInDown.delay(1000).duration(350)}
        style={styles.cta}
      >
        <TouchableOpacity style={styles.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={styles.doneBtnText}>CLAIM YOUR ZONE</Text>
        </TouchableOpacity>
      </Animated.View>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bg,
    zIndex: 999,
    justifyContent: "center",
    alignItems: "center",
    gap: 32,
    paddingHorizontal: 24,
  },
  heroContainer: { alignItems: "center" },
  zoneCaptured: {
    color: C.signal,
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 8,
    lineHeight: 68,
  },
  zoneCapturedSub: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: 8,
  },
  hexId: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 13,
    marginTop: 8,
    letterSpacing: 1,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    width: "100%",
  },
  scoreBlock: { flex: 1 },
  scoreBlockRight: { alignItems: "flex-end" },
  scoreRole: {
    color: "#555",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  scoreNum: {
    fontSize: 40,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
  myScore: { color: C.signal },
  oppScore: { color: "#444" },
  opponentAddr: {
    color: "#444",
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 4,
  },
  vs: {
    color: "#333",
    fontWeight: "700",
    fontSize: 16,
    paddingHorizontal: 12,
  },
  badgeContainer: {
    alignItems: "center",
  },
  badge: {
    backgroundColor: "rgba(255,215,0,0.1)",
    borderWidth: 1.5,
    borderColor: C.gold,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignItems: "center",
    gap: 4,
  },
  badgeTitle: {
    color: C.gold,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 3,
  },
  badgeName: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  cta: { width: "100%" },
  doneBtn: {
    backgroundColor: C.signal,
    borderRadius: 28,
    paddingVertical: 18,
    alignItems: "center",
  },
  doneBtnText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 1,
  },
});
