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
  LinearGradient,
  vec,
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
  FadeIn,
  FadeInDown,
  FadeInUp,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const { width: W, height: H } = Dimensions.get("window");

const C = {
  signal: "#00ff88",
  gold: "#ffd700",
  ember: "#ff6400",
  bg: "#0d0d0d",
  surface: "#1a1a1a",
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export type LevelUpVariant = "streak" | "gear" | "season_rank";

interface StreakProps {
  variant: "streak";
  streakDays: number;
  onDismiss: () => void;
}

interface GearUpgradeProps {
  variant: "gear";
  gearName: string;
  fromTier: number;
  toTier: number;
  newMultiplier: number;
  onDismiss: () => void;
}

interface SeasonRankProps {
  variant: "season_rank";
  newRank: number;
  prevRank: number;
  rankLabel: string;
  onDismiss: () => void;
}

export type LevelUpProps = StreakProps | GearUpgradeProps | SeasonRankProps;

// ── Flame path for streak ────────────────────────────────────────────────────
const FLAME_CX = W / 2;
const FLAME_CY = H * 0.32;

function FlameCanvas() {
  const flameProgress = useValue(0);
  const flameBreath = useValue(0);

  useEffect(() => {
    runTiming(flameProgress, 1, { duration: 600, easing: Easing.out(Easing.cubic) });
    // Breathing loop
    const loop = () => {
      runTiming(flameBreath, 1, { duration: 1000, easing: Easing.inOut(Easing.sine) });
      setTimeout(() => {
        runTiming(flameBreath, 0, { duration: 1000, easing: Easing.inOut(Easing.sine) });
        setTimeout(loop, 1000);
      }, 1000);
    };
    setTimeout(loop, 700);
  }, [flameProgress, flameBreath]);

  const outerR = useComputedValue(
    () => 60 + flameBreath.current * 8,
    [flameBreath]
  );
  const innerR = useComputedValue(
    () => 36 + flameBreath.current * 5,
    [flameBreath]
  );
  const opacity = useComputedValue(
    () => flameProgress.current,
    [flameProgress]
  );
  const glowOpacity = useComputedValue(
    () => 0.15 + flameBreath.current * 0.12,
    [flameBreath]
  );
  const coreR = useComputedValue(() => 20 + flameBreath.current * 3, [flameBreath]);
  const ringOpacity = useComputedValue(() => 0.08 + flameBreath.current * 0.06, [flameBreath]);

  return (
    <Canvas style={{ width: W, height: H * 0.48 }}>
      <Circle cx={FLAME_CX} cy={FLAME_CY} r={outerR} color={C.ember} opacity={glowOpacity}>
        <BlurMask blur={30} style="outer" />
      </Circle>
      <Circle cx={FLAME_CX} cy={FLAME_CY} r={innerR} color={C.gold} opacity={opacity}>
        <BlurMask blur={4} style="outer" />
      </Circle>
      <Circle cx={FLAME_CX} cy={FLAME_CY} r={coreR} color="#fff" opacity={opacity} />
      <Circle cx={FLAME_CX} cy={FLAME_CY} r={outerR} color={C.ember} opacity={ringOpacity} style="stroke" strokeWidth={2} />
    </Canvas>
  );
}

// ── Gear glow canvas ─────────────────────────────────────────────────────────
function GearGlowCanvas({ tier }: { tier: number }) {
  const glowProgress = useValue(0);
  const breath = useValue(0);

  useEffect(() => {
    runTiming(glowProgress, 1, { duration: 800, easing: Easing.out(Easing.cubic) });
    const loop = () => {
      runTiming(breath, 1, { duration: 1200, easing: Easing.inOut(Easing.sine) });
      setTimeout(() => {
        runTiming(breath, 0, { duration: 1200, easing: Easing.inOut(Easing.sine) });
        setTimeout(loop, 1200);
      }, 1200);
    };
    setTimeout(loop, 900);
  }, [glowProgress, breath]);

  const glowR = useComputedValue(() => 70 + breath.current * 15, [breath]);
  const glowOp = useComputedValue(
    () => glowProgress.current * (0.2 + breath.current * 0.15),
    [glowProgress, breath]
  );
  const innerR = useComputedValue(() => 44 + breath.current * 4, [breath]);

  return (
    <Canvas style={{ width: W, height: H * 0.4 }}>
      <Circle cx={W / 2} cy={H * 0.2} r={glowR} color={tier >= 3 ? C.gold : C.signal} opacity={glowOp}>
        <BlurMask blur={40} style="outer" />
      </Circle>
      <Circle cx={W / 2} cy={H * 0.2} r={innerR} color={tier >= 3 ? C.gold : C.signal} opacity={glowProgress}>
        <BlurMask blur={8} style="outer" />
      </Circle>
    </Canvas>
  );
}

// Each rank bar as its own component to isolate hook calls
function RankBar({
  index,
  cx,
  climbProgress,
}: {
  index: number;
  cx: number;
  climbProgress: ReturnType<typeof useValue>;
}) {
  const y = 40 + index * 40;
  const w = 120 - index * 18;
  const isTop = index === 0;

  const path = Skia.Path.Make();
  path.addRRect(Skia.RRectXY(Skia.XYWHRect(cx - w / 2, y, w, 8), 4, 4));

  const opacity = useComputedValue(() => {
    return isTop ? climbProgress.current : 1;
  }, [climbProgress]);

  return (
    <Group>
      <Path path={path} color={isTop ? C.signal : "#2a2a2a"} opacity={opacity}>
        {isTop && <BlurMask blur={4} style="outer" />}
      </Path>
    </Group>
  );
}

// ── Season rank canvas (climbing effect) ─────────────────────────────────────
function RankClimbCanvas({
  newRank: _newRank,
  prevRank: _prevRank,
}: {
  newRank: number;
  prevRank: number;
}) {
  const climbProgress = useValue(0);

  useEffect(() => {
    runTiming(climbProgress, 1, { duration: 1000, easing: Easing.out(Easing.back) });
  }, [climbProgress]);

  const cx = W / 2;

  return (
    <Canvas style={{ width: W, height: H * 0.35 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <RankBar key={i} index={i} cx={cx} climbProgress={climbProgress} />
      ))}
    </Canvas>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LevelUp(props: LevelUpProps) {
  useEffect(() => {
    const fire = async () => {
      await new Promise((r) => setTimeout(r, 100));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await new Promise((r) => setTimeout(r, 200));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    fire();
  }, []);

  if (props.variant === "streak") {
    return <StreakCelebration {...props} />;
  }
  if (props.variant === "gear") {
    return <GearUpgradeCelebration {...props} />;
  }
  return <SeasonRankCelebration {...props} />;
}

function StreakCelebration({ streakDays, onDismiss }: StreakProps) {
  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      <View style={styles.topCanvas} pointerEvents="none">
        <FlameCanvas />
      </View>
      <Animated.View entering={FadeIn.delay(300).duration(400)} style={styles.center}>
        <Text style={styles.streakLabel}>STREAK</Text>
        <Text style={styles.streakNum}>{streakDays}</Text>
        <Text style={styles.streakDays}>{streakDays === 1 ? "DAY" : "DAYS"}</Text>
        <Text style={styles.streakSub}>You're on fire. Don't break it.</Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(700).duration(350)} style={styles.cta}>
        <TouchableOpacity style={styles.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={styles.doneBtnText}>KEEP THE STREAK</Text>
        </TouchableOpacity>
      </Animated.View>
    </Pressable>
  );
}

function GearUpgradeCelebration({
  gearName,
  fromTier,
  toTier,
  newMultiplier,
  onDismiss,
}: GearUpgradeProps) {
  const tierScale = useSharedValue(0.7);
  const tierOpacity = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      tierScale.value = withSpring(1, { damping: 8, stiffness: 160 });
      tierOpacity.value = withTiming(1, { duration: 300 });
    }, 500);
    return () => clearTimeout(t);
  }, [tierScale, tierOpacity]);

  const tierStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tierScale.value }],
    opacity: tierOpacity.value,
  }));

  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      <View style={styles.topCanvas} pointerEvents="none">
        <GearGlowCanvas tier={toTier} />
      </View>
      <Animated.View entering={FadeIn.delay(200).duration(400)} style={styles.center}>
        <Text style={styles.gearLabel}>GEAR UPGRADE</Text>
        <Text style={styles.gearName}>{gearName}</Text>
        <Animated.View style={[styles.tierRow, tierStyle]}>
          <View style={styles.tierBadgeOld}>
            <Text style={styles.tierBadgeText}>T{fromTier}</Text>
          </View>
          <Text style={styles.tierArrow}>→</Text>
          <View style={[styles.tierBadgeNew, toTier >= 3 && styles.tierBadgeGold]}>
            <Text style={[styles.tierBadgeText, toTier >= 3 && styles.tierBadgeTextGold]}>
              T{toTier}
            </Text>
          </View>
        </Animated.View>
        <Text style={styles.multiplierText}>×{newMultiplier.toFixed(2)} multiplier</Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(900).duration(350)} style={styles.cta}>
        <TouchableOpacity style={styles.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={styles.doneBtnText}>EQUIP & RUN</Text>
        </TouchableOpacity>
      </Animated.View>
    </Pressable>
  );
}

