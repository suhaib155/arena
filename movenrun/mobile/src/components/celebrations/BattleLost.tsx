import React, { useEffect, useState } from "react";
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
  BlurMask,
  useValue,
  runTiming,
  useComputedValue,
  Easing,
} from "@shopify/react-native-skia";
import Animated, {
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const { width: W, height: H } = Dimensions.get("window");

const C = {
  enemy: "#ff4444",
  signal: "#00ff88",
  ember: "#ff6400",
  bg: "#0d0d0d",
  surface: "#1a1a1a",
} as const;

// Reconquest countdown: 30 days in seconds
const RECONQUEST_SECONDS = 30 * 24 * 60 * 60;

function formatCountdown(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface BattleLostProps {
  hexId: string;
  myScore: bigint;
  opponentScore: bigint;
  opponentAddress: string;
  seasonPointsEarned: number;
  hasRightOfFirstRefusal?: boolean;
  reconquestAvailableAt?: number;
  onDismiss: () => void;
  onReconquest?: () => void;
}

export function BattleLost({
  hexId,
  myScore,
  opponentScore,
  opponentAddress,
  seasonPointsEarned,
  hasRightOfFirstRefusal = false,
  reconquestAvailableAt,
  onDismiss,
  onReconquest,
}: BattleLostProps) {
  const mScore = (Number(myScore) / 1e18).toFixed(0);
  const oScore = (Number(opponentScore) / 1e18).toFixed(0);

  const [countdown, setCountdown] = useState(() => {
    if (!reconquestAvailableAt) return RECONQUEST_SECONDS;
    return Math.max(0, reconquestAvailableAt - Math.floor(Date.now() / 1000));
  });

  // ── Gentle haptic — one soft thud ────────────────────────────────────────────
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  // ── Countdown tick ───────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Hex fade to enemy color ──────────────────────────────────────────────────
  const fadeProgress = useValue(0);
  useEffect(() => {
    runTiming(fadeProgress, 1, { duration: 1200, easing: Easing.inOut(Easing.sine) });
  }, [fadeProgress]);

  const hexOpacity = useComputedValue(
    () => fadeProgress.current * 0.15,
    [fadeProgress]
  );
  const hexGlowOpacity = useComputedValue(
    () => fadeProgress.current * 0.06,
    [fadeProgress]
  );

  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      {/* Subtle enemy ambient — NOT a harsh flash */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={W / 2} cy={H * 0.35} r={H * 0.4} color={C.enemy} opacity={hexGlowOpacity}>
          <BlurMask blur={80} style="outer" />
        </Circle>
        <Circle cx={W / 2} cy={H * 0.35} r={120} color={C.enemy} opacity={hexOpacity}>
          <BlurMask blur={40} style="normal" />
        </Circle>
      </Canvas>

      {/* Zone lost title — measured, not punishing */}
      <Animated.View
        entering={FadeIn.delay(200).duration(600)}
        style={styles.heroContainer}
      >
        <Text style={styles.zoneLost}>Zone Lost</Text>
        <Text style={styles.hexId}>{hexId.slice(-8)}</Text>
      </Animated.View>

      {/* Score comparison — shows how close the fight was */}
      <Animated.View
        entering={FadeInDown.delay(500).duration(400)}
        style={styles.scoreRow}
      >
        <View style={styles.scoreBlock}>
          <Text style={styles.scoreRole}>YOU</Text>
          <Text style={styles.myScore}>{mScore}</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.scoreBlock, styles.scoreBlockRight]}>
          <Text style={styles.scoreRole}>WINNER</Text>
          <Text style={styles.oppScore}>{oScore}</Text>
          <Text style={styles.opponentAddr}>{opponentAddress.slice(0, 8)}…</Text>
        </View>
      </Animated.View>

      {/* Season points — loss still feels productive */}
      <Animated.View
        entering={FadeInDown.delay(800).duration(400)}
        style={styles.pointsCard}
      >
        <View style={styles.pointsRow}>
          <Text style={styles.pointsLabel}>Season Points Earned</Text>
          <Text style={styles.pointsValue}>+{seasonPointsEarned}</Text>
        </View>
        <Text style={styles.pointsNote}>
          Every run counts toward your season rank, win or lose.
        </Text>
      </Animated.View>

      {/* Comeback path */}
      <Animated.View
        entering={FadeInDown.delay(1100).duration(400)}
        style={styles.comebackCard}
      >
        <Text style={styles.comebackTitle}>COMEBACK PATH</Text>

        <View style={styles.reconquestRow}>
          <View style={styles.reconquestIcon}>
            <Text style={styles.reconquestIconText}>⏱</Text>
          </View>
          <View style={styles.reconquestText}>
            <Text style={styles.reconquestLabel}>Reconquest available in</Text>
            <Text style={styles.reconquestCountdown}>
              {countdown === 0 ? "Available now!" : formatCountdown(countdown)}
            </Text>
          </View>
        </View>

        {hasRightOfFirstRefusal && (
          <View style={styles.rofRow}>
            <Text style={styles.rofText}>
              You hold Right of First Refusal — you can buy this zone back before anyone else.
            </Text>
          </View>
        )}
      </Animated.View>

      {/* Actions */}
      <Animated.View
        entering={FadeInDown.delay(1400).duration(350)}
        style={styles.actions}
      >
        {onReconquest && countdown === 0 && (
          <TouchableOpacity
            style={styles.reconquestBtn}
            onPress={onReconquest}
            activeOpacity={0.8}
          >
            <Text style={styles.reconquestBtnText}>START RECONQUEST</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={styles.doneBtnText}>KEEP RUNNING</Text>
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
    gap: 20,
    paddingHorizontal: 24,
  },
  heroContainer: { alignItems: "center" },
  zoneLost: {
    color: "#ccc",
    fontSize: 44,
    fontWeight: "700",
    letterSpacing: 2,
  },
  hexId: {
    color: "#444",
    fontFamily: "monospace",
    fontSize: 12,
    marginTop: 6,
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
    color: "#444",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  myScore: {
    color: "#888",
    fontSize: 36,
    fontWeight: "900",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  oppScore: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "900",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  opponentAddr: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 4,
  },
  vs: { color: "#2a2a2a", fontWeight: "700", paddingHorizontal: 12 },
  pointsCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    width: "100%",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
  },
  pointsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pointsLabel: { color: "#888", fontSize: 14 },
  pointsValue: { color: C.signal, fontSize: 22, fontWeight: "700" },
  pointsNote: { color: "#555", fontSize: 12, lineHeight: 17 },
  comebackCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    width: "100%",
    gap: 12,
  },
  comebackTitle: {
    color: "#555",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  reconquestRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  reconquestIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#222",
    alignItems: "center",
    justifyContent: "center",
  },
  reconquestIconText: { fontSize: 18 },
  reconquestText: { flex: 1 },
  reconquestLabel: { color: "#666", fontSize: 12 },
  reconquestCountdown: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  rofRow: {
    backgroundColor: "rgba(255,215,0,0.06)",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.15)",
  },
  rofText: { color: "#999", fontSize: 12, lineHeight: 17 },
  actions: { width: "100%", gap: 10 },
  reconquestBtn: {
    backgroundColor: C.ember,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
  },
  reconquestBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 1,
  },
  doneBtn: {
    backgroundColor: "transparent",
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  doneBtnText: { color: "#666", fontWeight: "600", fontSize: 15 },
});