function SeasonRankCelebration({ newRank, prevRank, rankLabel, onDismiss }: SeasonRankProps) {
  const rankY = useSharedValue(40);
  const rankOpacity = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      rankY.value = withSpring(0, { damping: 12, stiffness: 120 });
      rankOpacity.value = withTiming(1, { duration: 400 });
    }, 400);
    return () => clearTimeout(t);
  }, [rankY, rankOpacity]);

  const rankStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: rankY.value }],
    opacity: rankOpacity.value,
  }));

  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      <View style={styles.topCanvas} pointerEvents="none">
        <RankClimbCanvas newRank={newRank} prevRank={prevRank} />
      </View>
      <Animated.View style={[styles.center, rankStyle]}>
        <Text style={styles.rankUpLabel}>RANK UP</Text>
        <Text style={styles.rankLabel}>{rankLabel}</Text>
        <Text style={styles.rankNum}>#{newRank}</Text>
        <Text style={styles.rankPrev}>Previously #{prevRank}</Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(1000).duration(350)} style={styles.cta}>
        <TouchableOpacity style={styles.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={styles.doneBtnText}>VIEW LEADERBOARD</Text>
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
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 52,
  },
  topCanvas: { position: "absolute", top: 0, left: 0, right: 0 },
  center: { alignItems: "center", gap: 8, marginBottom: 40 },
  streakLabel: {
    color: C.ember,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 4,
  },
  streakNum: {
    color: C.gold,
    fontSize: 96,
    fontWeight: "900",
    lineHeight: 104,
  },
  streakDays: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 4,
  },
  streakSub: { color: "#555", fontSize: 14, marginTop: 8 },
  gearLabel: {
    color: C.signal,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 3,
  },
  gearName: { color: "#fff", fontSize: 28, fontWeight: "700" },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  tierBadgeOld: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tierBadgeNew: {
    backgroundColor: "rgba(0,255,136,0.1)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: C.signal,
  },
  tierBadgeGold: {
    backgroundColor: "rgba(255,215,0,0.1)",
    borderColor: C.gold,
  },
  tierBadgeText: { color: "#888", fontSize: 16, fontWeight: "700" },
  tierBadgeTextGold: { color: C.gold },
  tierArrow: { color: "#555", fontSize: 20 },
  multiplierText: {
    color: C.signal,
    fontSize: 18,
    fontWeight: "600",
    marginTop: 4,
  },
  rankUpLabel: {
    color: C.signal,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 4,
  },
  rankLabel: { color: "#888", fontSize: 16, fontWeight: "600" },
  rankNum: {
    color: "#fff",
    fontSize: 72,
    fontWeight: "900",
    lineHeight: 80,
  },
  rankPrev: { color: "#444", fontSize: 14 },
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
    fontSize: 15,
    letterSpacing: 1,
  },
});
